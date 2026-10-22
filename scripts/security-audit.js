// security-audit.js — pentest del modelo de custom claims contra emuladores
//
// Usa el SDK de cliente de Firebase (firebase/firestore, firebase/auth) que SÍ
// respeta las reglas de seguridad (a diferencia del Admin SDK que las bypassa).
// Conecta a los emuladores en localhost y prueba los vectores de ataque clave.
//
// Requisito: `firebase emulators:start` corriendo Y seed ejecutado
//            (admin@tec.mx, mae@tec.mx, user@tec.mx, coordi@tec.mx, todos password123).
//
// Uso (desde la raíz):
//   node scripts/security-audit.js

const { initializeApp } = require('firebase/app');
const {
    getAuth, connectAuthEmulator, signInWithEmailAndPassword,
    signOut, setPersistence, inMemoryPersistence
} = require('firebase/auth');
const {
    getFirestore, connectFirestoreEmulator,
    doc, getDoc, setDoc, updateDoc, deleteDoc
} = require('firebase/firestore');

const firebaseConfig = {
    apiKey: 'fake-api-key',
    authDomain: 'peer-teaching.firebaseapp.com',
    projectId: 'peer-teaching'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

connectAuthEmulator(auth, 'http://localhost:9099');
connectFirestoreEmulator(db, 'localhost', 8080);
setPersistence(auth, inMemoryPersistence);

async function login(email, password) {
    await signOut(auth).catch(() => {});
    return signInWithEmailAndPassword(auth, email, password);
}

// Espera que una operación devuelva 'ALLOW' (exito) o 'DENY' (rechazo por regla).
async function attempt(label, fn) {
    try {
        await fn();
        return { label, result: 'ALLOW' };
    } catch (e) {
        // Código de Firestore para permiso denegado por reglas.
        if (e.code === 'permission-denied' || e.code === 'failed-precondition') {
            return { label, result: 'DENY', error: e.code };
        }
        return { label, result: 'OTHER', error: e.message };
    }
}

async function main() {
    const results = [];

    // ---- 1. Un usuario 'user' NO debe poder escalar su propio rol ----
    const userCred = await login('user@tec.mx', 'password123');
    const userUid = userCred.user.uid;
    const userDocId = 'user'; // doc claveado por prefijo de email

    results.push(await attempt(
        '[user] cambiar su propio role a admin (updateDoc)',
        () => updateDoc(doc(db, 'users', userDocId), { role: 'admin' })
    ));
    results.push(await attempt(
        '[user] cambiar points/totalTime de su doc (campos protegidos)',
        () => updateDoc(doc(db, 'users', userDocId), { points: 99999 })
    ));
    results.push(await attempt(
        '[user] crear un doc users/arbitrario con role admin',
        () => setDoc(doc(db, 'users', 'hacker'), { email: 'hacker@tec.mx', role: 'admin', status: 'estudiante' })
    ));
    results.push(await attempt(
        '[user] borrar un doc de usuario',
        () => deleteDoc(doc(db, 'users', 'admin'))
    ));

    // ---- 2. Un usuario 'user' NO debe poder tocar colecciones admin ----
    results.push(await attempt(
        '[user] escribir en announcements',
        () => setDoc(doc(db, 'announcements', 'test'), { title: 'x' })
    ));
    results.push(await attempt(
        '[user] escribir en attendance',
        () => setDoc(doc(db, 'attendance', '2026-09-09'), { initialized: true })
    ));
    results.push(await attempt(
        '[user] escribir en subjects (schools)',
        () => setDoc(doc(db, 'schools/tec.mx/subjects', 'TEST'), { id: 'TEST' })
    ));

    // ---- 3. Un 'mae' tampoco debe poder tocar admin ni escalar ----
    await login('mae@tec.mx', 'password123');
    results.push(await attempt(
        '[mae] cambiar su propio role a admin',
        () => updateDoc(doc(db, 'users', 'mae'), { role: 'admin' })
    ));
    results.push(await attempt(
        '[mae] escribir en announcements',
        () => setDoc(doc(db, 'announcements', 'test2'), { title: 'x' })
    ));

    // ---- 4. 'coordi' y 'admin' SÍ deben poder operar su alcance ----
    await login('coordi@tec.mx', 'password123');
    results.push(await attempt(
        '[coordi] escribir en announcements (debe permitirse)',
        () => setDoc(doc(db, 'announcements', 'coordi-test'), { title: 'x' })
    ));
    results.push(await attempt(
        '[coordi] escribir en attendance (debe permitirse)',
        () => setDoc(doc(db, 'attendance', '2026-09-09-c'), { initialized: true })
    ));
    results.push(await attempt(
        '[coordi] borrar usuario (no debe permitirse, solo admin)',
        () => deleteDoc(doc(db, 'users', 'user'))
    ));

    await login('admin@tec.mx', 'password123');
    results.push(await attempt(
        '[admin] borrar un usuario (debe permitirse)',
        () => deleteDoc(doc(db, 'users', 'coordi'))
    ));
    results.push(await attempt(
        '[admin] escribir en subjects (debe permitirse)',
        () => setDoc(doc(db, 'schools/tec.mx/subjects', 'ADMIN-TEST'), { id: 'ADMIN-TEST' })
    ));

    // ---- RESULTADO ----
    console.log('\n===== RESULTADOS =====\n');
    let issues = 0;
    for (const r of results) {
        const flag = r.result === 'OTHER' ? '???' : '';
        if (r.result === 'OTHER') issues += 1;
        console.log(`${r.result.padEnd(5)} ${flag} ${r.label}${r.error ? '  (' + r.error + ')' : ''}`);
    }
    console.log(`\nOperaciones con resultado inesperado (OTHER): ${issues}`);
    await signOut(auth).catch(() => {});
}

main().catch((e) => {
    console.error('Error ejecutando el audit (¿emuladores + seed listos?):', e.message);
    process.exit(1);
});