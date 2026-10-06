const D = require('./advisory-domain');
const { createAdvisoryService } = require('./advisory-service');
function createCostApi({ db, admin, functions }) {
    const { Timestamp, FieldValue } = require('firebase-admin/firestore');
    const service = createAdvisoryService({ db, admin, HttpsError: functions.https.HttpsError });
    const callable = functions.runWith({ enforceAppCheck: process.env.MAES_ENFORCE_APP_CHECK === 'true' }).https;
    const coordinator = context => {
        const who = service.actor(context);
        if (!['admin', 'tec', 'coordi'].includes(who.role)) throw new functions.https.HttpsError('permission-denied', 'Requiere coordinación');
        return who;
    };
    async function awardBadges(userId) {
        const settings = await db.doc('settings/analytics').get();
        if (!settings.exists || !settings.data().ready || settings.data().maintenance) return;
        const version = settings.data().activeVersion;
        await db.runTransaction(async tx => {
            const ref = db.doc(`users/${userId}`); const snap = await tx.get(ref); if (!snap.exists) return;
            const user = snap.data();
            const stats = await tx.get(db.doc(`analytics/${version}/peers/${D.semester(new Date())}~${userId}`));
            const badges = D.badgeUpdates(user, stats.exists ? stats.data().count : 0);
            if (JSON.stringify(badges) !== JSON.stringify(user.badges || [])) tx.update(ref, { badges });
        });
    }
    async function awardLeaderBadge() {
        const snapshot = await db.collection('users').where('role', 'in', D.MAE_ROLES).orderBy('points', 'desc').limit(1).get();
        if (snapshot.empty) return;
        await db.runTransaction(async tx => {
            const ref = snapshot.docs[0].ref; const snap = await tx.get(ref); if (!snap.exists) return;
            const badges = snap.data().badges || [];
            if (!badges.some(b => String(b.id) === '11' && !b.achieved)) return;
            tx.update(ref, { badges: badges.map(b => String(b.id) === '11' ? { ...b, achieved: true } : b) });
        });
    }
    return {
        registerAdvisory: callable.onCall(service.register),
        updateAdvisory: callable.onCall((data, context) => service.mutate(data, context)),
        deleteAdvisory: callable.onCall((data, context) => service.mutate(data, context, true)),
        setAttendance: callable.onCall(async (data, context) => {
            const who = coordinator(context);
            if (!/^[a-z0-9._-]+$/i.test(data.uid || '') || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || !['A', 'R', 'F', 'J', 'RR'].includes(data.report)) throw new functions.https.HttpsError('invalid-argument', 'Reporte inválido');
            if (who.uid === data.uid && who.role === 'coordi') throw new functions.https.HttpsError('permission-denied', 'No puedes registrar tu propia asistencia');
            return db.runTransaction(async tx => {
                const userRef = db.doc(`users/${data.uid}`); const ref = db.doc(`attendance/${data.date}/report/${data.uid}`);
                const root = db.doc(`attendance/${data.date}`);
                const [user, old, day] = await Promise.all([tx.get(userRef), tx.get(ref), tx.get(root)]);
                if (!user.exists) throw new functions.https.HttpsError('not-found', 'MAE no encontrado');
                const points = { A: 3, R: 1, F: 0, J: 0, RR: 0 };
                const delta = points[data.report] - (points[old.data()?.report] || 0);
                tx.set(ref, { id: data.uid, name: user.data().name || '', email: user.data().email || '', date: data.date, recordType: 'attendance', report: data.report }, { merge: true });
                if (!day.exists) tx.create(root, { initialized: true });
                if (delta) tx.update(userRef, { points: Math.max(0, D.round(Number(user.data().points || 0) + delta)) });
                return { report: data.report, delta };
            });
        }),
        adjustUserPoints: callable.onCall(async (data, context) => {
            const who = coordinator(context);
            if (!Number.isFinite(data.delta) || Math.abs(data.delta) > 10000 || !/^[a-z0-9._-]+$/i.test(data.uid || '') || !/^[a-zA-Z0-9_-]{16,128}$/.test(data.operationId || '')) throw new functions.https.HttpsError('invalid-argument', 'Cambio inválido');
            return db.runTransaction(async tx => {
                const receipt = db.doc(`operations/${D.hash(`${who.authUid}:${data.operationId}`)}`);
                const fingerprint = D.hash(JSON.stringify([data.uid, data.delta]));
                const previous = await tx.get(receipt);
                if (previous.exists) {
                    if (previous.data().fingerprint !== fingerprint) throw new functions.https.HttpsError('already-exists', 'Operación reutilizada');
                    return { replay: true };
                }
                const ref = db.doc(`users/${data.uid}`); const user = await tx.get(ref);
                if (!user.exists) throw new functions.https.HttpsError('not-found', 'Usuario no encontrado');
                tx.update(ref, { points: Math.max(0, D.round(Number(user.data().points || 0) + data.delta)) });
                tx.create(receipt, { fingerprint, createdAt: Timestamp.now() });
                return { replay: false };
            });
        }),
        setGroupAttendance: callable.onCall(async (data, context) => {
            const who = service.actor(context);
            if (!['admin', 'tec', 'coordi', 'mae'].includes(who.role) || typeof data.id !== 'string' || data.id.includes('/') || !/^[a-z0-9._-]+$/i.test(data.uid || '') || typeof data.present !== 'boolean') throw new functions.https.HttpsError('permission-denied', 'Asistencia no permitida');
            return db.runTransaction(async tx => {
                const ref = db.doc(`announcements/${data.id}`); const snap = await tx.get(ref);
                if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Anuncio no encontrado');
                const record = snap.data();
                if (who.role === 'mae' && !(record.maesAsignados || []).some(m => m.uid === who.uid && m.assigned !== false)) throw new functions.https.HttpsError('permission-denied', 'No estás asignado a esta asesoría');
                if (!record.preregister?.[data.uid]) throw new functions.https.HttpsError('failed-precondition', 'El estudiante no está registrado');
                const award = data.present && record.pointsAwarded !== true;
                const peers = award ? [...new Set((record.maesAsignados || []).filter(m => m.uid && m.assigned !== false).map(m => m.uid))] : [];
                const users = [];
                for (const uid of peers) {
                    if (!/^[a-z0-9._-]+$/i.test(uid)) throw new functions.https.HttpsError('invalid-argument', 'MAE inválido');
                    const user = await tx.get(db.doc(`users/${uid}`));
                    if (!user.exists) throw new functions.https.HttpsError('not-found', 'MAE no encontrado');
                    users.push(user);
                }
                for (const user of users) tx.update(user.ref, { points: D.round(Number(user.data().points || 0) + 20) });
                tx.update(ref, { asistence: { ...(record.asistence || {}), [data.uid]: data.present },
                    ...(award && peers.length ? { pointsAwarded: true, pointsAwardedTo: peers, pointsAwardedAt: Timestamp.now() } : {}) });
                return { present: data.present };
            });
        }),
        endActiveSession: callable.onCall(async (data, context) => {
            const who = service.actor(context);
            if (data.uid !== who.uid) throw new functions.https.HttpsError('permission-denied', 'Sesión ajena');
            return db.runTransaction(async tx => {
                const ref = db.doc(`users/${who.uid}`); const snap = await tx.get(ref); const user = snap.data();
                if (!user?.activeSession) return { activeSessionDeleted: true, differenceInMinutes: 0, totalTime: user?.totalTime || 0 };
                const minutes = Math.max(0, Math.floor((Date.now() - user.activeSession.startTime.toMillis()) / 60000));
                const totalTime = Number(user.totalTime || 0) + (minutes <= 310 ? minutes : 0);
                tx.update(ref, { totalTime, activeSession: FieldValue.delete() });
                return { activeSessionDeleted: true, timeLimitExceded: minutes > 310, differenceInMinutes: minutes, totalTime };
            });
        }),
        addServiceTime: callable.onCall(async (data, context) => {
            coordinator(context);
            if (!/^[a-z0-9._-]+$/i.test(data.uid || '') || !Number.isFinite(data.minutes) || data.minutes < 0 || data.minutes > 18000) throw new functions.https.HttpsError('invalid-argument', 'Tiempo inválido');
            await db.doc(`users/${data.uid}`).update({ totalTime: FieldValue.increment(data.minutes) });
            return { updated: true };
        }),
        purchaseBackground: callable.onCall(async (data, context) => {
            const who = service.actor(context);
            if (data.uid !== who.uid || !/^[1-8]$/.test(String(data.backgroundId))) throw new functions.https.HttpsError('permission-denied', 'Fondo inválido');
            return db.runTransaction(async tx => {
                const ref = db.doc(`users/${who.uid}`); const snap = await tx.get(ref);
                if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Usuario no encontrado');
                const user = snap.data(); const background = user.background || [];
                const target = background.find(item => String(item.id) === String(data.backgroundId));
                if (!target) throw new functions.https.HttpsError('not-found', 'Fondo no disponible');
                if (target.bought) return { replay: true };
                const prices = [0, 25, 25, 25, 50, 50, 75, 100];
                const price = prices[Number(data.backgroundId)-1];
                if (Number(user.points || 0) - Number(user.useCoins || 0) < price) throw new functions.https.HttpsError('failed-precondition', 'Monedas insuficientes');
                tx.update(ref, { useCoins: Number(user.useCoins || 0) + price, background: background.map(item => String(item.id) === String(data.backgroundId) ? { ...item, bought: true } : item) });
                return { replay: false };
            });
        }),
        awardBadges, awardLeaderBadge
    };
}
module.exports = { createCostApi };
