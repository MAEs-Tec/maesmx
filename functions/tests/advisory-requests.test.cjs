const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, userKeyFromEmail, isActiveMae, advisoryPoints, ratingBonus, createAdvisoryService } = require('../advisory-requests');

const now = Date.UTC(2026, 9, 20, 18);
const timestamp = value => ({ toMillis: () => value });
test('institutional identity normalizes case and whitespace consistently', () => {
    assert.equal(normalizeEmail(' A01234567@TEC.MX '), 'a01234567@tec.mx');
    assert.equal(userKeyFromEmail(' A01234567@TEC.MX '), 'a01234567');
});
test('active MAEs require a permitted role and a non-future shift less than five hours old', () => {
    for (const role of ['mae', 'coordi', 'admin', 'subjectCoordi', 'publi', 'tec']) {
        assert.equal(isActiveMae({ role, activeSession: { startTime: timestamp(now - 1) } }, now), true);
    }
    for (const user of [
        { role: 'user', activeSession: { startTime: timestamp(now - 1) } },
        { role: 'exmae', activeSession: { startTime: timestamp(now - 1) } },
        { role: 'mae' },
        { role: 'mae', activeSession: { startTime: timestamp(now + 1) } },
        { role: 'mae', activeSession: { startTime: timestamp(now - 5 * 3600000) } }
    ]) assert.equal(isActiveMae(user, now), false);
});
test('advisory points preserve first-time, recurrent, and three-hour anti-farming rules', () => {
    assert.deepEqual(advisoryPoints([], now), { pointsAwarded: 10, pointsReason: 'first_time_student' });
    assert.deepEqual(advisoryPoints([{ date: timestamp(now - 1) }], now), { pointsAwarded: 2.5, pointsReason: 'recurrent_under_3_hours' });
    assert.deepEqual(advisoryPoints([{ date: timestamp(now - 3 * 3600000) }], now), { pointsAwarded: 5, pointsReason: 'recurrent_student' });
    assert.equal(ratingBonus([]), 0);
    assert.equal(ratingBonus([1]), 20);
    assert.equal(ratingBonus([4, 5]), 45);
    assert.equal(ratingBonus([5]), 50);
});
test('authentication is checked before reading a profile or processing a request', async () => {
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const service = createAdvisoryService({
        db: { collection: () => ({}) }, admin: {}, functions: { https: { HttpsError } }
    });
    await assert.rejects(service.createAdvisoryRequest({}, {}), error => error.code === 'unauthenticated');
    for (const token of [
        { email: 'a01234567@tec.mx', email_verified: false },
        { email: 'a01234567@example.com', email_verified: true }
    ]) await assert.rejects(service.createAdvisoryRequest({}, { auth: { token } }), error => error.code === 'permission-denied');
});

// --- fake Firestore en memoria para probar la lógica del servicio ---
const { Timestamp } = require('firebase-admin/firestore');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fakeDb(seed = {}) {
    const store = new Map(Object.entries(seed));
    const log = { queries: [], txQueries: [], updates: [] };
    const field = (data, path) => path.split('.').reduce((value, part) => value?.[part], data);
    const cmp = value => typeof value?.toMillis === 'function' ? value.toMillis() : value;
    const snap = path => {
        const data = store.get(path);
        return { id: path.split('/').pop(), ref: docRef(path), exists: data !== undefined, data: () => data && { ...data } };
    };
    const matches = (data, filters) => filters.every(([name, op, value]) => {
        const actual = field(data, name);
        if (op === '==') return actual === value;
        if (op === 'in') return value.includes(actual);
        if (op === '>') return actual !== undefined && cmp(actual) > cmp(value);
        throw new Error(`op ${op}`);
    });
    function query(path, filters = []) {
        return {
            where: (name, op, value) => query(path, [...filters, [name, op, value]]),
            orderBy: () => query(path, filters), limit: () => query(path, filters), startAfter: () => query(path, filters),
            _run() {
                const docs = [...store.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') && matches(store.get(key), filters)).map(snap);
                return { docs, size: docs.length };
            },
            get() { log.queries.push({ path, filters }); return Promise.resolve(this._run()); },
            _path: path, _filters: filters
        };
    }
    function docRef(path) {
        return { id: path.split('/').pop(), path, get: () => Promise.resolve(snap(path)), collection: name => collection(`${path}/${name}`) };
    }
    function collection(path) { return { ...query(path), doc: id => docRef(`${path}/${id}`) }; }
    const apply = writes => writes.forEach(([kind, path, data, options]) => {
        if (kind === 'create' && store.has(path)) throw new Error(`already exists ${path}`);
        if (kind === 'update') log.updates.push(path);
        store.set(path, kind === 'update' || options?.merge ? { ...store.get(path), ...data } : data);
    });
    return {
        store, log, collection, doc: path => docRef(path),
        runTransaction: async fn => {
            const writes = [];
            const tx = {
                get: target => {
                    if (target._filters) { log.txQueries.push(target._path); return Promise.resolve(target._run()); }
                    return target.get();
                },
                set: (ref, data, options) => writes.push(['set', ref.path, data, options]),
                create: (ref, data) => writes.push(['create', ref.path, data]),
                update: (ref, data) => writes.push(['update', ref.path, data])
            };
            const result = await fn(tx);
            apply(writes);
            return result;
        }
    };
}
const functionsStub = { https: { HttpsError } };
const session = ago => ({ startTime: Timestamp.fromMillis(now - ago) });
const mae = (extra = {}) => ({ name: 'MAE', role: 'mae', campus: 'c1', subjects: [{ id: 'math' }], activeSession: session(1000), points: 0, ...extra });
const ctx = (key, role = 'user') => ({ auth: { uid: key, token: { email: `${key}@tec.mx`, email_verified: true, role } } });
const openRequest = (extra = {}) => ({
    studentKey: 'student', creatorKey: 'student', campus: 'c1', subject: { id: 'math', name: 'Mate' }, topic: '',
    status: 'open', assignmentVersion: 0, activeOfferCount: 0, broadcastMode: 'all', broadenAt: Timestamp.fromMillis(now + 1e6), ...extra
});
const eventsOf = (db, id = 'r1') => [...db.store.keys()].filter(key => key.startsWith(`advisoryRequests/${id}/events/`)).map(key => [key.split('/').pop(), db.store.get(key)]);
const make = db => createAdvisoryService({ db, admin: {}, functions: functionsStub, now: () => now });

test('active MAE lookup queries only recent turns by campus', async () => {
    const db = fakeDb({ 'advisoryRequests/r1': openRequest(), 'users/old': mae({ activeSession: session(6 * 3600000) }), 'users/m1': mae() });
    await make(db).broadenPending();
    const query = db.log.queries.find(item => item.path === 'users');
    assert.deepEqual(query.filters.map(([name, op]) => `${name} ${op}`), ['campus ==', 'activeSession.startTime >']);
});
test('scheduler is a single query when there are no open requests', async () => {
    const db = fakeDb({ 'advisoryRequests/r1': openRequest({ status: 'closed' }), 'users/m1': mae() });
    await make(db).broadenPending();
    assert.equal(db.log.queries.length, 1);
});
test('scheduler notifies MAEs who start a turn later, once, honoring subject mode, student and unassigned MAE', async () => {
    const db = fakeDb({
        'advisoryRequests/r1': openRequest({ broadcastMode: 'subject', lastUnassignedMaeKey: 'gone' }),
        'users/student': mae(), 'users/late': mae(), 'users/gone': mae(), 'users/other': mae({ subjects: [{ id: 'x' }] }),
        'users/done': mae(), 'users/old': mae({ activeSession: session(6 * 3600000) }),
        'advisoryNotifications/done/items/r1_help-0': { readAt: null }
    });
    const service = make(db);
    await service.broadenPending();
    await service.broadenPending();
    const turns = eventsOf(db).filter(([name]) => name.startsWith('turn-0-'));
    assert.equal(turns.length, 1);
    assert.deepEqual(turns[0][1].recipientKeys, ['late']);
    assert.equal(turns[0][1].type, 'help_requested');
});
test('assigning notifies the MAEs who offered but were not chosen', async () => {
    const offer = (name, extra = {}) => ({ name, location: 'Mesa', status: 'active', assignmentVersion: 0, ...extra });
    const db = fakeDb({
        'advisoryRequests/r1': openRequest(), 'users/student': mae({ role: 'user' }), 'users/m1': mae(), 'users/m2': mae(), 'users/m3': mae(),
        'advisoryRequests/r1/offers/m1': offer('Uno'), 'advisoryRequests/r1/offers/m2': offer('Dos'),
        'advisoryRequests/r1/offers/m3': offer('Tres', { status: 'withdrawn' })
    });
    const service = make(db);
    await service.assignAdvisoryRequest({ requestId: 'r1', maeKey: 'm1' }, ctx('student'));
    await service.assignAdvisoryRequest({ requestId: 'r1', maeKey: 'm1' }, ctx('student'));
    const events = Object.fromEntries(eventsOf(db));
    assert.deepEqual(events['not-selected-0'].recipientKeys, ['m2']);
    assert.equal(events['not-selected-0'].type, 'offer_not_selected');
    assert.equal(events['not-selected-0'].title, 'Ya se asignó otro MAE');
    assert.ok(events['assigned-0'].recipientKeys.includes('m1'));
});
test('unassigning stores the removed MAE in a single update and excludes them from the re-broadcast', async () => {
    const db = fakeDb({
        'advisoryRequests/r1': openRequest({ status: 'assigned', assignedMaeKey: 'm1' }), 'users/student': mae({ role: 'user' }),
        'users/m1': mae(), 'users/m2': mae()
    });
    const service = make(db);
    await service.unassignAdvisoryRequest({ requestId: 'r1' }, ctx('student'));
    assert.equal(db.log.updates.filter(path => path === 'advisoryRequests/r1').length, 1);
    const request = db.store.get('advisoryRequests/r1');
    assert.equal(request.lastUnassignedMaeKey, 'm1');
    assert.equal(request.needsBroadcast, true);
    await service.broadenPending();
    const expanded = eventsOf(db).find(([name]) => name === 'expanded-1');
    assert.deepEqual(expanded[1].recipientKeys, ['m2']);
    assert.ok(!eventsOf(db).some(([name, value]) => name.startsWith('turn-') && value.recipientKeys.includes('m1')));
});
test('only coordination of the request campus is notified of new requests', async () => {
    const db = fakeDb({
        'schools/tec.mx/subjects/math': { name: 'Mate' }, 'users/student': { name: 'S', role: 'user', campus: 'c1' },
        'users/coordi1': { role: 'coordi', campus: 'c1' }, 'users/coordi2': { role: 'coordi', campus: 'c2' },
        'users/admin2': { role: 'admin', campus: 'c2' }, 'users/admin1': { role: 'admin', campus: 'c1' }
    });
    const { requestId } = await make(db).createAdvisoryRequest({ operationId: 'op1', subjectId: 'math' }, ctx('student'));
    const created = eventsOf(db, requestId).find(([name]) => name === 'created')[1];
    assert.deepEqual([...created.recipientKeys].sort(), ['admin1', 'coordi1', 'student']);
});
test('registering reads the MAE history outside the transaction and stays idempotent', async () => {
    const db = fakeDb({
        'advisoryRequests/r1': openRequest({ status: 'assigned', assignedMaeKey: 'm1' }),
        'users/student': { name: 'S', role: 'user', campus: 'c1' }, 'users/m1': mae({ points: 5, ratingBonusPoints: 0 })
    });
    const service = make(db);
    const first = await service.registerRequestedAdvisory({ requestId: 'r1', assignmentVersion: 0 }, ctx('student'));
    assert.ok(!db.log.txQueries.includes('asesorias'));
    assert.equal(db.store.get('users/m1').points, 15);
    assert.equal(db.store.get('asesorias/request_r1').pointsReason, 'first_time_student');
    const again = await service.registerRequestedAdvisory({ requestId: 'r1', assignmentVersion: 0 }, ctx('student'));
    assert.equal(again.advisoryId, first.advisoryId);
    assert.equal(db.store.get('users/m1').points, 15);
});
