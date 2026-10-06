const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Timestamp } = require('firebase-admin/firestore');

admin.initializeApp();
const db = admin.firestore();

// --- helpers de roles / autenticación ---
function assertAuthenticated(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
    }
}

function getRole(context) {
    return context.auth?.token?.role || 'user';
}

function assertRole(context, allowedRoles) {
    assertAuthenticated(context);
    const role = getRole(context);
    if (!allowedRoles.includes(role)) {
        throw new functions.https.HttpsError('permission-denied', `Role '${role}' is not allowed.`);
    }
}

function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new functions.https.HttpsError('invalid-argument', `${field} is required.`);
    }
    return value.trim();
}

// Al crear un usuario nuevo, asignar claim role: 'user'.
exports.initializeUserRoleClaim = functions.auth.user().onCreate(async (user) => {
    await admin.auth().setCustomUserClaims(user.uid, { role: 'user' });
});

// Función ADMIN explícita para sincronizar el claim de UN usuario desde Firestore.
// No es auto-reescritura: requiere rol admin para ejecutarse.
exports.syncRoleClaim = functions.https.onCall(async (data, context) => {
    assertRole(context, ['admin']);

    const email = requiredString(data.email, 'email').toLowerCase();

    const snap = await db.collection('users')
        .where('email', '==', email)
        .limit(1)
        .get();

    if (snap.empty) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
    }

    const role = snap.docs[0].data().role || 'user';
    const authUser = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(authUser.uid, { role });

    return { email, role };
});

// setUserMaeRole actualiza el doc Y el claim (sincronizado).
exports.setUserMaeRole = functions.https.onCall(async (data, context) => {
    assertRole(context, ['admin']);

    const matricula = requiredString(data.matricula, 'matricula').toLowerCase();
    const role = requiredString(data.role, 'role');
    const status = requiredString(data.status, 'status');
    const email = `${matricula}@tec.mx`;

    const snap = await db.collection('users').where('email', '==', email).get();
    if (snap.empty) return { updated: 0 };

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { role, status }));
    await batch.commit();

    try {
        const authUser = await admin.auth().getUserByEmail(email);
        await admin.auth().setCustomUserClaims(authUser.uid, { role });
    } catch (e) {
        console.warn(`No se pudo setear claim para ${email}: ${e.message}`);
    }

    return { updated: snap.size };
});

// firestore.rules solo permite escribir el campo `role` de users/{userId} a
// isTechAdmin(); este trigger es una red de seguridad para mantener el claim
// sincronizado si un admin edita el rol directamente en Firestore (p.ej. desde
// una vista admin que aún no usa syncRoleClaim/setUserMaeRole).
const { createRoleSynchronizer } = require('./role-sync');
const costApi = require('./cost-api').createCostApi({ db, admin, functions });
const synchronizeRole = createRoleSynchronizer({ db, auth: admin.auth(), logger: functions.logger });
for (const name of ['registerAdvisory', 'updateAdvisory', 'deleteAdvisory', 'setAttendance', 'adjustUserPoints', 'setGroupAttendance', 'endActiveSession', 'addServiceTime', 'purchaseBackground']) {
    exports[name] = costApi[name];
}
exports.syncUserRoleClaimOnWrite = functions.runWith({ failurePolicy: true })
    .firestore.document('users/{userId}')
    .onWrite(async (change, context) => {
        await synchronizeRole(change, context);
        const before = change.before.data() || {}; const after = change.after.data();
        if (!after) return;
        if (['role', 'photoURL', 'totalTime', 'points'].some(key => before[key] !== after[key])) await costApi.awardBadges(context.params.userId);
        if (before.points !== after.points) await costApi.awardLeaderBadge();
    });

// Se ejecuta automáticamente el día 1 de cada mes a las 00:00
exports.cleanupExpiredAnnouncements = functions.pubsub.schedule('0 0 1 * *').timeZone('America/Mexico_City').onRun(async () => {
    try {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const now = new Date(`${day}T00:00:00-06:00`);
      const announcementsRef = db.collection('announcements');

      // Buscar anuncios vencidos que aún están visibles
      // Filtramos por visible=true Y dateTime < ahora
      const query = announcementsRef
        .where('visible', '==', true)
        .where('dateTime', '<', Timestamp.fromDate(now));

      let count = 0;
      while (true) {
      const snapshot = await query.limit(450).get();

      if (snapshot.empty) {
        console.log('No announcements to delete');
        break;
      }
      //El batch es una escritura por lotes. Asi no son una por una
      const batch = db.batch();

      snapshot.docs.forEach(doc => {
        // Archive instead of destroying historical group attendance.
        batch.update(doc.ref, { visible: false });
        count++;
      });

      await batch.commit();
      }

      console.log(`Archived ${count} expired announcements`);
      return null;

    } catch (error) {
      console.error('Error cleaning up announcements:', error);
      throw error;
    }
});

const { cleanupImage } = require('./media-cleanup');
exports.cleanupAnnouncementImage = functions.https.onCall(async (data, context) => {
    assertRole(context, ['admin', 'tec', 'coordi', 'publi']);
    return cleanupImage({ db, bucket: admin.storage().bucket(), path: data.path });
});
exports.cleanupAnnouncementImageOnDelete = functions.runWith({ failurePolicy: true }).firestore.document('announcements/{id}').onDelete(snapshot =>
    cleanupImage({ db, bucket: admin.storage().bucket(), path: snapshot.data().imagePath }));

// Bonuses belong to the current semester. No advisory history is downloaded.
exports.rollSemesterBonuses = functions.pubsub.schedule('5 0 1 1,7 *').timeZone('America/Mexico_City').onRun(async () => {
    const D = require('./advisory-domain');
    const { FieldPath } = require('firebase-admin/firestore');
    let cursor;
    while (true) {
        let query = db.collection('users').where('role', 'in', D.MAE_ROLES).orderBy(FieldPath.documentId()).limit(100);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get(); if (page.empty) break;
        for (const user of page.docs) {
            await db.runTransaction(async tx => {
                const state = await tx.get(db.doc('settings/analytics'));
                if (!state.data()?.ready || state.data().maintenance) throw new Error('Analytics in maintenance');
                const current = await tx.get(user.ref);
                const stats = await tx.get(db.doc(`analytics/${state.data().activeVersion}/peers/${D.semester(new Date())}~${user.id}`));
                const next = D.bonus(stats.data()?.ratingSum || 0, stats.data()?.ratingCount || 0);
                const old = Number(current.data().ratingBonusPoints || 0);
                if (next !== old) tx.update(user.ref, { ratingBonusPoints: next, points: Math.max(0, D.round(Number(current.data().points || 0) + next - old)) });
            });
        }
        cursor = page.docs.at(-1);
    }
});
