const functions = require('firebase-functions');
const admin = require('firebase-admin');

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
exports.syncUserRoleClaimOnWrite = functions.runWith({ failurePolicy: true })
    .firestore.document('users/{userId}')
    .onWrite(createRoleSynchronizer({ db, auth: admin.auth(), logger: functions.logger }));

// Se ejecuta automáticamente el día 1 de cada mes a las 00:00
exports.cleanupExpiredAnnouncements = functions.pubsub.schedule('0 0 1 * *').timeZone('America/Mexico_City').onRun(async (context) => {
    try {
      const now = new Date();
      const announcementsRef = db.collection('announcements');

      // Buscar anuncios vencidos que aún están visibles
      // Filtramos por visible=true Y dateTime < ahora
      const query = announcementsRef
        .where('visible', '==', true)
        .where('dateTime', '<', admin.firestore.Timestamp.fromDate(now));

      const snapshot = await query.get();

      if (snapshot.empty) {
        console.log('No announcements to delete');
        return null;
      }
      //El batch es una escritura por lotes. Asi no son una por una
      const batch = db.batch();
      let count = 0;

      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        count++;
      });

      await batch.commit();

      console.log(`Successfully deleted ${count} expired announcements`);
      return null;

    } catch (error) {
      console.error('Error cleaning up announcements:', error);
      return null;
    }
});