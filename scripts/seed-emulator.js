// Siembra los emuladores de Firebase con una base de prueba: cuentas por rol,
// catálogos, MAEs con horario, asesorías, anuncios, Maeteca, asistencia y
// solicitudes de asesoría. Todo es ficticio.
//
// Normalmente no se corre a mano: `npm run dev:local` lo ejecuta al arrancar.
// Con emuladores ya levantados (`npm run emulators`): `npm run seed`.
//
// Es seguro repetirlo: usa IDs fijos y sobrescribe los mismos documentos.
// Se niega a correr contra algo que no sea un emulador local.
const path = require('path');
const { createRequire } = require('module');
const { ROOT, PROJECT_ID, PORTS } = require('./lib/emulator-config');

// firebase-admin vive en functions/node_modules.
const requireFromFunctions = createRequire(path.join(ROOT, 'functions', 'package.json'));

process.env.FIRESTORE_EMULATOR_HOST ||= `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `127.0.0.1:${PORTS.auth}`;
const projectId = process.env.GCLOUD_PROJECT || PROJECT_ID;

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL_HOST.test(process.env[name])) {
        console.error(`[seed] ${name}=${process.env[name]} no es un emulador local. Cancelado.`);
        process.exit(1);
    }
}
if (!projectId.startsWith('demo-')) {
    console.error(`[seed] El proyecto "${projectId}" no empieza con "demo-". Cancelado.`);
    process.exit(1);
}

const admin = requireFromFunctions('firebase-admin');
const functions = requireFromFunctions('firebase-functions');
const { createAdvisoryService } = require(path.join(ROOT, 'functions', 'advisory-requests'));

admin.initializeApp({ projectId });
const db = admin.firestore();
const auth = admin.auth();
const { Timestamp } = admin.firestore;

const PASSWORD = 'password123';
const CAMPUS = 'MTY';

// ---------- fechas ----------
const now = new Date();
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const todayKey = DAY_KEYS[now.getDay()];
const pad = n => String(n).padStart(2, '0');
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const semesterStart = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1);

function daysFromNow(days, hour = 12, minute = 0) {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date;
}
// Las vistas cuentan por semestre: una fecha pasada nunca debe salirse del actual.
function pastInSemester(daysAgo, hour) {
    const date = daysFromNow(-daysAgo, hour);
    return Timestamp.fromDate(date < semesterStart ? new Date(semesterStart.getTime() + hour * 3600000) : date);
}
const ts = date => Timestamp.fromDate(date);

// ---------- catálogos ----------
const CAMPUSES = [
    { id: 'MTY', name: 'Monterrey' },
    { id: 'GDL', name: 'Guadalajara' },
    { id: 'CCM', name: 'Ciudad de México' }
];

const MAJORS = [
    { id: 'ITC', name: 'Ingeniería en Tecnologías Computacionales', school: 'Ingeniería y Ciencias' },
    { id: 'IMT', name: 'Ingeniería en Mecatrónica', school: 'Ingeniería y Ciencias' },
    { id: 'LAF', name: 'Licenciatura en Finanzas', school: 'Negocios' },
    { id: 'LNB', name: 'Licenciatura en Nutrición y Bienestar Integral', school: 'Salud' }
];

const SUBJECTS = [
    { id: 'MA1001', name: 'Cálculo de una variable', area: 'ING', semester: 1, top: true, intensiva: false },
    { id: 'MA1002', name: 'Álgebra lineal', area: 'ING', semester: 2, top: true, intensiva: false },
    { id: 'F1001', name: 'Física: movimiento y energía', area: 'ING', semester: 1, top: true, intensiva: false },
    { id: 'TC1001', name: 'Pensamiento computacional', area: 'ING', semester: 1, top: false, intensiva: false },
    { id: 'TC1031', name: 'Estructuras de datos', area: 'ING', semester: 3, top: false, intensiva: true },
    { id: 'Q1001', name: 'Química general', area: 'ING', semester: 1, top: false, intensiva: false },
    { id: 'CF1001', name: 'Contabilidad financiera', area: 'NEG', semester: 1, top: false, intensiva: false },
    { id: 'EC1001', name: 'Microeconomía', area: 'CIS', semester: 2, top: false, intensiva: false },
    { id: 'BT1001', name: 'Bioquímica', area: 'SLD', semester: 2, top: false, intensiva: false }
];
const subject = id => SUBJECTS.find(item => item.id === id);
const subjectRef = id => { const { name, area } = subject(id); return { id, name, area }; };

// Listas cerradas del perfil (mismas que src/firebase/db/users.js). El orden importa.
const BADGE_NAMES = [
    ['Mi primera asesoría', 'Da tu primera asesoría'], ['MAE aprendiz', 'Da 10 asesorías'],
    ['MAE en ascenso', 'Da 30 asesorías'], ['MAE destacado', 'Da 50 asesorías'],
    ['Super MAE', 'Da 100 asesorías'], ['Leyenda MAE', 'Da 200 asesorías'],
    ['MAE de MAEs', 'Da 500 asesorías'], ['Cambio de look', 'Añade una foto de perfil'],
    ['Trabajo bien hecho', 'Completa 80 horas'], ['Siempre a tiempo', 'Obtén asistencia perfecta durante 1 periodo'],
    ['Top MAE', 'Se #1 en el leaderboard'], ['MAE', 'Obtén el rol de MAE'],
    ['Coordi', 'Obtén el rol de coordi'], ['Tecnológico', 'Obtén el rol de tecnología'],
    ['Publicista', 'Obtén el rol de publicidad'], ['Especialista', 'Mete 3 materias top'],
    ['Trabajo de campo', 'Da 5 asesorías de materias top'], ['Ups...', 'Pierde puntos de experiencia una vez']
];
const badges = achieved => BADGE_NAMES.map(([name, description], index) => ({
    id: String(index + 1), name, description, image_url: `/assets/badges/${index + 1}.svg`, achieved: achieved.includes(index + 1)
}));
const BACKGROUND_PRICES = [0, 25, 25, 25, 50, 50, 75, 100];
const backgrounds = () => BACKGROUND_PRICES.map((price, index) => ({
    id: String(index + 1), image_url: `/assets/back/${index + 1}.svg`, bought: index === 0, price
}));
const ROLE_BADGE = { mae: 12, coordi: 13, tec: 14, publi: 15 };

// ---------- personas ----------
// La clave es una matrícula ficticia de 9 caracteres: es el ID del documento,
// el campo `uid` y el prefijo del correo.
const PEOPLE = [
    { key: 'a00000001', role: 'admin', firstname: 'Ana', lastname: 'Admin', career: 'ITC', status: 'becario', subjects: ['TC1001', 'TC1031'], days: ['monday', 'wednesday'], points: 180, minutes: 1500 },
    { key: 'a00000002', role: 'tec', firstname: 'Tomás', lastname: 'Tec', career: 'ITC', status: 'becario', subjects: ['TC1031', 'MA1002'], days: ['tuesday', 'thursday'], points: 140, minutes: 1200 },
    { key: 'a00000003', role: 'coordi', firstname: 'Carla', lastname: 'Coordi', career: 'IMT', status: 'becario', subjects: ['F1001', 'MA1001'], days: ['monday', 'friday'], points: 220, minutes: 2400 },
    { key: 'a00000004', role: 'mae', firstname: 'Mario', lastname: 'Mae', career: 'ITC', status: 'becario', subjects: ['MA1001', 'MA1002', 'F1001', 'TC1001'], days: ['monday', 'wednesday', 'friday'], points: 310, minutes: 3100, active: 'Biblioteca, piso 3, mesa 4' },
    { key: 'a00000005', role: 'publi', firstname: 'Paula', lastname: 'Publi', career: 'LAF', status: 'voluntario', subjects: ['CF1001', 'EC1001'], days: ['tuesday'], points: 60, minutes: 480 },
    { key: 'a00000006', role: 'user', firstname: 'Elena', lastname: 'Estudiante', career: 'ITC', status: 'estudiante' },
    { key: 'a00000007', role: 'mae', firstname: 'Diego', lastname: 'Derivadas', career: 'IMT', status: 'voluntario', subjects: ['MA1001', 'Q1001', 'F1001'], days: ['tuesday', 'thursday'], points: 250, minutes: 1900, active: 'https://itesm.zoom.us/j/0000000000' },
    { key: 'a00000008', role: 'mae', firstname: 'Sofía', lastname: 'Circuitos', career: 'IMT', status: 'becario', subjects: ['F1001', 'MA1002'], days: ['monday', 'thursday'], points: 95, minutes: 900 },
    { key: 'a00000009', role: 'mae', firstname: 'Luis', lastname: 'Balance', career: 'LAF', status: 'voluntario', subjects: ['CF1001', 'EC1001'], days: ['wednesday', 'friday'], points: 40, minutes: 360 },
    { key: 'a00000010', role: 'subjectCoordi', firstname: 'Valeria', lastname: 'Vectores', career: 'ITC', status: 'becario', subjects: ['MA1002', 'TC1031'], days: ['tuesday', 'friday'], points: 130, minutes: 1100 },
    { key: 'a00000011', role: 'mae', firstname: 'Nora', lastname: 'Nutrientes', career: 'LNB', status: 'voluntario', subjects: ['BT1001', 'Q1001'], days: ['monday', 'tuesday'], points: 20, minutes: 240 },
    { key: 'a00000012', role: 'user', firstname: 'Bruno', lastname: 'Becado', career: 'IMT', status: 'estudiante' }
];
const DIRECTORY_ROLES = ['mae', 'coordi', 'admin', 'subjectCoordi', 'publi', 'tec'];
const email = key => `${key}@tec.mx`;
const person = key => PEOPLE.find(item => item.key === key);
const fullName = p => `${p.firstname} ${p.lastname}`;
const major = id => MAJORS.find(item => item.id === id);
const directory = PEOPLE.filter(p => DIRECTORY_ROLES.includes(p.role));

const SLOTS = [['09:00', '11:00'], ['11:00', '13:00'], ['13:00', '15:00'], ['15:00', '17:00'], ['16:00', '18:00']];
function weekSchedule(p, index) {
    const schedule = {};
    p.days.forEach((day, i) => {
        const [start, end] = SLOTS[(index + i) % SLOTS.length];
        schedule[day] = [{ start, end }];
    });
    // Coordi y "MAEs de hoy" leen weekSchedule[hoy]: la mitad del directorio y quienes
    // tienen turno abierto tienen horario hoy, sea el día que sea.
    if ((index % 2 === 0 || p.active) && !schedule[todayKey]) {
        const hour = Math.min(Math.max(now.getHours(), 9), 16);
        schedule[todayKey] = [{ start: `${pad(hour)}:00`, end: `${pad(hour + 2)}:00` }];
    }
    return schedule;
}

function profileInfo(p) {
    return { uid: p.key, name: fullName(p), career: p.career, profilePictureUrl: '', area: major(p.career).school, campus: CAMPUS };
}

function userDoc(p, index) {
    const base = {
        uid: p.key, id: p.key, email: email(p.key),
        firstname: p.firstname, lastname: p.lastname, name: fullName(p),
        role: p.role, status: p.status, campus: CAMPUS,
        career: p.career, area: major(p.career).school, major: major(p.career)
    };
    if (!DIRECTORY_ROLES.includes(p.role)) {
        return { ...base, subjects: [], weekSchedule: {}, totalTime: 0 };
    }
    const achieved = [1, ROLE_BADGE[p.role], p.minutes >= 4800 ? 9 : null].filter(Boolean);
    const doc = {
        ...base,
        subjects: p.subjects.map(subject),
        weekSchedule: weekSchedule(p, index),
        totalTime: p.minutes, points: p.points, ratingBonusPoints: 0, useCoins: 0,
        badges: badges(achieved), background: backgrounds(), myBackground: '/assets/back/1.svg'
    };
    if (p.active) {
        // Turno iniciado hace 10 minutos: aparece como "activo" y puede ofrecer ayuda.
        doc.activeSession = { peerInfo: profileInfo(p), location: p.active, status: 'PENDING', startTime: ts(new Date(now.getTime() - 10 * 60000)) };
    }
    return doc;
}

// ---------- escritura ----------
async function seedCatalogs() {
    const batch = db.batch();
    for (const item of CAMPUSES) batch.set(db.doc(`schools/tec.mx/campus/${item.id}`), item);
    for (const item of MAJORS) batch.set(db.doc(`schools/tec.mx/majors/${item.id}`), item);
    for (const item of SUBJECTS) batch.set(db.doc(`schools/tec.mx/subjects/${item.id}`), item);
    await batch.commit();
    console.log(`[seed] Catálogos: ${CAMPUSES.length} campus, ${MAJORS.length} carreras, ${SUBJECTS.length} materias.`);
}

async function seedUsers() {
    // Primero los perfiles: si el emulador de Functions está activo, el trigger
    // de alta de cuenta toma el rol de aquí.
    const batch = db.batch();
    let index = 0;
    for (const p of PEOPLE) {
        batch.set(db.doc(`users/${p.key}`), userDoc(p, DIRECTORY_ROLES.includes(p.role) ? index++ : 0));
    }
    await batch.commit();

    for (const p of PEOPLE) {
        let account;
        try {
            account = await auth.getUserByEmail(email(p.key));
            await auth.updateUser(account.uid, { password: PASSWORD, emailVerified: true, displayName: fullName(p) });
        } catch (error) {
            if (error.code !== 'auth/user-not-found') throw error;
            account = await auth.createUser({ email: email(p.key), password: PASSWORD, emailVerified: true, displayName: fullName(p) });
        }
        await auth.setCustomUserClaims(account.uid, { role: p.role });
    }
    console.log(`[seed] Usuarios: ${PEOPLE.length} cuentas con perfil y rol.`);
}

async function seedAsesorias() {
    const students = PEOPLE.filter(p => p.role === 'user');
    const maes = directory.filter(p => p.subjects?.length);
    const comments = ['Muy clara la explicación.', 'Me ayudó a preparar el parcial.', 'Resolvimos todas mis dudas.', 'Explica con paciencia.'];
    const batch = db.batch();
    let count = 0;
    maes.forEach((mae, m) => {
        const total = mae.role === 'mae' ? 4 : 2;
        for (let i = 0; i < total; i++) {
            const student = students[(m + i) % students.length];
            const subjectId = mae.subjects[i % mae.subjects.length];
            const date = pastInSemester(2 + m * 3 + i * 5, 10 + (i % 6));
            // Una de cada cuatro queda pendiente de evaluar (rating null explícito).
            const pending = (m + i) % 4 === 3;
            batch.set(db.doc(`asesorias/seed-asesoria-${pad(++count)}`), {
                peerInfo: profileInfo(mae),
                userInfo: { ...profileInfo(student), role: student.role },
                subject: subjectRef(subjectId),
                date,
                rating: pending ? null : 5 - ((m + i) % 3),
                comment: pending ? '' : comments[(m + i) % comments.length],
                duplicate: false,
                pointsAwarded: 10, pointsReason: 'first_time_student', pointsSubjectId: subjectId, pointsAwardedAt: date
            });
        }
    });
    // Sin este documento "Mis evaluaciones" no muestra nada.
    batch.set(db.doc('asesorias/seed-reveal-config'), { _type: 'reveal_config', evaluationsRevealedAt: ts(now) });
    await batch.commit();
    console.log(`[seed] Asesorías: ${count} (con y sin evaluación).`);
}

async function seedAnnouncements() {
    const assigned = keys => keys.map(key => { const p = person(key); return { uid: p.key, name: fullName(p), career: p.career, campus: CAMPUS, area: major(p.career).school }; });
    const group = (days, subjectId, location, maes) => ({
        type: 'Asesoría', visible: true, createdAt: ts(now), imageUrl: '/assets/back/2.svg',
        subject: subjectRef(subjectId),
        dateTime: ts(daysFromNow(days, 0)), startTime: ts(daysFromNow(days, 16)), endTime: ts(daysFromNow(days, 18)),
        location, maesAsignados: assigned(maes), preregister: {}, asistence: {}
    });
    const items = {
        'seed-anuncio-bienvenida': {
            type: 'Otro', visible: true, createdAt: ts(now), imageUrl: '/assets/back/3.svg',
            title: 'Base de prueba', description: 'Estás viendo datos ficticios del emulador. Puedes modificar lo que quieras: se vuelven a sembrar en cada arranque.',
            maesAsignados: [], preregister: {}, asistence: {}
        },
        'seed-anuncio-grupal-1': group(1, 'MA1001', 'Aulas 4, salón 201', ['a00000004', 'a00000007']),
        'seed-anuncio-grupal-2': group(3, 'TC1031', 'Biblioteca, sala de estudio 2', ['a00000010']),
        // Ya pasó: aparece en "Asistencia grupales" para tomar lista.
        'seed-anuncio-grupal-pasada': { ...group(-2, 'F1001', 'Aulas 2, salón 105', ['a00000004']), visible: false }
    };
    const batch = db.batch();
    for (const [id, data] of Object.entries(items)) batch.set(db.doc(`announcements/${id}`), data);
    await batch.commit();
    console.log(`[seed] Anuncios: ${Object.keys(items).length}.`);
}

async function seedMaeteca() {
    const createdBy = { uid: 'a00000001', role: 'admin' };
    const base = { Carrera: 'all', createdBy, createdAt: ts(now), updatedAt: ts(now) };
    const items = {
        'intro-maeteca': { ...base, Tipo: 'video', Titulo: 'Bienvenida a la Maeteca', Informacion: 'Recurso principal de la Maeteca (dato de prueba).', Video: 'https://www.youtube.com/watch?v=WUvTyaaNkzM', Materia: 'general', Relacionado: ['maeteca'] },
        'seed-video-algebra': { ...base, Tipo: 'video', Titulo: 'Vectores, ¿qué son?', Informacion: 'Introducción visual a los vectores.', Video: 'https://www.youtube.com/watch?v=fNk_zzaMoSs', Materia: 'MA1002', Carrera: 'itc', Relacionado: ['álgebra'] },
        'seed-video-redes': { ...base, Tipo: 'video', Titulo: '¿Qué es una red neuronal?', Informacion: 'Explicación visual para empezar.', Video: 'https://www.youtube.com/watch?v=aircAruvnKk', Materia: 'TC1001', Carrera: 'itc', Relacionado: ['programación'] },
        'seed-pdf-ejemplo': { ...base, Tipo: 'pdf', Titulo: 'Formulario de ejemplo', Informacion: 'PDF de muestra para probar el visor.', Archivo: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', ArchivoPath: 'maeteca/seed-pdf-ejemplo/formulario.pdf', ArchivoNombre: 'formulario.pdf', Materia: 'MA1001', Relacionado: [] }
    };
    const batch = db.batch();
    for (const [id, data] of Object.entries(items)) batch.set(db.doc(`videos/${id}`), data);
    await batch.commit();
    console.log(`[seed] Maeteca: ${Object.keys(items).length} recursos.`);
}

async function seedAttendance() {
    const users = await db.collection('users').where('role', 'in', DIRECTORY_ROLES).get();
    const pattern = ['A', 'A', 'A', 'R', 'A', 'J', 'A', 'F'];
    const batch = db.batch();
    let count = 0;
    for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
        const date = daysFromNow(-daysAgo);
        const dayKey = DAY_KEYS[date.getDay()];
        const scheduled = users.docs.filter(doc => doc.data().weekSchedule?.[dayKey]);
        if (!scheduled.length) continue;
        batch.set(db.doc(`attendance/${dateKey(date)}`), { initialized: true });
        scheduled.forEach((doc, i) => {
            const data = doc.data();
            // Hoy todos tienen asistencia: así Coordi no marca faltas automáticas al abrir.
            const report = daysAgo === 0 ? 'A' : pattern[(daysAgo + i) % pattern.length];
            batch.set(db.doc(`attendance/${dateKey(date)}/report/${doc.id}`), { id: doc.id, report, email: data.email, name: data.name });
            count++;
        });
    }
    await batch.commit();
    console.log(`[seed] Asistencia: ${count} reportes en los últimos 15 días.`);
}

// Las solicitudes se crean con el mismo servicio que usan las Cloud Functions,
// para que el ID, el candado, los eventos y las notificaciones queden bien armados.
async function seedAdvisoryRequests() {
    const service = createAdvisoryService({ db, admin, functions });
    const context = key => ({ auth: { uid: `seed-${key}`, token: { email: email(key), email_verified: true, role: person(key).role } } });
    try {
        const withOffer = await service.createAdvisoryRequest(
            { operationId: 'seed-solicitud-1', subjectId: 'MA1001', topic: 'Dudas de límites antes del parcial.' }, context('a00000006'));
        await service.offerAdvisoryHelp({ requestId: withOffer.requestId, location: 'Biblioteca, piso 3, mesa 4' }, context('a00000004'));
        const open = await service.createAdvisoryRequest(
            { operationId: 'seed-solicitud-2', subjectId: 'F1001', topic: 'Ejercicios de conservación de la energía.' }, context('a00000012'));

        // Si el emulador de Functions no está corriendo, nadie reparte los avisos. Repetirlo no duplica.
        for (const requestId of [withOffer.requestId, open.requestId]) {
            const events = await db.collection(`advisoryRequests/${requestId}/events`).get();
            for (const event of events.docs) await service.dispatchEvent(event);
        }
        console.log('[seed] Solicitudes de asesoría: 2 abiertas (una con oferta de un MAE).');
    } catch (error) {
        // Pasa al resembrar sobre datos ya modificados a mano (p. ej. una solicitud que ya se cerró).
        console.warn(`[seed] Solicitudes de asesoría omitidas: ${error.message}`);
    }
}

async function main() {
    console.log(`[seed] Proyecto ${projectId}, Firestore ${process.env.FIRESTORE_EMULATOR_HOST}, Auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    await seedCatalogs();
    await seedUsers();
    await seedAsesorias();
    await seedAnnouncements();
    await seedMaeteca();
    await seedAttendance();
    await seedAdvisoryRequests();

    console.log(`\n[seed] Listo. Cuentas de prueba (contraseña: ${PASSWORD}):`);
    for (const p of PEOPLE) console.log(`  ${email(p.key).padEnd(20)} ${p.role.padEnd(14)} ${fullName(p)}`);
    console.log('');
}

main().then(() => process.exit(0)).catch(error => {
    console.error(`[seed] Error: ${error.message}`);
    console.error('[seed] ¿Están corriendo los emuladores? (npm run emulators, o usa npm run dev:local)');
    process.exit(1);
});
