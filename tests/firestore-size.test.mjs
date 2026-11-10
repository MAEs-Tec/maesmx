import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { docNameBytes, valueBytes, mapBytes, storedDocBytes, leafFieldBytes, indexBytesForDoc, utf8Len } = require('../scripts/lib/firestore-size.js');

test('utf8Len counts accented characters by bytes, not characters', () => {
    assert.equal(utf8Len('abc'), 3);
    assert.equal(utf8Len('José'), 5); // é ocupa 2 bytes
    assert.equal(utf8Len('ñandú'), 7);
});

test('string values cost utf8 length plus 1', () => {
    assert.equal(valueBytes('abc'), 4);
    assert.equal(valueBytes('José'), 6);
    assert.equal(valueBytes(''), 1);
});

test('numbers, booleans, null and timestamps have fixed sizes', () => {
    assert.equal(valueBytes(42), 8);
    assert.equal(valueBytes(3.14), 8);
    assert.equal(valueBytes(true), 1);
    assert.equal(valueBytes(false), 1);
    assert.equal(valueBytes(null), 1);
    assert.equal(valueBytes(new Date('2026-11-10')), 8);
    assert.equal(valueBytes({ seconds: 1, nanoseconds: 0, toDate: () => new Date() }), 8);
});

test('buffers, geopoints and document references', () => {
    assert.equal(valueBytes(Buffer.from([1, 2, 3, 4])), 4);
    assert.equal(valueBytes({ latitude: 25.6, longitude: -100.3 }), 16);
    const ref = { path: 'users/abc', id: 'abc', firestore: {} };
    assert.equal(valueBytes(ref), docNameBytes('users/abc') + 16);
});

test('arrays sum their elements and nested maps sum keys plus values', () => {
    assert.equal(valueBytes([1, 2, 'ab']), 8 + 8 + 3);
    assert.equal(valueBytes([]), 0);
    // mapa anidado: "a" (1+1) + mapa { "bc": "xy" } = ("bc" 2+1 + "xy" 2+1) = 6 -> total 2 + 6 = 8
    assert.equal(mapBytes({ a: { bc: 'xy' } }), (1 + 1) + (2 + 1) + 3);
    assert.equal(valueBytes({ a: { bc: 'xy' } }), mapBytes({ a: { bc: 'xy' } }));
});

test('document name counts segments with +1 each plus 16', () => {
    // "users" (5+1) + "abc" (3+1) + 16
    assert.equal(docNameBytes('users/abc'), 6 + 4 + 16);
    // subcolección: attendance/2026-11-10/report/uid
    assert.equal(docNameBytes('attendance/2026-11-10/report/uid'), (utf8Len('attendance') + 1) + (utf8Len('2026-11-10') + 1) + (utf8Len('report') + 1) + (utf8Len('uid') + 1) + 16);
    assert.equal(docNameBytes('attendance/2026-11-10/report/uid'), 49);
});

test('document name with a subcollection path and accented ids', () => {
    const name = docNameBytes('asesorias/José/offers/ñ');
    assert.equal(name, (utf8Len('asesorias') + 1) + (utf8Len('José') + 1) + (utf8Len('offers') + 1) + (utf8Len('ñ') + 1) + 16);
});

test('storedDocBytes = name + fields (key+1+value) + 32', () => {
    const data = { uid: 'abc', email: 'a@tec.mx', active: true, n: 7, tags: ['x'] };
    const expectedFields = (utf8Len('uid') + 1 + valueBytes('abc')) + (utf8Len('email') + 1 + valueBytes('a@tec.mx')) + (utf8Len('active') + 1 + 1) + (utf8Len('n') + 1 + 8) + (utf8Len('tags') + 1 + valueBytes(['x']));
    assert.equal(storedDocBytes('users/abc', data), docNameBytes('users/abc') + expectedFields + 32);
});

test('leafFieldBytes reports fields by dotted path, including nested maps', () => {
    const out = leafFieldBytes({ peerInfo: { profilePictureUrl: 'https://x.y/z', uid: 'u1' }, badges: [{ a: 1 }] });
    assert.equal(out['peerInfo.profilePictureUrl'], utf8Len('profilePictureUrl') + 1 + valueBytes('https://x.y/z'));
    assert.equal(out['peerInfo.uid'], utf8Len('uid') + 1 + valueBytes('u1'));
    assert.equal(out.badges, utf8Len('badges') + 1 + valueBytes([{ a: 1 }]));
});

test('index estimate: 2 entries per scalar field and exemptions remove them', () => {
    const path = 'users/abc';
    const data = { role: 'mae', badges: [{ achieved: true }, { achieved: false }] };
    const all = indexBytesForDoc(path, data, 'users');
    const exempt = indexBytesForDoc(path, data, 'users', new Set(['users.badges']));
    assert.ok(all > exempt);
    const scalarOnly = indexBytesForDoc(path, { role: 'mae' }, 'users');
    const nameBytes = docNameBytes(path);
    assert.equal(scalarOnly, 2 * (nameBytes + utf8Len('role') + 1 + 32 + valueBytes('mae')));
    assert.equal(exempt, scalarOnly);
});

test('index estimate truncates long strings to 1500 bytes', () => {
    const big = 'a'.repeat(5000);
    const bytes = indexBytesForDoc('x/y', { t: big }, 'x');
    const nameBytes = docNameBytes('x/y');
    assert.equal(bytes, 2 * (nameBytes + 1 + 1 + 32 + 1501));
});
