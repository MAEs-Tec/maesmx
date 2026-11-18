import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTargetSize } from '../src/utils/imageCompress.js';

test('cover recorta al centro un cuadro de 4000x3000 a 320x320', () => {
    const size = computeTargetSize(4000, 3000, 320, 320, 'cover');
    assert.equal(size.width, 320);
    assert.equal(size.height, 320);
    assert.equal(size.sw, 3000);
    assert.equal(size.sh, 3000);
    assert.equal(size.sx, 500);
    assert.equal(size.sy, 0);
});

test('inside no amplia una imagen pequena', () => {
    const size = computeTargetSize(200, 100, 1280, 1280, 'inside');
    assert.deepEqual([size.width, size.height], [200, 100]);
    assert.deepEqual([size.sx, size.sy, size.sw, size.sh], [0, 0, 200, 100]);
});

test('inside escala 1920x600 a 1280x400 manteniendo proporcion', () => {
    const size = computeTargetSize(1920, 600, 1280, 1280, 'inside');
    assert.deepEqual([size.width, size.height], [1280, 400]);
});

test('dimensiones 0, NaN o negativas devuelven null', () => {
    assert.equal(computeTargetSize(0, 100, 320, 320, 'cover'), null);
    assert.equal(computeTargetSize(100, NaN, 320, 320, 'inside'), null);
    assert.equal(computeTargetSize(100, 100, -1, 320, 'inside'), null);
    assert.equal(computeTargetSize(100, 100, undefined, 320, 'cover'), null);
});
