// migrate-role-claims.js
//
// Setea el custom claim `role` en Firebase Auth para TODOS los usuarios
// existentes de Firestore, leyendo el valor del campo `role` de cada doc.
//
// Uso (desde la raíz del repo maesmx):
//
//   GOOGLE_APPLICATION_CREDENTIALS="C:\Users\adolf\Downloads\peer-teaching-firebase-adminsdk-ik5zh-9d0f0e4335.json" \
//   NODE_PATH=functions/node_modules node scripts/migrate-role-claims.js --dry-run
//
//   # sin --dry-run escribe de verdad
//   GOOGLE_APPLICATION_CREDENTIALS="..." NODE_PATH=functions/node_modules \
//   node scripts/migrate-role-claims.js

const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'peer-teaching';
const DRY_RUN = process.argv.includes('--dry-run');

// Roles válidos según src/auth/roles.js (ROLES).
const KNOWN_ROLES = new Set([
    'admin', 'tec', 'coordi', 'subjectCoordi', 'mae', 'publi', 'user', 'exmae'
]);

if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

async function main() {
    const snap = await db.collection('users').get();
    let updated = 0;
    let skipped = 0;
    const failures = [];
    const unknownRoles = new Map();

    for (const doc of snap.docs) {
        const data = doc.data();
        const email = typeof data.email === 'string' ? data.email.toLowerCase() : null;
        const role = data.role || 'user';

        if (!email) {
            skipped += 1;
            continue;
        }

        if (!KNOWN_ROLES.has(role)) {
            unknownRoles.set(role, (unknownRoles.get(role) || 0) + 1);
        }

        try {
            if (DRY_RUN) {
                console.log(`[dry-run] ${email} -> ${role}`);
                updated += 1;
                continue;
            }

            const authUser = await admin.auth().getUserByEmail(email);
            await admin.auth().setCustomUserClaims(authUser.uid, { role });
            updated += 1;
            console.log(`OK ${email} -> ${role}`);
        } catch (e) {
            failures.push(`${email}: ${e.message}`);
        }
    }

    console.log(`\nResumen: ${updated} procesados, ${skipped} sin email, ${failures.length} fallos.`);
    if (unknownRoles.size) {
        console.log('\nATENCION - roles NO reconocidos encontrados en los datos (se escribieron tal cual):');
        unknownRoles.forEach((count, role) => console.log(`  "${role}": ${count} usuario(s)`));
    }
    if (failures.length) {
        failures.forEach((f) => console.log('FALLO', f));
    }
    process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});