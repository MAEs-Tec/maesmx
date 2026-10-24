const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoleSynchronizer } = require('../role-sync');
const snapshot = role => ({ exists: role != null, data: () => ({ role, email: 'someone-else@tec.mx' }) });
function harness(roles, claims = { role: 'user', otherPermission: true }, error) {
    const calls = []; let reads = 0;
    const sync = createRoleSynchronizer({
        db: { collection: () => ({ doc: () => ({ get: async () => snapshot(roles[Math.min(reads++, roles.length - 1)]) }) }) },
        auth: {
            getUserByEmail: async email => { calls.push(['lookup', email]); if (error) throw error; return { uid: 'auth-id', customClaims: claims }; },
            setCustomUserClaims: async (uid, data) => { calls.push(['write', uid, data]); claims = data; }
        },
        logger: { info() {}, warn() {}, error() {} }
    });
    return { calls, run: (before = 'user', after = 'mae') => sync({ before: snapshot(before), after: snapshot(after) }, { params: { userId: 'a01723937' } }) };
}
test('promotion synchronizes claims while preserving other permissions', async () => {
    const h = harness(['mae']); await h.run();
    assert.deepEqual(h.calls, [['lookup', 'a01723937@tec.mx'], ['write', 'auth-id', { role: 'mae', otherPermission: true }]]);
});
test('publicidad receives its own role, not admin', async () => {
    const h = harness(['publi']); await h.run('mae', 'publi');
    assert.equal(h.calls[1][2].role, 'publi');
});
test('profile edits without role changes do not touch claims', async () => {
    const h = harness(['mae']); await h.run('mae', 'mae'); assert.equal(h.calls.length, 0);
});
test('duplicate event is idempotent', async () => {
    const h = harness(['mae'], { role: 'mae' }); await h.run(); assert.equal(h.calls.length, 1);
});
test('late events use current role, not the previous promotion', async () => {
    const h = harness(['user'], { role: 'admin' }); await h.run('user', 'admin');
    assert.equal(h.calls[1][2].role, 'user');
});
test('concurrent change is rechecked and applied', async () => {
    const h = harness(['mae', 'publi', 'publi', 'publi']); await h.run();
    assert.deepEqual(h.calls.filter(c => c[0] === 'write').map(c => c[2].role), ['mae', 'publi']);
});
test('deleting the profile removes privileged role', async () => {
    const h = harness([undefined], { role: 'mae' }); await h.run('mae', null);
    assert.equal(h.calls[1][2].role, 'user');
});
test('missing Auth account is reported without retrying indefinitely', async () => {
    const h = harness(['mae'], {}, { code: 'auth/user-not-found' }); await h.run(); assert.equal(h.calls.length, 1);
});
test('transient Auth failure propagates for retry', async () => {
    const h = harness(['mae'], {}, new Error('service unavailable')); await assert.rejects(h.run(), /service unavailable/);
});
test('unsupported roles are not granted', async () => {
    const h = harness(['superadmin']); await h.run('user', 'superadmin'); assert.equal(h.calls.length, 0);
});

const { createRoleInitializer, createOwnRoleClaimSync } = require('../role-sync');
function claimHarness(profileRole) {
    const writes = [];
    const db = { collection: () => ({ doc: () => ({ get: async () => snapshot(profileRole) }) }) };
    const auth = {
        getUser: async uid => ({ uid, customClaims: { role: 'user', otherPermission: true } }),
        setCustomUserClaims: async (uid, data) => writes.push([uid, data])
    };
    return { db, auth, writes };
}
test('new accounts keep the role of a profile created beforehand only when the email is verified', async () => {
    const h = claimHarness('coordi');
    await createRoleInitializer(h)({ uid: 'g', email: 'A01@tec.mx', emailVerified: true });
    await createRoleInitializer(h)({ uid: 'p', email: 'a01@tec.mx', emailVerified: false });
    assert.deepEqual(h.writes, [['g', { role: 'coordi' }], ['p', { role: 'user' }]]);
});
test('users can only sync their own claim to their profile role once verified', async () => {
    class HttpsError extends Error { constructor(code) { super(code); this.code = code; } }
    const h = claimHarness('coordi');
    const sync = createOwnRoleClaimSync({ ...h, HttpsError });
    await assert.rejects(sync({}, {}), error => error.code === 'unauthenticated');
    assert.deepEqual(await sync({ role: 'admin' }, { auth: { uid: 'p', token: { email: 'a01@tec.mx', email_verified: true, role: 'user' } } }), { role: 'coordi', changed: true });
    assert.deepEqual(h.writes, [['p', { role: 'coordi', otherPermission: true }]]);
    assert.deepEqual(await sync({}, { auth: { uid: 'p', token: { email: 'a01@tec.mx', email_verified: false, role: 'user' } } }), { role: 'user', changed: false });
});
