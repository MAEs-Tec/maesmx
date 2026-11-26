import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// https://vitejs.dev/config/
// Con VITE_EMULATOR_PROXY=true el servidor de desarrollo reenvía Firestore, Auth, Storage y Functions
// a los emuladores locales, para abrir la app por un túnel HTTPS (ver main.js).
const firestoreEmulator = { target: 'http://127.0.0.1:8080', changeOrigin: true };
const authEmulator = { target: 'http://127.0.0.1:9099', changeOrigin: true };
const emulatorProxy = {
    '/google.firestore.v1.Firestore': firestoreEmulator,
    '/v1/projects': firestoreEmulator,
    '/identitytoolkit.googleapis.com': authEmulator,
    '/securetoken.googleapis.com': authEmulator,
    '/emulator': authEmulator,
    '/v0': { target: 'http://127.0.0.1:9199', changeOrigin: true },
    '/functions-emulator': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/functions-emulator/, '')
    }
};

export default defineConfig(() => {
    return {
        plugins: [vue()],
        // En modo proxy se acepta cualquier Host porque la app llega por el dominio del túnel.
        server: process.env.VITE_EMULATOR_PROXY === 'true' ? { proxy: emulatorProxy, allowedHosts: true } : {},
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url))
            }
        }
    };
});
