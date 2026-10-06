const D = require('./advisory-domain');

function createAdvisoryService({ db, admin, HttpsError }) {
    const error = (code, message) => new HttpsError(code, message);
    function actor(context) {
        const email = context.auth?.token?.email?.toLowerCase();
        if (!context.auth || !/^[a-z0-9._-]+@tec\.mx$/.test(email || '')) throw error('unauthenticated', 'Inicia sesión con una cuenta Tec');
        return { uid: email.split('@')[0], authUid: context.auth.uid, role: context.auth.token.role || 'user' };
    }
    function operationId(value) {
        if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(value)) throw error('invalid-argument', 'Identificador de operación inválido');
        return value;
    }
    function evaluation(data) {
        const rating = data.rating == null ? null : Number(data.rating);
        if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) throw error('invalid-argument', 'Evaluación debe estar entre 1 y 5');
        if (typeof (data.comment ?? '') !== 'string' || (data.comment || '').length > 2000) throw error('invalid-argument', 'Comentario demasiado largo');
        return { rating, hasRating: rating !== null, comment: data.comment || '' };
    }
    async function active(tx) {
        const state = await tx.get(db.doc('settings/analytics'));
        if (!state.exists || !state.data().ready || state.data().maintenance) throw error('failed-precondition', 'Estadísticas en mantenimiento; intenta más tarde');
        return state.data().activeVersion;
    }
    async function stageUsers(tx, projection, pointDeltas = {}) {
        const changes = new Map();
        const currentSemester = D.semester(new Date());
        const peerIds = new Set([...Object.keys(pointDeltas), ...[...projection.peers.values()].map(p => p.uid)]);
        for (const uid of peerIds) {
            const ref = db.doc(`users/${uid}`); const snap = await tx.get(ref); if (!snap.exists) continue;
            const user = snap.data(); const peer = projection.peers.get(`${currentSemester}~${uid}`);
            const nextBonus = peer ? D.bonus(peer.value.ratingSum, peer.value.ratingCount) : Number(user.ratingBonusPoints || 0);
            const updates = { points: Math.max(0, D.round(Number(user.points || 0) + (pointDeltas[uid] || 0) + nextBonus - Number(user.ratingBonusPoints || 0))) };
            if (peer) { updates.ratingBonusPoints = nextBonus; updates.badges = D.badgeUpdates(user, peer.value.count); }
            changes.set(uid, [ref, updates]);
        }
        return [...changes.values()];
    }
    async function register(data, context) {
        const who = actor(context); const op = operationId(data.operationId); const evalData = evaluation(data);
        if (!/^[a-z0-9._-]+$/i.test(data.peerUid || '') || typeof data.subjectId !== 'string' || data.subjectId.includes('/')) throw error('invalid-argument', 'MAE o materia inválidos');
        const id = D.hash(`${who.authUid}:${op}`); const ref = db.doc(`asesorias/${id}`);
        const fingerprint = D.hash(JSON.stringify([data.peerUid, data.subjectId, evalData]));
        return db.runTransaction(async tx => {
            const version = await active(tx);
            const existing = await tx.get(ref);
            if (existing.exists) {
                if (existing.data().operationFingerprint !== fingerprint) throw error('already-exists', 'La operación ya existe con otros datos');
                return { id, pointsAwarded: existing.data().pointsAwarded, replay: true };
            }
            const user = await tx.get(db.doc(`users/${who.uid}`));
            const peer = await tx.get(db.doc(`users/${data.peerUid}`));
            const subject = await tx.get(db.doc(`schools/tec.mx/subjects/${data.subjectId}`));
            if (!user.exists || !peer.exists || !subject.exists) throw error('not-found', 'Usuario, MAE o materia no encontrados');
            if (!D.MAE_ROLES.includes(peer.data().role)) throw error('failed-precondition', 'El asesor no es un MAE activo');
            const pairRef = db.doc(`analytics/${version}/pairs/${D.hash(`${data.peerUid}:${who.uid}`)}`);
            const pair = await tx.get(pairRef); const previous = pair.exists ? pair.data() : null;
            const date = admin.firestore.Timestamp.now();
            const recent = previous && date.toMillis() - previous.lastAt.toMillis() < 10800000;
            const points = D.individualPoints(!previous, Boolean(recent));
            const record = { peerInfo: { ...D.snapshotUser(peer.data()), uid: data.peerUid },
                userInfo: { ...D.snapshotUser(user.data()), uid: who.uid }, subject: subject.data(), ...evalData,
                duplicate: false, isReal: true, countable: true, date, pointsAwarded: points,
                originalPointsAwarded: points, awardPeerUid: data.peerUid,
                pointsReason: previous ? (recent ? 'recurrent_under_3_hours' : 'recurrent_student') : 'first_time_student',
                pointsSubjectId: data.subjectId, pointsAwardedAt: date, operationFingerprint: fingerprint };
            const projection = await D.projectChange(tx, db, version, null, record, date);
            const users = await stageUsers(tx, projection, { [data.peerUid]: points });
            for (const [path, value] of projection.writes) tx.set(path, value);
            for (const [path, value] of users) tx.update(path, value);
            tx.set(pairRef, { firstAt: previous?.firstAt || date, lastAt: date });
            tx.create(ref, record);
            return { id, pointsAwarded: points, replay: false };
        });
    }
    async function mutate(data, context, remove = false) {
        const who = actor(context);
        if (typeof data.id !== 'string' || data.id.includes('/')) throw error('invalid-argument', 'ID inválido');
        const op = operationId(data.operationId); const receipt = db.doc(`operations/${D.hash(`${who.authUid}:${op}`)}`);
        const ref = db.doc(`asesorias/${data.id}`);
        const fingerprint = D.hash(JSON.stringify([data.id, data.patch || null, remove]));
        return db.runTransaction(async tx => {
            const version = await active(tx); const done = await tx.get(receipt);
            if (done.exists) {
                if (done.data().fingerprint !== fingerprint) throw error('already-exists', 'Operación reutilizada');
                return { id: data.id, replay: true };
            }
            const snap = await tx.get(ref); if (!snap.exists) throw error('not-found', 'Asesoría no encontrada');
            const before = snap.data(); const adminRole = ['admin', 'tec'].includes(who.role);
            if (remove && !adminRole) throw error('permission-denied', 'Solo administración elimina asesorías');
            if (!adminRole && !['coordi'].includes(who.role) && before.userInfo?.uid !== who.uid) throw error('permission-denied', 'No puedes modificar esta asesoría');
            let after = null;
            if (!remove) {
                const patch = data.patch || {}; const allowed = adminRole ? ['rating', 'comment', 'duplicate', '_test', 'subject', 'date', 'peerInfo', 'userInfo'] : ['rating', 'comment'];
                if (Object.keys(patch).some(key => !allowed.includes(key))) throw error('invalid-argument', 'Campo protegido');
                after = { ...before, ...patch, ...evaluation({ rating: patch.rating === undefined ? before.rating : patch.rating, comment: patch.comment === undefined ? before.comment : patch.comment }) };
                if (patch.date) { const date = new Date(patch.date); if (Number.isNaN(date.getTime())) throw error('invalid-argument', 'Fecha inválida'); after.date = admin.firestore.Timestamp.fromDate(date); }
                for (const key of ['peerInfo', 'userInfo']) if (!/^[a-z0-9._-]+$/i.test(after[key]?.uid || '')) throw error('invalid-argument', 'Usuario inválido');
                if (patch.duplicate !== undefined && typeof patch.duplicate !== 'boolean') throw error('invalid-argument', 'Duplicada inválida');
                if (patch._test !== undefined && typeof patch._test !== 'boolean') throw error('invalid-argument', 'Prueba inválida');
                after.isReal = D.real(after); after.countable = after.isReal && after.duplicate !== true;
                // Preserve the original award so restoring a correction is reversible.
                after.originalPointsAwarded = before.originalPointsAwarded ?? (Number(before.pointsAwarded) || 0);
                after.awardPeerUid = before.awardPeerUid || before.peerInfo.uid;
                after.pointsAwarded = after.isReal && !after.duplicate && after.peerInfo.uid === after.awardPeerUid ? after.originalPointsAwarded : 0;
            }
            const projection = await D.projectChange(tx, db, version, before, after, admin.firestore.Timestamp.now());
            const delta = {};
            if (before.peerInfo?.uid) delta[before.peerInfo.uid] = -(Number(before.pointsAwarded) || 0);
            if (after?.peerInfo?.uid) delta[after.peerInfo.uid] = (delta[after.peerInfo.uid] || 0) + (Number(after.pointsAwarded) || 0);
            const users = await stageUsers(tx, projection, delta);
            for (const [path, value] of projection.writes) tx.set(path, value);
            for (const [path, value] of users) tx.update(path, value);
            if (after) tx.set(ref, after); else tx.delete(ref);
            tx.create(receipt, { fingerprint, createdAt: admin.firestore.Timestamp.now() });
            return { id: data.id, replay: false };
        });
    }
    return { register, mutate, actor, active };
}
module.exports = { createAdvisoryService };
