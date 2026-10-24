import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test('advisory requests against real Firestore emulator', { skip: !enabled }, async t => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/, 'Only a local emulator may be used');
    const projectId = process.env.GCLOUD_PROJECT;
    assert.match(projectId || '', /^demo-/, 'An explicit demo project is required');
    const admin = require('firebase-admin');
    const functions = require('firebase-functions');
    const { createAdvisoryService } = require('../functions/advisory-requests');
    const app = admin.initializeApp({ projectId }, 'advisory-integration');
    const db = app.firestore();
    let clock = Date.UTC(2026, 9, 20, 18);
    const service = createAdvisoryService({ db, admin, functions, now: () => clock });
    const runId = Date.now().toString(36);
    const campus = `Integration Campus ${runId}`;
    const key = suffix => `integration_${runId}_${suffix}`;
    const ctx = (suffix, role = 'user') => ({ auth: { uid: `auth-${suffix}`, token: { email: `${key(suffix)}@tec.mx`, email_verified: true, role } } });
    const profile = (role = 'user', subjects = []) => ({
        name: role, role, campus, subjects, points: 0, ratingBonusPoints: 0,
        activeSession: { startTime: admin.firestore.Timestamp.fromMillis(clock), location: 'Mesa 1' }
    });
    const subjectId = `integration_math_${runId}`;
    const requestRef = result => db.collection('advisoryRequests').doc(result.requestId);
    let sequence = 0;
    // Cada subprueba parte de cero: se libera el candado de una solicitud activa por materia.
    const releaseLocks = () => Promise.all([key('student'), key('future')].flatMap(student =>
        [subjectId, 'integration_unmatched'].map(subject => db.doc(`advisoryRequestLocks/${student}_${subject}`).delete())));
    const create = async (overrides = {}, context = ctx('student')) => {
        await releaseLocks();
        return service.createAdvisoryRequest({ operationId: `integration-${Date.now()}-${sequence++}`, subjectId, ...overrides }, context);
    };
    try {
        await Promise.all([
            db.doc(`schools/tec.mx/subjects/${subjectId}`).set({ name: 'Matemáticas' }),
            ...[
                ['student', profile()], ['coordi', profile('coordi')],
                ['mae1', profile('mae', [{ id: subjectId }])],
                ['mae2', profile('mae', [{ id: subjectId }])],
                ['other', profile('mae', [{ id: 'another-subject' }])],
                ['outsider', { ...profile('mae', [{ id: subjectId }]), campus: 'Other Campus' }]
            ].map(([suffix, value]) => db.doc(`users/${key(suffix)}`).set(value))
        ]);
        await t.test('publication is idempotent and limits its initial broadcast to subject matches', async () => {
            const operationId = `same-${Date.now()}`;
            const results = await Promise.all([create({ operationId }), create({ operationId })]);
            assert.equal(results[0].requestId, results[1].requestId);
            const ref = requestRef(results[0]);
            assert.equal((await ref.get()).data().broadcastMode, 'subject');
            const event = (await ref.collection('events').doc('broadcast-0').get()).data();
            assert.deepEqual(event.recipientKeys.sort(), [key('mae1'), key('mae2')].sort());
            await assert.rejects(create({ studentEmail: `${key('other')}@tec.mx` }), error => error.code === 'permission-denied');
        });
        await t.test('no matching subject broadcasts immediately and expired or future shifts cannot offer', async () => {
            await db.doc('schools/tec.mx/subjects/integration_unmatched').set({ name: 'Otra materia' });
            const result = await create({ subjectId: 'integration_unmatched', topic: 'Tema opcional' });
            const ref = requestRef(result);
            assert.equal((await ref.get()).data().broadcastMode, 'all');
            const recipients = (await ref.collection('events').doc('broadcast-0').get()).data().recipientKeys;
            assert.ok(recipients.includes(key('other')));
            assert.ok(!recipients.includes(key('outsider')));
            for (const offset of [-18000000, 1]) {
                await db.doc(`users/${key('inactive')}`).set({ ...profile('mae'), activeSession: { startTime: admin.firestore.Timestamp.fromMillis(clock + offset) } });
                await assert.rejects(service.offerAdvisoryHelp({ ...result, location: 'Mesa' }, ctx('inactive', 'mae')), error => error.code === 'permission-denied');
            }
        });
        await t.test('simultaneous publications for the same subject leave exactly one active request', async () => {
            await releaseLocks();
            const results = await Promise.allSettled(['a', 'b'].map(suffix => service.createAdvisoryRequest({ operationId: `lock-${runId}-${suffix}`, subjectId }, ctx('student'))));
            assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
            assert.equal(results.find(item => item.status === 'rejected').reason.code, 'already-exists');
        });
        await t.test('not-held closure is idempotent, rejects registration and cannot close an open request as missing-registration', async () => {
            const result = await create();
            await assert.rejects(service.closeAdvisoryRequest({ ...result, reason: 'missing_registration' }, ctx('student')), error => error.code === 'failed-precondition');
            await Promise.all([1, 2].map(() => service.closeAdvisoryRequest({ ...result, reason: 'not_held' }, ctx('student'))));
            assert.equal((await requestRef(result).get()).data().closeReason, 'not_held');
            await assert.rejects(service.registerRequestedAdvisory({ ...result, assignmentVersion: 0 }, ctx('student')), error => error.code === 'failed-precondition');
        });
        await t.test('five-minute expansion is durable, exact at the boundary, and idempotent', async () => {
            const ref = requestRef(await create());
            clock += 299999;
            await service.broadenPending();
            assert.equal((await ref.get()).data().broadcastMode, 'subject');
            clock += 1;
            await Promise.all([service.broadenPending(), service.broadenPending()]);
            assert.equal((await ref.get()).data().broadcastMode, 'all');
            const event = (await ref.collection('events').doc('expanded-0').get()).data();
            assert.ok(event.recipientKeys.includes(key('other')));
            assert.ok(!event.recipientKeys.includes(key('mae1')));
            assert.ok(!event.recipientKeys.includes(key('outsider')));
        });
        await t.test('one active offer prevents expansion and duplicate offers do not increment twice', async () => {
            const result = await create();
            await Promise.all([1, 2].map(() => service.offerAdvisoryHelp({ ...result, location: 'Mesa 4' }, ctx('mae1', 'mae'))));
            const ref = requestRef(result);
            assert.equal((await ref.get()).data().activeOfferCount, 1);
            clock += 300000;
            await service.broadenPending();
            assert.equal((await ref.get()).data().broadcastMode, 'subject');
            await service.withdrawAdvisoryOffer(result, ctx('mae1', 'mae'));
            await service.broadenPending();
            assert.equal((await ref.get()).data().broadcastMode, 'all');
        });
        await t.test('simultaneous assignments select exactly one MAE and reject an unrelated student', async () => {
            const result = await create();
            await Promise.all(['mae1', 'mae2'].map(suffix => service.offerAdvisoryHelp({ ...result, location: suffix }, ctx(suffix, 'mae'))));
            await assert.rejects(service.assignAdvisoryRequest({ ...result, maeKey: key('mae1') }, ctx('other', 'mae')), error => error.code === 'permission-denied');
            const choices = await Promise.allSettled(['mae1', 'mae2'].map(suffix => service.assignAdvisoryRequest({ ...result, maeKey: key(suffix) }, ctx('student'))));
            assert.equal(choices.filter(item => item.status === 'fulfilled').length, 1);
            assert.equal((await requestRef(result).get()).data().status, 'assigned');
        });
        await t.test('closed missing-registration request registers once, atomically awards points, and preserves read notifications', async () => {
            const result = await create();
            await service.offerAdvisoryHelp({ ...result, location: 'Mesa 8' }, ctx('mae1', 'mae'));
            await service.assignAdvisoryRequest({ ...result, maeKey: key('mae1') }, ctx('student'));
            await service.closeAdvisoryRequest({ ...result, reason: 'missing_registration' }, ctx('student'));
            await assert.rejects(service.registerRequestedAdvisory({ ...result, assignmentVersion: 0 }, ctx('coordi', 'coordi')), error => error.code === 'permission-denied');
            const registrations = await Promise.all([1, 2].map(() => service.registerRequestedAdvisory({ ...result, assignmentVersion: 0, rating: 5 }, ctx('student'))));
            assert.equal(registrations[0].advisoryId, registrations[1].advisoryId);
            assert.equal((await requestRef(result).get()).data().status, 'registered');
            assert.equal((await db.doc(`users/${key('mae1')}`).get()).data().points, 60);
            assert.equal((await db.collection('asesorias').where('requestId', '==', result.requestId).get()).size, 1);
            const event = await requestRef(result).collection('events').doc('registered').get();
            await service.dispatchEvent(event);
            const notice = db.doc(`advisoryNotifications/${key('student')}/items/${result.requestId}_registered`);
            const readAt = admin.firestore.Timestamp.fromMillis(clock);
            await notice.update({ readAt });
            await service.dispatchEvent(event);
            assert.equal((await notice.get()).data().readAt.toMillis(), clock);
        });
        await t.test('future account claims by verified email and changed assignment version cannot register', async () => {
            const result = await create({ studentEmail: `${key('future')}@tec.mx`, campus }, ctx('coordi', 'coordi'));
            await service.offerAdvisoryHelp({ ...result, location: 'Mesa 9' }, ctx('mae2', 'mae'));
            await service.assignAdvisoryRequest({ ...result, maeKey: key('mae2') }, ctx('coordi', 'coordi'));
            await db.doc(`users/${key('future')}`).set(profile());
            await service.unassignAdvisoryRequest(result, ctx('future'));
            await service.offerAdvisoryHelp({ ...result, location: 'Mesa 10' }, ctx('mae2', 'mae'));
            await service.assignAdvisoryRequest({ ...result, maeKey: key('mae2') }, ctx('future'));
            await assert.rejects(service.registerRequestedAdvisory({ ...result, assignmentVersion: 0 }, ctx('future')), error => error.code === 'failed-precondition');
            const registered = await service.registerRequestedAdvisory({ ...result, assignmentVersion: 1 }, ctx('future'));
            assert.ok(registered.advisoryId);
        });
        await t.test('new shifts receive a pending request once via the scheduler and stopped shifts are not notified', async () => {
            const result = await create();
            const userRef = db.doc(`users/${key('newturn')}`);
            await userRef.set({ ...profile('mae', [{ id: subjectId }]), activeSession: null });
            await service.broadenPending();
            const notifiedKeys = async value => (await requestRef(value).collection('events').get()).docs.filter(doc => doc.id.startsWith('turn-')).flatMap(doc => doc.data().recipientKeys);
            assert.ok(!(await notifiedKeys(result)).includes(key('newturn')));
            await userRef.update({ activeSession: profile().activeSession });
            await Promise.all([1, 2].map(() => service.broadenPending()));
            for (const doc of (await requestRef(result).collection('events').get()).docs) await service.dispatchEvent(doc);
            assert.ok((await notifiedKeys(result)).includes(key('newturn')));
            const before = (await notifiedKeys(result)).length;
            await service.broadenPending();
            assert.equal((await notifiedKeys(result)).length, before);
            const second = await create();
            await userRef.update({ activeSession: null });
            await service.broadenPending();
            assert.ok(!(await notifiedKeys(second)).includes(key('newturn')));
        });
        await t.test('after three hours open requests expire and assigned ones stay registrable', async () => {
            const open = await create();
            const assigned = await create({ subjectId: 'integration_unmatched' });
            await service.offerAdvisoryHelp({ ...assigned, location: 'Mesa 12' }, ctx('other', 'mae'));
            await service.assignAdvisoryRequest({ ...assigned, maeKey: key('other') }, ctx('student'));
            clock += 3 * 60 * 60 * 1000;
            await service.broadenPending();
            assert.equal((await requestRef(open).get()).data().closeReason, 'expired');
            assert.equal((await requestRef(assigned).get()).data().closeReason, 'missing_registration');
            assert.ok((await service.registerRequestedAdvisory({ ...assigned, assignmentVersion: 0 }, ctx('student'))).advisoryId);
        });
        await t.test('real client rules isolate requests, offers and notifications and forbid forged state', async () => {
            const { initializeApp, deleteApp } = await import('firebase/app');
            const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, serverTimestamp, terminate, deleteField, increment, Timestamp } = await import('firebase/firestore');
            const clients = [];
            function client(suffix, verified = true) {
                const app = initializeApp({ projectId, apiKey: 'demo-key' }, `rules-${suffix}-${verified}`);
                const store = getFirestore(app);
                connectFirestoreEmulator(store, '127.0.0.1', Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]), {
                    mockUserToken: { sub: `auth-${suffix}`, email: `${key(suffix)}@tec.mx`, email_verified: verified }
                });
                clients.push({ app, store });
                return store;
            }
            const denied = promise => assert.rejects(promise, error => error.code === 'permission-denied');
            try {
                const result = await create();
                await service.offerAdvisoryHelp({ ...result, location: 'Mesa 11' }, ctx('mae1', 'mae'));
                const owner = client('student'), outsider = client('outsider'), unverified = client('student', false);
                const path = `advisoryRequests/${result.requestId}`;
                assert.equal((await getDoc(doc(owner, path))).exists(), true);
                await denied(getDoc(doc(outsider, path)));
                await denied(getDoc(doc(unverified, path)));
                await denied(updateDoc(doc(owner, path), { status: 'registered' }));
                await denied(setDoc(doc(owner, `${path}/offers/forged`), { status: 'active' }));
                await denied(getDoc(doc(outsider, `${path}/offers/${key('mae1')}`)));
                await denied(setDoc(doc(owner, 'asesorias/forged-linked'), { requestId: result.requestId, assignmentVersion: 0 }));
                const event = await requestRef(result).collection('events').doc('created').get();
                await service.dispatchEvent(event);
                const noticePath = `advisoryNotifications/${key('student')}/items/${result.requestId}_created`;
                assert.equal((await getDoc(doc(owner, noticePath))).exists(), true);
                await denied(getDoc(doc(outsider, noticePath)));
                await denied(updateDoc(doc(owner, noticePath), { title: 'forged' }));
                await updateDoc(doc(owner, noticePath), { readAt: serverTimestamp() });
                assert.ok((await getDoc(doc(owner, noticePath))).data().readAt);

                // Perfiles: campus, turno y horas no se falsean; coordinación solo en su campus
                await Promise.all([
                    db.doc(`users/${key('shift')}`).set({ ...profile('mae'), activeSession: null, totalTime: 30 }),
                    db.doc(`users/${key('coordi2')}`).set({ ...profile('coordi'), campus: 'Other Campus' })
                ]);
                const shiftPath = `users/${key('shift')}`;
                const shift = client('shift'), sameCampus = client('coordi'), otherCampus = client('coordi2');
                await denied(updateDoc(doc(shift, shiftPath), { campus: 'Other Campus' }));
                await denied(updateDoc(doc(shift, shiftPath), { activeSession: { location: 'Mesa', startTime: Timestamp.fromMillis(Date.now() - 4 * 3600000) } }));
                await denied(updateDoc(doc(shift, shiftPath), { totalTime: 9999 }));
                await updateDoc(doc(shift, shiftPath), { activeSession: { location: 'Mesa', status: 'PENDING', startTime: serverTimestamp() } });
                await denied(updateDoc(doc(shift, shiftPath), { totalTime: 130, activeSession: deleteField() }));
                await updateDoc(doc(shift, shiftPath), { totalTime: 30, activeSession: deleteField() });
                await denied(updateDoc(doc(otherCampus, shiftPath), { totalTime: increment(60) }));
                await denied(updateDoc(doc(sameCampus, shiftPath), { subjects: [{ id: 'forged' }] }));
                await updateDoc(doc(sameCampus, shiftPath), { totalTime: increment(60) });
                assert.equal((await db.doc(shiftPath).get()).data().totalTime, 90);
            } finally {
                await Promise.all(clients.map(async ({ app, store }) => { await terminate(store); await deleteApp(app); }));
            }
        });
    } finally {
        await app.delete();
    }
});
