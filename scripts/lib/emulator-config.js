// Configuración compartida del entorno local con emuladores.
// La usan scripts/dev-local.js y scripts/seed-emulator.js.
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const firebaseJson = require(path.join(ROOT, 'firebase.json'));

// Versión fija del CLI para que local y CI usen el mismo emulador.
const FIREBASE_TOOLS = 'firebase-tools@14.25.0';

// El prefijo "demo-" hace que los SDK nunca hablen con un proyecto real.
const PROJECT_ID = 'demo-maesmx';

const emulators = firebaseJson.emulators || {};
const PORTS = {
    auth: emulators.auth?.port || 9099,
    firestore: emulators.firestore?.port || 8080,
    functions: emulators.functions?.port || 5001,
    storage: emulators.storage?.port || 9199,
    ui: emulators.ui?.port || 4000,
    web: 5173
};

module.exports = { ROOT, FIREBASE_TOOLS, PROJECT_ID, PORTS };
