import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseJs } from '@babel/parser';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function exportedFunction(source, name, services) {
    const node = parseJs(source, { sourceType: 'module' }).program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === name);
    return new Function(...Object.keys(services), `return ${source.slice(node.declaration.start, node.declaration.end)}`)(...Object.values(services));
}
function roleEditor(record, overrides = {}) {
    const writes = [];
    const lookups = [];
    const services = {
        getUserRecordByUid: async uid => { lookups.push(uid); return record; },
        firestoreDB: {}, collection: () => ({}), where: () => ({}), query: () => ({}),
        getDocs: async () => ({ size: 0, docs: [] }),
        updateDoc: async (ref, updates) => { writes.push({ ref, updates }); },
        invalidateUserCaches: async () => {}, ...overrides
    };
    return { update: exportedFunction(read('../src/firebase/db/users.js'), 'updateUserToMae', services), writes, lookups };
}
const input = { matricula: ' A01412408 ', role: { value: 'publi' }, status: { value: 'becario' } };

test('normalizes matrícula and changes only role and status for an existing MAE', async () => {
    const data = { uid: 'a01412408', role: 'mae', weekSchedule: {}, subjects: [], badges: [], background: [], points: 230, totalTime: 120, useCoins: 2 };
    const h = roleEditor({ ref: 'users/a01412408', data });
    assert.deepEqual(await h.update(input), { uid: data.uid, role: 'publi', status: 'becario' });
    assert.deepEqual(h.lookups, ['a01412408']);
    assert.deepEqual(h.writes[0].updates, { role: 'publi', status: 'becario' });
});

test('promotion initializes missing fields but preserves earlier service and achievements', async () => {
    const h = roleEditor({ ref: 'user', data: { role: 'user', totalTime: 120, points: 25, badges: [{ achieved: true }] } });
    await h.update({ ...input, role: 'coordi', status: 'voluntario' });
    assert.equal(h.writes[0].updates.role, 'coordi');
    assert.deepEqual(h.writes[0].updates.weekSchedule, {});
    for (const key of ['totalTime', 'points', 'badges']) assert.equal(key in h.writes[0].updates, false);
});

test('missing account rejects instead of reporting success', async () => {
    const h = roleEditor(null);
    await assert.rejects(h.update(input), /No se encontró la cuenta/);
    assert.equal(h.writes.length, 0);
});

test('write permission errors reach the form', async () => {
    const denied = Object.assign(new Error('Denied'), { code: 'permission-denied' });
    const h = roleEditor({ ref: 'user', data: {} }, { updateDoc: async () => { throw denied; } });
    await assert.rejects(h.update(input), error => error === denied);
});

test('legacy email lookup writes the actual document reference', async () => {
    const h = roleEditor(null, { getDocs: async () => ({ size: 1, docs: [{ ref: 'legacy-id', data: () => ({ uid: 'a01412408' }) }] }) });
    await h.update(input);
    assert.equal(h.writes[0].ref, 'legacy-id');
});

test('invalid roles, statuses and matriculas never write', async () => {
    for (const changes of [{ matricula: 'A00001' }, { role: 'admin' }, { status: 'invalid' }]) {
        const h = roleEditor(null);
        await assert.rejects(h.update({ ...input, ...changes }));
        assert.equal(h.lookups.length, 0);
        assert.equal(h.writes.length, 0);
    }
});

// Nota de merge (dev -> custom-claims): se retiraron de aquí las pruebas de
// `subscribeCurrentUserRole` (src/firebase/db/currentUserRole.js), del menú
// basado en esa suscripción y del guard de router basado en `getCurrentUser`.
// Ese modelo (rol fuente de verdad en Firestore, leído en vivo) se descartó
// al fusionar: `custom-claims` usa el custom claim del JWT (getClaimsRole) como
// fuente de verdad, vía AppMenu.vue y router/index.js ya existentes en esta rama.
