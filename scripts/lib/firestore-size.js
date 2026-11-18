// firestore-size.js
//
// Estimadores puros de tamaño de documentos de Firestore (sin dependencias).
// Reglas de tamaño: https://firebase.google.com/docs/firestore/storage-size
// Los índices automáticos son una APROXIMACIÓN (±30 %), no una medición.

const utf8Len = (s) => Buffer.byteLength(String(s), 'utf8');

// Tamaño del nombre de un documento: suma de (utf8(segmento) + 1) por segmento + 16.
function docNameBytes(path) {
    const segments = String(path).split('/').filter((s) => s.length > 0);
    return segments.reduce((sum, seg) => sum + utf8Len(seg) + 1, 0) + 16;
}

const isPlainMap = (v) => {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};

const isTimestampLike = (v) =>
    v instanceof Date || (v !== null && typeof v === 'object' && typeof v.toDate === 'function' && typeof v.seconds === 'number');

const isGeoPointLike = (v) =>
    v !== null && typeof v === 'object' && typeof v.latitude === 'number' && typeof v.longitude === 'number';

const isReferenceLike = (v) =>
    v !== null && typeof v === 'object' && typeof v.path === 'string' && typeof v.id === 'string' && v.firestore !== undefined;

// Bytes de un valor de campo (sin el nombre del campo).
function valueBytes(v) {
    if (v === null || v === undefined) return v === null ? 1 : 0;
    if (typeof v === 'boolean') return 1;
    if (typeof v === 'number' || typeof v === 'bigint') return 8;
    if (typeof v === 'string') return utf8Len(v) + 1;
    if (isTimestampLike(v)) return 8;
    if (Buffer.isBuffer(v)) return v.length;
    if (typeof v.toUint8Array === 'function') return v.toUint8Array().length; // Firestore Bytes
    if (isGeoPointLike(v)) return 16;
    if (isReferenceLike(v)) return docNameBytes(v.path) + 16;
    if (Array.isArray(v)) return v.reduce((sum, el) => sum + valueBytes(el), 0);
    if (isPlainMap(v)) return mapBytes(v);
    return 0;
}

// Map: suma de (utf8(clave) + 1) + bytes del valor, por cada clave.
function mapBytes(obj) {
    return Object.keys(obj).reduce((sum, key) => sum + utf8Len(key) + 1 + valueBytes(obj[key]), 0);
}

// Bytes almacenados de un documento: nombre + campos + 32 de overhead.
function storedDocBytes(path, data) {
    return docNameBytes(path) + mapBytes(data || {}) + 32;
}

// Bytes de cada campo hoja (ruta punteada -> bytes), para encontrar qué campo domina.
function leafFieldBytes(data, prefix = '', out = {}) {
    for (const key of Object.keys(data || {})) {
        const value = data[key];
        const fieldPath = prefix ? `${prefix}.${key}` : key;
        const bytes = utf8Len(key) + 1 + valueBytes(value);
        if (isPlainMap(value)) {
            leafFieldBytes(value, fieldPath, out);
        } else {
            out[fieldPath] = (out[fieldPath] || 0) + bytes;
        }
    }
    return out;
}

// Entradas de índice automático para un documento (aprox.).
// Cada campo hoja y cada map: 2 entradas (ASC y DESC). Los arrays de escalares
// suman 1 entrada por elemento más las 2 del campo. No se entra a maps dentro de arrays.
// Los strings se truncan a 1500 bytes. Las exenciones van como "coleccion.campo".
function indexBytesForDoc(path, data, collectionId, exempt = new Set()) {
    const nameBytes = docNameBytes(path);
    const cap = (v) => (typeof v === 'string' ? Math.min(utf8Len(v), 1500) + 1 : valueBytes(v));
    let total = 0;
    const visit = (obj, prefix) => {
        for (const key of Object.keys(obj || {})) {
            const value = obj[key];
            const fieldPath = prefix ? `${prefix}.${key}` : key;
            if (exempt.has(`${collectionId}.${fieldPath}`)) continue;
            const entryBase = nameBytes + utf8Len(fieldPath) + 1 + 32;
            if (isPlainMap(value)) {
                total += 2 * (entryBase + 1);
                visit(value, fieldPath);
            } else if (Array.isArray(value)) {
                total += 2 * (entryBase + 1);
                for (const el of value) {
                    if (!isPlainMap(el) && !Array.isArray(el)) total += entryBase + cap(el);
                }
            } else {
                total += 2 * (entryBase + cap(value));
            }
        }
    };
    visit(data, '');
    return total;
}

function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
    return sortedAsc[Math.max(0, idx)];
}

module.exports = {
    utf8Len,
    docNameBytes,
    valueBytes,
    mapBytes,
    storedDocBytes,
    leafFieldBytes,
    indexBytesForDoc,
    percentile
};
