import assert from 'node:assert/strict';
import test from 'node:test';
import { MARK, configForPath, outputFormat, parseArgs, planAction, productionGuard, readEnvValue } from '../scripts/storage-tools/lib.mjs';

test('elige configuracion por ruta: foto de perfil y portadas', () => {
    assert.equal(configForPath('users/a@x.mx/photo').name, 'users');
    assert.equal(configForPath('announcements/Otro/x.png').name, 'announcements');
    assert.equal(configForPath('users/a@x.mx/otra.jpg'), null);
    assert.equal(configForPath('documents/AvisoPrivacidad.pdf'), null);
});

test('omite carpetas, rutas no configuradas, no imagenes y objetos ya marcados', () => {
    assert.equal(planAction({ name: 'announcements/', contentType: 'image/png' }).action, 'skip');
    assert.equal(planAction({ name: 'documents/a.pdf', contentType: 'image/png' }).action, 'skip');
    assert.equal(planAction({ name: 'users/a@x.mx/photo', contentType: 'application/pdf', size: 1e6 }).action, 'skip');
    const marked = { name: 'users/a@x.mx/photo', contentType: 'image/jpeg', size: 1e6, width: 2000, height: 2000, metadata: { optimizedBy: MARK } };
    assert.equal(planAction(marked).reason, 'ya optimizado');
    assert.equal(planAction({ ...marked, force: true }).action, 'recompress');
});

test('foto pequena con cacheControl correcto se omite; con otro cacheControl solo se actualiza cache', () => {
    const base = { name: 'users/a@x.mx/photo', contentType: 'image/jpeg', size: 20 * 1024, width: 320, height: 320 };
    assert.equal(planAction({ ...base, cacheControl: 'public, max-age=3600' }).action, 'skip');
    assert.equal(planAction({ ...base, cacheControl: undefined }).action, 'cache-only');
});

test('imagen grande se recomprime', () => {
    const plan = planAction({ name: 'announcements/Otro/1-x.png', contentType: 'image/png', size: 3 * 1024 * 1024, width: 3000, height: 2000 });
    assert.equal(plan.action, 'recompress');
    assert.equal(plan.cfg.maxW, 1280);
});

test('formato de salida: perfil siempre jpeg, portadas conservan formato', () => {
    assert.equal(outputFormat('image/png', { format: 'jpeg' }), 'jpeg');
    assert.equal(outputFormat('image/png', { format: 'keep' }), 'png');
    assert.equal(outputFormat('image/webp', { format: 'keep' }), 'webp');
    assert.equal(outputFormat('image/gif', { format: 'keep' }), null);
});

test('guarda de produccion: --apply sin bandera explicita sale con codigo 2', () => {
    assert.equal(productionGuard({ apply: true, iKnowProd: false, emulatorHost: '' }).code, 2);
    assert.equal(productionGuard({ apply: true, iKnowProd: true, emulatorHost: '' }), null);
    assert.equal(productionGuard({ apply: false, iKnowProd: false, emulatorHost: '' }), null);
    assert.equal(productionGuard({ apply: true, iKnowProd: false, emulatorHost: 'localhost:9199' }), null);
});

test('parseArgs: defaults dry-run y ambos prefijos; rechaza opciones y prefijos desconocidos', () => {
    const opts = parseArgs([]);
    assert.equal(opts.apply, false);
    assert.deepEqual(opts.prefixes, ['users/', 'announcements/']);
    assert.equal(opts.concurrency, 4);
    assert.equal(parseArgs(['--apply', '--i-know-this-is-prod', '--prefix', 'users/']).prefixes.length, 1);
    assert.throws(() => parseArgs(['--backup-bucket', 'otro']), /desconocida/);
    assert.throws(() => parseArgs(['--prefix', 'documents/']), /no soportado/);
    assert.throws(() => parseArgs(['--limit']), /Falta el valor/);
});

test('readEnvValue lee solo la clave pedida', () => {
    const env = 'VITE_FIREBASE_API_KEY=nope\nVITE_FIREBASE_STORAGE_BUCKET="peer-teaching.appspot.com"\n';
    assert.equal(readEnvValue(env, 'VITE_FIREBASE_STORAGE_BUCKET'), 'peer-teaching.appspot.com');
    assert.equal(readEnvValue(env, 'MISSING'), '');
});
