// Default is read-only. --apply requires an explicit --project; never runs on deploy.
const fs = require('node:fs');
const path = require('node:path');
const D = require('../functions/advisory-domain');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const project = args.find(a => a.startsWith('--project='))?.split('=')[1];
const resume = args.find(a => a.startsWith('--resume='))?.split('=')[1];
const rollback = args.find(a => a.startsWith('--rollback='))?.split('=')[1];
async function main() {
    if (!project) throw new Error('Specify --project=<id> (and --apply only after backup/review)');
    if ([resume, rollback].some(value => value && !/^[a-zA-Z0-9_-]+$/.test(value))) throw new Error('Invalid version');
    const admin = require('../functions/node_modules/firebase-admin');
    const config = { projectId: project };
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
        const cli = path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib');
        const auth = require(path.join(cli, 'auth')); const account = auth.getGlobalDefaultAccount();
        if (!account) throw new Error('Firebase login or ADC required');
        config.credential = { getAccessToken: async () => {
            const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
            return { access_token: token.access_token, expires_in: 3600 };
        } };
    }
    admin.initializeApp(config); const db = admin.firestore();
    const version = resume || `cost_${Date.now()}`;
    const stateRef = db.doc('settings/analytics');
    const backup = `backups.local/${version}`;
    const initial = (await stateRef.get()).data() || {};
    if (rollback) {
        if (!apply || initial.activeVersion !== rollback || !initial.activatedAt) throw new Error('Rollback requires --apply and the active version');
        await stateRef.update({ maintenance: true });
        const changed = await db.collection('operations').where('createdAt', '>=', initial.activatedAt).limit(1).get();
        const created = await db.collection('asesorias').where('pointsAwardedAt', '>=', initial.activatedAt).limit(1).get();
        if (!changed.empty || !created.empty) {
            await stateRef.update({ maintenance: false });
            throw new Error('Post-cutover operations exist; rebuild instead of switching to a stale version');
        }
        const prior = JSON.parse(fs.readFileSync(`backups.local/${rollback}/settings.json`, 'utf8'));
        if (prior.activatedAt && !prior.activatedAt.toDate) prior.activatedAt = new admin.firestore.Timestamp(prior.activatedAt._seconds ?? prior.activatedAt.seconds, prior.activatedAt._nanoseconds ?? prior.activatedAt.nanoseconds);
        await stateRef.set({ ...prior, ready: Boolean(prior.ready), maintenance: false });
        console.log(JSON.stringify({ rollback, activeVersion: prior.activeVersion || null }));
        await admin.app().delete(); return;
    }
    if (apply && initial.ready && initial.activeVersion === version && !initial.maintenance) {
        console.log(JSON.stringify({ apply, version, completed: true, scanned: 0, imported: 0 }));
        await admin.app().delete(); return;
    }
    if (apply) {
        fs.mkdirSync(backup, { recursive: true });
        await db.runTransaction(async tx => {
            const snap = await tx.get(stateRef); const previous = snap.exists ? snap.data() : {};
            if (previous.maintenance && previous.migrationVersion !== version) throw new Error('Another migration owns the maintenance lock');
            if (!fs.existsSync(`${backup}/settings.json`)) fs.writeFileSync(`${backup}/settings.json`, JSON.stringify(previous));
            tx.set(stateRef, { ...previous, maintenance: true, migrationVersion: version });
        });
    }
    let cursor; let scanned = 0; let imported = 0; let expectedTotal = 0;
    const expectedUsers = new Set();
    const fields = admin.firestore.FieldPath;
    while (true) {
        let query = db.collection('asesorias').orderBy(fields.documentId()).limit(100);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get(); if (page.empty) break;
        for (const snap of page.docs) {
            const record = snap.data(); scanned++;
            if (D.real(record)) { expectedTotal++; if (record.userInfo?.uid) expectedUsers.add(record.userInfo.uid); }
            if (!apply) continue;
            if (!fs.existsSync(`${backup}/${snap.id}.json`)) fs.writeFileSync(`${backup}/${snap.id}.json`, JSON.stringify(record));
            await db.runTransaction(async tx => {
                const latest = await tx.get(snap.ref);
                const receipt = db.doc(`analytics/${version}/imported/${snap.id}`);
                if ((await tx.get(receipt)).exists) return;
                const record = latest.data();
                const projection = await D.projectChange(tx, db, version, null, record, admin.firestore.Timestamp.now());
                let pairRef; let pair;
                if (D.contribution(record)?.semester !== 'undated' && D.real(record) && record.date?.toMillis && record.peerInfo?.uid && record.userInfo?.uid) {
                    pairRef = db.doc(`analytics/${version}/pairs/${D.hash(`${record.peerInfo.uid}:${record.userInfo.uid}`)}`);
                    const current = await tx.get(pairRef); pair = current.data();
                }
                for (const [ref, data] of projection.writes) tx.set(ref, data);
                if (pairRef) tx.set(pairRef, { firstAt: !pair || record.date.toMillis() < pair.firstAt.toMillis() ? record.date : pair.firstAt,
                    lastAt: !pair || record.date.toMillis() > pair.lastAt.toMillis() ? record.date : pair.lastAt });
                tx.update(snap.ref, { isReal: D.real(record), countable: D.real(record) && record.duplicate !== true, hasRating: record.rating != null,
                    originalPointsAwarded: record.originalPointsAwarded ?? (Number(record.pointsAwarded) || 0), awardPeerUid: record.awardPeerUid || record.peerInfo?.uid || '' });
                tx.create(receipt, { imported: true });
            });
            imported++;
        }
        cursor = page.docs.at(-1);
        if (apply) fs.writeFileSync(`${backup}/checkpoint.json`, JSON.stringify({ version, scanned, lastId: cursor.id }));
    }
    if (apply) {
        // Backfill date on existing attendance reports, without changing reports.
        let after;
        while (true) {
            let q = db.collectionGroup('report').orderBy(fields.documentId()).limit(450);
            if (after) q = q.startAfter(after);
            const page = await q.get(); if (page.empty) break;
            const batch = db.batch();
            for (const snap of page.docs) {
                const parts = snap.ref.path.split('/');
                if (parts[0] === 'attendance' && parts.length === 4) batch.update(snap.ref, { date: parts[1], recordType: 'attendance' });
            }
            await batch.commit(); after = page.docs.at(-1);
        }
        const settings = {};
        for (const [type, field] of [['reveal_config', 'evaluationsRevealedAt'], ['evaluations_cleared_config', 'evaluationsClearedAt']]) {
            const old = await db.collection('asesorias').where('_type', '==', type).get();
            const timestamps = old.docs.map(doc => doc.data()[field]).filter(Boolean);
            settings[field] = timestamps.sort((a, b) => b.toMillis() - a.toMillis())[0] || null;
        }
        const evaluationsRef = db.doc('settings/evaluations');
        const existing = await evaluationsRef.get();
        if (!fs.existsSync(`${backup}/evaluations.json`)) fs.writeFileSync(`${backup}/evaluations.json`, JSON.stringify(existing.data() || {}));
        // Never overwrite a newer configuration already migrated or changed by an administrator.
        for (const [field, timestamp] of Object.entries(existing.data() || {})) {
            if (timestamp?.toMillis && (!settings[field] || timestamp.toMillis() > settings[field].toMillis())) settings[field] = timestamp;
        }
        await evaluationsRef.set(settings, { merge: true });
        let announcementCursor;
        while (true) {
            let q = db.collection('announcements').orderBy(fields.documentId()).limit(450);
            if (announcementCursor) q = q.startAfter(announcementCursor);
            const page = await q.get(); if (page.empty) break;
            const batch = db.batch();
            for (const snap of page.docs) {
                const data = snap.data(); let imagePath = data.imagePath || null;
                if (!imagePath && data.imageUrl) {
                    try { const url = new URL(data.imageUrl); if (url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith(`/v0/b/${project}.appspot.com/o/`)) imagePath = decodeURIComponent(url.pathname.split('/o/')[1]); } catch { /* external image: no deletion */ }
                }
                let dateTime = data.dateTime || null;
                if (dateTime && !dateTime.toDate) dateTime = admin.firestore.Timestamp.fromDate(new Date(dateTime));
                batch.update(snap.ref, { imagePath, dateTime });
            }
            await batch.commit(); announcementCursor = page.docs.at(-1);
        }
        const summary = (await db.doc(`analytics/${version}/summaries/all`).get()).data();
        if ((summary?.totalAsesorias || 0) !== expectedTotal || (summary?.totalUniqueUsers || 0) !== expectedUsers.size) throw new Error('Reconciliation failed; maintenance lock retained');
        fs.writeFileSync(`${backup}/reconciliation.json`, JSON.stringify({ expectedTotal, expectedUniqueUsers: expectedUsers.size, actual: summary || null }));
        await stateRef.set({ activeVersion: version, ready: true, maintenance: false, migrationVersion: version, imagePathsReady: true, activatedAt: admin.firestore.Timestamp.now() });
    }
    console.log(JSON.stringify({ apply, version, scanned, imported, expectedTotal, expectedUniqueUsers: expectedUsers.size, backup: apply ? backup : null }));
    await admin.app().delete();
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
