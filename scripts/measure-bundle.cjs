const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const html = fs.readFileSync('dist/index.html', 'utf8');
const entry = html.match(/<script[^>]+src="([^"]+)"/)[1];
const bytes = fs.readFileSync(path.join('dist', entry));
console.log(JSON.stringify({ entry, bytes: bytes.length, gzipBytes: gzipSync(bytes).length,
    baselineGzipBytes: 503980, reductionPercent: +(100 * (1 - gzipSync(bytes).length / 503980)).toFixed(2) }, null, 2));
