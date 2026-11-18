// Entorno local completo con un solo comando: `npm run dev:local`.
//
// Levanta los emuladores de Firebase (Auth, Firestore, Functions y Storage),
// siembra datos de prueba y abre el front conectado a ellos. Nada de esto toca
// producción: el proyecto es "demo-maesmx" y todo vive en memoria.
//
// Para ver el front con los datos de producción se usa `npm run dev`.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { ROOT, FIREBASE_TOOLS, PROJECT_ID, PORTS } = require('./lib/emulator-config');

function fail(message) {
    console.error(`\n[dev:local] ${message}\n`);
    process.exit(1);
}

function checkNode() {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) fail(`Se necesita Node 22 o superior (tienes ${process.versions.node}).`);
}

function checkJava() {
    // Si Java está instalado pero no en el PATH, basta con tener JAVA_HOME.
    if (process.env.JAVA_HOME) {
        process.env.PATH = `${path.join(process.env.JAVA_HOME, 'bin')}${path.delimiter}${process.env.PATH}`;
    }
    const result = spawnSync('java', ['-version'], { encoding: 'utf8', shell: true });
    if (result.error || result.status !== 0) {
        fail('No se encontró Java. Los emuladores de Firebase lo necesitan: instala un JDK 21 (por ejemplo Temurin) y abre una terminal nueva.\nSi ya lo tienes instalado, agrégalo al PATH o define JAVA_HOME.');
    }
    const version = /version "(\d+)/.exec(`${result.stderr}${result.stdout}`);
    if (version && Number(version[1]) < 21) {
        console.warn(`[dev:local] Tienes Java ${version[1]}; el pipeline usa Java 21. Si los emuladores no arrancan, actualízalo.`);
    }
}

function ensureFunctionsDeps() {
    if (fs.existsSync(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'))) return;
    console.log('[dev:local] Instalando dependencias de functions/ (solo la primera vez)...');
    const result = spawnSync('npm', ['ci', '--prefix', 'functions'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (result.status !== 0) fail('No se pudieron instalar las dependencias de functions/.');
}

function portInUse(port) {
    return new Promise(resolve => {
        const socket = net.connect({ port, host: '127.0.0.1' });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
    });
}

async function checkPorts() {
    const busy = [];
    for (const [name, port] of Object.entries(PORTS)) {
        if (await portInUse(port)) busy.push(`${port} (${name})`);
    }
    if (busy.length) {
        fail(`Estos puertos ya están en uso: ${busy.join(', ')}.\nCierra lo que los ocupa (quizá otros emuladores u otro "npm run dev") y vuelve a intentar.`);
    }
}

// Variables del front en modo emulador. Se leen de .env.emulator y se pasan por
// el entorno del proceso, que en Vite gana sobre cualquier archivo .env local.
function emulatorEnv() {
    const env = {};
    const file = fs.readFileSync(path.join(ROOT, '.env.emulator'), 'utf8');
    for (const line of file.split(/\r?\n/)) {
        const match = /^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (match) env[match[1]] = match[2];
    }
    return env;
}

async function main() {
    checkNode();
    checkJava();
    ensureFunctionsDeps();
    await checkPorts();

    const inner = `node scripts/seed-emulator.js && npx vite --mode emulator --port ${PORTS.web} --strictPort`;
    const command = `npx --yes ${FIREBASE_TOOLS} emulators:exec --project ${PROJECT_ID} --only auth,firestore,functions,storage --ui "${inner}"`;

    console.log('[dev:local] Levantando emuladores, sembrando datos y abriendo el front.');
    console.log(`[dev:local] App:        http://localhost:${PORTS.web}`);
    console.log(`[dev:local] Emuladores: http://127.0.0.1:${PORTS.ui}`);
    console.log('[dev:local] Ctrl+C lo apaga todo. Los datos se vuelven a sembrar en cada arranque.\n');

    const child = spawn(command, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...emulatorEnv(), GCLOUD_PROJECT: PROJECT_ID }
    });
    // Ctrl+C llega a todo el grupo de procesos; aquí solo se espera a que el CLI cierre los emuladores.
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    child.on('exit', code => process.exit(code ?? 0));
}

main().catch(error => fail(error.message));
