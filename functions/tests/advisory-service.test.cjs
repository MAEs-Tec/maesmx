const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../advisory-domain');
const { createAdvisoryService } = require('../advisory-service');
class Timestamp {
    constructor(ms) { this.ms = ms; }
    toMillis() { return this.ms; }
    toDate() { return new Date(this.ms); }
    static now() { return new Timestamp(Date.now()); }
    static fromDate(date) { return new Timestamp(date.getTime()); }
}
function clone(value) {
    if (value instanceof Timestamp) return new Timestamp(value.ms);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    return value;
}
function memoryDb() {
    const rows = new Map(); let queue = Promise.resolve();
    const doc = path => ({ path, collection: name => collection(`${path}/${name}`) });
    const collection = (path, filters = [], order = null, maximum = Infinity) => ({ path, filters, order, maximum,
        doc: id => doc(`${path}/${id}`), where: (field, op, value) => collection(path, [...filters, [field, op, value]], order, maximum),
        orderBy: (field, direction) => collection(path, filters, [field, direction], maximum), limit: n => collection(path, filters, order, n) });
    const get = async ref => {
        if (ref.filters) {
            const field = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
            let matches = [...rows].filter(([path, row]) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/') && ref.filters.every(([key, op, value]) => { assert.equal(op, '=='); return field(row, key) === value; }));
            if (ref.order) matches.sort((a,b) => (field(a[1],ref.order[0]).toMillis()-field(b[1],ref.order[0]).toMillis()) * (ref.order[1] === 'desc' ? -1 : 1));
            return { docs: matches.slice(0,ref.maximum).map(([path,row]) => ({ id: path.split('/').at(-1), ref: doc(path), data: () => clone(row) })) };
        }
        return { ref, exists: rows.has(ref.path), data: () => clone(rows.get(ref.path)) };
    };
    return { rows, doc, collection, runTransaction: fn => {
        const run = queue.then(async () => {
            const writes = [];
            const result = await fn({ get, set: (ref, data) => writes.push(() => rows.set(ref.path, clone(data))),
                create: (ref, data) => writes.push(() => { assert.equal(rows.has(ref.path), false); rows.set(ref.path, clone(data)); }),
                update: (ref, data) => writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...clone(data) })), delete: ref => writes.push(() => rows.delete(ref.path)) });
            writes.forEach(write => write()); return result;
        });
        queue = run.catch(() => {}); return run;
    } };
}
function setup() {
    const db = memoryDb();
    db.rows.set('settings/analytics', { activeVersion: 'v1', ready: true });
    for (const uid of ['student', 'student2', 'mae', 'mae2']) db.rows.set(`users/${uid}`, { uid, email: `${uid}@tec.mx`, name: uid, role: uid.startsWith('mae') ? 'mae' : 'user', points: 0, ratingBonusPoints: 0, badges: [{ id: '1', achieved: false }] });
    db.rows.set('schools/tec.mx/subjects/math', { id: 'math', area: 'Science', name: 'Math' });
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const service = createAdvisoryService({ db, admin: { firestore: { Timestamp } }, HttpsError });
    const user = uid => ({ auth: { uid: `auth-${uid}`, token: { email: `${uid}@tec.mx`, role: uid === 'admin' ? 'admin' : 'user' } } });
    const register = (operationId, uid = 'student', rating = null) => service.register({ operationId, peerUid: 'mae', subjectId: 'math', rating, comment: '' }, user(uid));
    const summary = () => db.rows.get('analytics/v1/summaries/all');
    return { db, service, user, register, summary };
}
test('concurrent replay awards once and rejects conflicting operation payload', async () => {
    const h = setup();
    const result = await Promise.all([h.register('operation_same_1234', 'student', 5), h.register('operation_same_1234', 'student', 5)]);
    assert.equal(result.filter(r => r.replay).length, 1);
    assert.equal(h.db.rows.get('users/mae').points, 60);
    assert.equal(h.summary().totalAsesorias, 1); assert.equal(h.summary().totalUniqueUsers, 1);
    await assert.rejects(h.register('operation_same_1234', 'student', 1), { code: 'already-exists' });
});
test('first, recurrent and three-hour antifarming rules match the domain', async () => {
    const h = setup();
    assert.equal((await h.register('first_operation_123')).pointsAwarded, 10);
    assert.equal((await h.register('second_operation_12')).pointsAwarded, 2.5);
    await h.register('other_student_op12', 'student2');
    assert.equal(h.summary().totalAsesorias, 3); assert.equal(h.summary().totalUniqueUsers, 2);
    assert.equal(Object.values(h.summary().areas)[0].totalUniqueUsers, 2);
    assert.equal(D.individualPoints(false, false), 5);
    assert.equal(D.individualPoints(false, true), 2.5);
});
test('editing rating applies only the bonus delta, including clear and retry', async () => {
    const h = setup(); const { id } = await h.register('rated_advisory_123', 'student', 5);
    const payload = { id, operationId: 'rating_update_12345', patch: { rating: 1, comment: 'updated' } };
    await h.service.mutate(payload, h.user('student')); await h.service.mutate(payload, h.user('student'));
    assert.equal(h.db.rows.get('users/mae').points, 30);
    await h.service.mutate({ id, operationId: 'rating_clear_12345', patch: { rating: null } }, h.user('student'));
    assert.equal(h.db.rows.get('users/mae').points, 10);
});
test('duplicate/test correction preserves dashboard semantics and removes peer count', async () => {
    const h = setup(); const { id } = await h.register('duplicate_case_123');
    await h.service.mutate({ id, operationId: 'mark_duplicate_123', patch: { duplicate: true } }, h.user('admin'));
    assert.equal(h.summary().totalAsesorias, 1);
    assert.equal(h.db.rows.get(`analytics/v1/counts/${D.semester(new Date())}~mae`).count, 0);
    await h.service.mutate({ id, operationId: 'mark_as_test_12345', patch: { _test: true } }, h.user('admin'));
    assert.equal(h.summary().totalAsesorias, 0); assert.equal(h.summary().totalUniqueUsers, 0);
});
test('deletion decrements memberships only when last advisory is removed', async () => {
    const h = setup(); const a = await h.register('delete_case_123456'); const b = await h.register('delete_case_234567');
    await h.service.mutate({ id: a.id, operationId: 'delete_first_12345' }, h.user('admin'), true);
    assert.equal(h.summary().totalUniqueUsers, 1);
    await h.service.mutate({ id: b.id, operationId: 'delete_second_1234' }, h.user('admin'), true);
    assert.equal(h.summary().totalUniqueUsers, 0); assert.equal(h.summary().totalAsesorias, 0);
    const replacement = await h.register('delete_replacement_1234');
    assert.equal(replacement.pointsAwarded, 10);
});
test('student cannot edit another record or change protected award fields', async () => {
    const h = setup(); const { id } = await h.register('protected_case_123');
    await assert.rejects(h.service.mutate({ id, operationId: 'attack_case_123456', patch: { rating: 2 } }, h.user('student2')), { code: 'permission-denied' });
    await assert.rejects(h.service.mutate({ id, operationId: 'attack_case_234567', patch: { pointsAwarded: 100 } }, h.user('student')), { code: 'invalid-argument' });
    await assert.rejects(h.register('bad'), { code: 'invalid-argument' });
});
test('semester boundaries use Mexico City and historical ratings do not change current bonus', () => {
    assert.equal(D.semester(new Date('2026-07-01T05:59:59Z')), '2026-01');
    assert.equal(D.semester(new Date('2026-07-01T06:00:00Z')), '2026-02');
    assert.equal(D.bonus(5, 1), 50); assert.equal(D.bonus(1, 1), 20); assert.equal(D.bonus(0, 0), 0);
});
