// seed-emulator.js
//
// Puebla los emuladores con un admin + usuarios de prueba para validar el
// flujo de custom claims SIN tocar producción.
//
// Requisito: `firebase emulators:start` corriendo antes.
//
// Uso (desde la raíz del repo):
//
//   NODE_PATH=functions/node_modules node scripts/seed-emulator.js
//
// Lo que crea:
//   - Admin:      admin@tec.mx  / password123  (claim role = admin)
//   - Coordi:     coordi@tec.mx / password123  (claim role = coordi)
//   - MAE:        mae@tec.mx    / password123  (claim role = mae)
//   - Estudiante: user@tec.mx   / password123  (claim role = user)
//   - Doc de Firestore `users/{prefijo}` para cada uno (email + role).

const admin = require('firebase-admin');

// Apuntar al emulador de Firestore y Auth.
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

admin.initializeApp({ projectId: 'peer-teaching' });
const db = admin.firestore();
const auth = admin.auth();

const USERS = [
    { email: 'admin@tec.mx', password: 'password123', role: 'admin', name: 'Admin Local' },
    { email: 'coordi@tec.mx', password: 'password123', role: 'coordi', name: 'Coordi Local' },
    { email: 'mae@tec.mx', password: 'password123', role: 'mae', name: 'MAE Local' },
    { email: 'user@tec.mx', password: 'password123', role: 'user', name: 'Estudiante Local' }
];

const uidPrefix = (email) => email.split('@')[0];

async function main() {
    for (const u of USERS) {
        // Crear en Auth (idempotente).
        let authUser;
        try {
            authUser = await auth.getUserByEmail(u.email);
            console.log(`Auth ya existe: ${u.email}`);
        } catch (e) {
            authUser = await auth.createUser({
                email: u.email,
                password: u.password,
                emailVerified: true
            });
            console.log(`Auth creado: ${u.email}`);
        }

        // Setear custom claim.
        await auth.setCustomUserClaims(authUser.uid, { role: u.role });
        console.log(`  claim role = ${u.role} para ${u.email} (uid ${authUser.uid})`);

        // Crear doc de Firestore (el sistema lo clavea por el prefijo del email).
        const id = uidPrefix(u.email);
        await db.doc(`users/${id}`).set({
            uid: id,
            email: u.email,
            name: u.name,
            role: u.role,
            status: u.role === 'user' ? 'estudiante' : 'activo'
        });
        console.log(`  Firestore users/${id} creado`);
    }

    console.log('\nListo. Credenciales de prueba:');
    USERS.forEach((u) => console.log(`  ${u.email} / ${u.password}  (${u.role})`));
    console.log('\nEn Producción los usuarios reales se migran con scripts/migrate-role-claims.js.');
}

main().catch((e) => {
    console.error('Error (¿firebase emulators:start está corriendo?):', e.message);
    process.exit(1);
});