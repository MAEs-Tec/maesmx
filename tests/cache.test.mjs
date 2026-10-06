import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

function cache() {
    let source = readFileSync(new URL('../src/firebase/cache/cache.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    return new Function('Timestamp', 'recordCostOperation', `${source}; return {withCache, invalidateCacheTags, configureCacheSession};`)(class {}, () => {});
}
test('simultaneous reads share one request and hot cache is cloned', async () => {
    const c = cache(); let loads = 0;
    const loader = async () => { loads++; await Promise.resolve(); return { rows: [1] }; };
    const [a, b] = await Promise.all([c.withCache('x', { ttlMs: 500 }, loader), c.withCache('x', { ttlMs: 500 }, loader)]);
    assert.equal(loads, 1); a.rows.push(2); assert.deepEqual(b.rows, [1]);
    assert.deepEqual((await c.withCache('x', {}, loader)).rows, [1]);
});
test('late request does not refill cache after targeted invalidation', async () => {
    const c = cache(); let release;
    const pending = c.withCache('x', { tags: ['u:1'], ttlMs: 500 }, () => new Promise(resolve => release = resolve));
    await c.invalidateCacheTags(['u:1']); release('old'); await pending;
    assert.equal(await c.withCache('x', {}, async () => 'new'), 'new');
});
test('session change isolates cached values and pending requests', async () => {
    const c = cache(); await c.configureCacheSession('p', 'alice');
    await c.withCache('private', { ttlMs: 500 }, async () => 'alice');
    await c.configureCacheSession('p', 'bob');
    assert.equal(await c.withCache('private', {}, async () => 'bob'), 'bob');
    let release;
    const pending = c.withCache('late', {}, () => new Promise(resolve => release = resolve));
    await c.configureCacheSession('p', null);
    release('bob-private');
    await assert.rejects(pending, /cuenta cambió/);
});
test('rejected reads are never cached as an empty result', async () => {
    const c = cache();
    await assert.rejects(c.withCache('x', {}, async () => { throw new Error('offline'); }));
    assert.deepEqual(await c.withCache('x', {}, async () => [1]), [1]);
});
