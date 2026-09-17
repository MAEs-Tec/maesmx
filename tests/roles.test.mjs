import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseJs } from '@babel/parser';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref } from 'vue';

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

function roleSubscription() {
    let authCallback;
    let authStopped = false;
    const listeners = [];
    const changes = [];
    const errors = [];
    const services = {
        getAuth: () => ({}), firestoreDB: {},
        onAuthStateChanged: (_, callback) => { authCallback = callback; return () => { authStopped = true; }; },
        doc: (_, collection, uid) => `${collection}/${uid}`,
        onSnapshot: (path, next, error) => {
            const listener = { path, next, error, stopped: false }; listeners.push(listener);
            return () => { listener.stopped = true; };
        },
        invalidateCacheTags: async () => {}, CACHE_TAGS: {}, userTag: uid => uid
    };
    const subscribe = exportedFunction(read('../src/firebase/db/currentUserRole.js'), 'subscribeCurrentUserRole', services);
    const stop = subscribe(value => changes.push(value), error => errors.push(error));
    return { login: user => authCallback(user), listeners, changes, errors, stop, authStopped: () => authStopped };
}
const snapshot = role => ({ exists: () => true, data: () => ({ role }) });

test('live subscription delivers role changes without signing out', () => {
    const h = roleSubscription(); h.login({ email: 'A01412408@tec.mx' });
    assert.equal(h.listeners[0].path, 'users/a01412408');
    h.listeners[0].next(snapshot('user'));
    h.listeners[0].next(snapshot('publi'));
    assert.deepEqual(h.changes.slice(-2).map(x => x.role), ['user', 'publi']);
    h.stop(); assert.ok(h.authStopped()); assert.ok(h.listeners[0].stopped);
});

test('signout clears menus and ignores callbacks from an older session', () => {
    const h = roleSubscription(); h.login({ email: 'a01412408@tec.mx' });
    h.login(null); h.listeners[0].next(snapshot('admin'));
    assert.equal(h.changes.at(-1), null);
    assert.ok(h.listeners[0].stopped);
});

test('listener errors remove stale permissions and are reported', () => {
    const h = roleSubscription(); h.login({ email: 'a01412408@tec.mx' });
    h.listeners[0].next(snapshot('publi'));
    h.listeners[0].error(new Error('denied'));
    assert.equal(h.changes.at(-1), null);
    assert.equal(h.errors.length, 1);
});

test('menu switches between student, Publicidad and Coordi without duplicated groups', () => {
    const { descriptor } = parse(read('../src/layout/AppMenu.vue'));
    let source = compileScript(descriptor, { id: 'menu-test' }).content;
    const imports = parseJs(source, { sourceType: 'module' }).program.body.filter(node => node.type === 'ImportDeclaration');
    const names = imports.flatMap(node => node.specifiers.map(specifier => specifier.local.name));
    for (const node of [...imports].reverse()) source = source.slice(0, node.start) + source.slice(node.end);
    source = source.replaceAll('import.meta.env.DEV', 'false').replaceAll('import.meta.env.VITE_DEV_ALL_ROLES', 'false');
    const services = { ref, onMounted: () => {}, onUnmounted: () => {}, subscribeCurrentUserRole: () => {}, AppMenuItem: {} };
    const component = new Function(...names, source.replace('export default', 'return'))(...names.map(name => services[name]));
    const state = component.setup({}, { expose() {} });
    const labels = () => state.model.value.map(item => item.label);
    state.updateMenu({ uid: 'test', role: 'user' }); assert.deepEqual(labels(), ['Estudiante']);
    for (let i = 0; i < 2; i++) state.updateMenu({ uid: 'test', role: 'publi' });
    assert.deepEqual(labels(), ['Estudiante', 'MAE', 'Publicidad']);
    assert.equal(state.model.value.at(-1).items[0].to, '/gestionAnuncios');
    state.updateMenu({ uid: 'test', role: 'coordi' }); assert.deepEqual(labels(), ['Estudiante', 'MAE', 'Coordi']);
    state.updateMenu({ uid: 'test', role: 'user' }); assert.deepEqual(labels(), ['Estudiante']);
});

async function routeDecision(profile, shouldFail = false) {
    const source = read('../src/router/index.js');
    const call = parseJs(source, { sourceType: 'module' }).program.body.find(node => node.type === 'ExpressionStatement' && node.expression?.callee?.property?.name === 'beforeEach').expression;
    let readOptions;
    const guard = new Function('getAuth', 'onAuthStateChanged', 'getCurrentUser', 'DEV_ALL_ROLES', `return ${source.slice(call.arguments[0].start, call.arguments[0].end)}`)(
        () => ({}),
        (_, callback) => { queueMicrotask(() => callback({ email: 'test@tec.mx' })); return () => {}; },
        async options => { readOptions = options; if (shouldFail) throw new Error('offline'); return profile; },
        false
    );
    const destination = await new Promise(resolve => guard({ matched: [{ meta: { requiresAuth: true } }], meta: { roles: ['admin', 'coordi', 'tec', 'publi'] } }, {}, resolve));
    return { destination, readOptions };
}

test('route guard reads fresh permissions and allows Publicidad to manage announcements', async () => {
    const result = await routeDecision({ role: 'publi' });
    assert.deepEqual(result.readOptions, { forceRefresh: true });
    assert.equal(result.destination, undefined);
});

test('route guard rejects a revoked role and handles a missing account', async () => {
    assert.equal((await routeDecision({ role: 'user' })).destination, '/pages/notfound');
    assert.equal((await routeDecision(null)).destination, '/auth/login');
});

test('route guard resolves navigation when the permission read fails', async () => {
    assert.equal((await routeDecision(null, true)).destination, '/auth/error');
});
