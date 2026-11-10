// measure-firestore-storage.js
//
// Mide, de SOLO LECTURA, cuánto almacenamiento estimado ocupa cada colección
// de Firestore (datos + índices automáticos aproximados). No escribe nada.
//
// Requisitos:
//   - firebase-admin en functions/node_modules
//   - Para producción: credenciales ADC con rol de lectura (roles/datastore.viewer)
//
// Uso (desde la raíz del repo):
//
//   Emulador (costo 0):
//     FIRESTORE_EMULATOR_HOST=localhost:8080 NODE_PATH=functions/node_modules node scripts/measure-firestore-storage.js
//
//   Producción (lee datos reales, cuesta lecturas):
//     NODE_PATH=functions/node_modules node scripts/measure-firestore-storage.js --allow-prod
//
// Opciones:
//   --project <id>      Proyecto (defecto: peer-teaching)
//   --sample <n>        Docs muestreados por colección (defecto: 200)
//   --full              Lee todos los docs de colecciones con <= --max-full docs
//   --max-full <n>      Límite para --full (defecto: 5000)
//   --max-reads <n>     Tope duro de lecturas de documentos (defecto: 8000)
//   --exempt <lista>    Campos exentos de índice, "coleccion.campo,..." (estima el ahorro)
//   --out <archivo>     Guarda el resumen en JSON (opcional)
//   --allow-prod        Obligatorio para leer producción (sin FIRESTORE_EMULATOR_HOST)
//
// Notas: los conteos (count) son agregaciones baratas. Los índices son una
// aproximación (±30 %). El muestreo es aleatorio en colecciones raíz; los grupos
// de subcolecciones se toman en orden de ruta (no aleatorio).

const fs = require('fs');
const path = require('path');
const { storedDocBytes, leafFieldBytes, indexBytesForDoc, percentile } = require(path.join(__dirname, 'lib', 'firestore-size.js'));

const KNOWN_SUBCOLLECTIONS = ['report', 'items', 'offers', 'events', 'recipients', 'subjects', 'campus', 'majors'];
const BILLED_REFERENCE_GIB = '2.8-3.0';
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function parseArgs(argv) {
    const opts = { project: 'peer-teaching', sample: 200, full: false, maxFull: 5000, maxReads: 8000, exempt: '', out: null, allowProd: false };
    const needValue = (i, flag) => {
        if (i + 1 >= argv.length) throw new Error(`Falta valor para ${flag}`);
        return argv[i + 1];
    };
    const num = (raw, flag) => {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} debe ser un entero positivo`);
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--project') { opts.project = needValue(i, a); i++; }
        else if (a === '--sample') { opts.sample = num(needValue(i, a), a); i++; }
        else if (a === '--full') opts.full = true;
        else if (a === '--max-full') { opts.maxFull = num(needValue(i, a), a); i++; }
        else if (a === '--max-reads') { opts.maxReads = num(needValue(i, a), a); i++; }
        else if (a === '--exempt') { opts.exempt = needValue(i, a); i++; }
        else if (a === '--out') { opts.out = needValue(i, a); i++; }
        else if (a === '--allow-prod') opts.allowProd = true;
        else throw new Error(`Argumento desconocido: ${a}`);
    }
    return opts;
}

function randomAnchor(len = 20) {
    let s = '';
    for (let i = 0; i < len; i++) s += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
    return s;
}

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error(`Error de argumentos: ${e.message}`);
        process.exit(1);
    }

    const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    if (!isEmulator && !opts.allowProd) {
        console.error('ABORTADO: no hay FIRESTORE_EMULATOR_HOST y falta --allow-prod.');
        console.error('Este script leería PRODUCCIÓN (solo lectura, tope de lecturas --max-reads).');
        console.error('Para el emulador: FIRESTORE_EMULATOR_HOST=localhost:8080 ... ; para prod: agrega --allow-prod.');
        process.exit(1);
    }

    let admin;
    try {
        admin = require('firebase-admin');
    } catch (e) {
        console.error('No se encontró firebase-admin. Corre con NODE_PATH=functions/node_modules.');
        process.exit(1);
    }

    console.log(isEmulator
        ? `Destino: emulador (${process.env.FIRESTORE_EMULATOR_HOST}), proyecto ${opts.project}`
        : `Destino: PRODUCCIÓN, proyecto ${opts.project}. Tope de lecturas: ${opts.maxReads}.`);

    admin.initializeApp({ projectId: opts.project });
    const db = admin.firestore();
    const FieldPath = admin.firestore.FieldPath;
    const exempt = new Set(opts.exempt.split(',').map((s) => s.trim()).filter(Boolean));

    let reads = 0;
    const reserve = (n) => {
        if (reads + n > opts.maxReads) {
            throw new Error(`Tope --max-reads=${opts.maxReads} alcanzado (${reads} usadas). Abortado para no superarlo.`);
        }
        reads += n;
    };

    // 1) Descubrimiento de colecciones raíz y subcolecciones (sin leer los datos completos).
    const rootCollections = await db.listCollections();
    const rootNames = rootCollections.map((c) => c.id);
    const targets = rootCollections.map((c) => ({ kind: 'root', name: c.id, label: c.id }));

    const discovered = [...KNOWN_SUBCOLLECTIONS];
    for (const col of rootCollections) {
        reserve(1);
        const probe = await col.limit(1).get();
        if (probe.empty) continue;
        const subs = await probe.docs[0].ref.listCollections();
        subs.forEach((s) => {
            if (!discovered.includes(s.id)) discovered.push(s.id);
        });
    }
    for (const name of discovered) {
        if (rootNames.includes(name)) {
            console.log(`Subcolección "${name}" omitida como grupo: coincide con una colección raíz.`);
            continue;
        }
        targets.push({ kind: 'group', name, label: `*/${name} (grupo)` });
    }

    // 2) Conteos baratos (agregación) para todas las colecciones y grupos.
    const rows = [];
    for (const t of targets) {
        const q = t.kind === 'root' ? db.collection(t.name) : db.collectionGroup(t.name);
        reserve(1);
        const snap = await q.count().get();
        const count = snap.data().count;
        if (count === 0) continue;
        rows.push({ ...t, query: q, count });
    }

    // 3) Muestreo o escaneo completo y medición por documento.
    const report = [];
    for (const r of rows) {
        const wantFull = opts.full && r.count <= opts.maxFull;
        const n = wantFull ? r.count : Math.min(r.count, opts.sample);
        const stats = { label: r.label, count: r.count, sampled: 0, full: wantFull, stored: [], index: [], indexExempt: [], fields: {}, topDocs: [] };

        const docs = [];
        if (wantFull) {
            // Escaneo completo en stream para no cargar todo en memoria.
            // Tope duro: se reserva el total antes de leer (el stream precarga lotes).
            reserve(r.count);
            for await (const doc of r.query.stream()) {
                measure(doc, stats, exempt);
            }
            reads -= r.count - stats.sampled;
        } else if (r.kind === 'root') {
            // Muestra aleatoria por ancla de ID; si no alcanza, completa desde el inicio.
            reserve(n);
            const first = await r.query.where(FieldPath.documentId(), '>=', randomAnchor()).orderBy(FieldPath.documentId()).limit(n).get();
            first.docs.forEach((d) => docs.push(d));
            if (docs.length < n) {
                const rest = await r.query.orderBy(FieldPath.documentId()).limit(n - docs.length).get();
                rest.docs.forEach((d) => docs.push(d));
            }
            // Ya se reservaron n lecturas: devolver las que no se usaron (anclas altas).
            reads -= n - docs.length;
            docs.forEach((d) => measure(d, stats, exempt));
        } else {
            // Grupos de subcolección: primeros n por ruta (no aleatorio).
            reserve(n);
            const snap = await r.query.limit(n).get();
            snap.docs.forEach((d) => measure(d, stats, exempt));
        }
        report.push(summarize(stats, exempt.size > 0));
    }

    // 4) Resultados.
    const totalData = report.reduce((s, r) => s + r.estData, 0);
    const totalIdx = report.reduce((s, r) => s + r.estIdx, 0);
    const totalIdxExempt = report.reduce((s, r) => s + r.estIdxExempt, 0);
    const totalBytes = totalData + totalIdx;

    console.log('\nColección / grupo                 docs      n   mediana B      p95 B      máx B   datos MiB  índices MiB');
    for (const r of report.sort((a, b) => b.estTotal - a.estTotal)) {
        console.log(
            `${r.label.padEnd(30)} ${String(r.count).padStart(7)} ${String(r.sampled).padStart(6)} ${String(r.median).padStart(11)} ${String(r.p95).padStart(10)} ${String(r.max).padStart(10)} ${(r.estData / MIB).toFixed(1).padStart(10)} ${(r.estIdx / MIB).toFixed(1).padStart(12)}${r.full ? '  [completo]' : ''}`
        );
    }

    const allTop = report.flatMap((r) => r.topDocs).sort((a, b) => b.bytes - a.bytes).slice(0, 10);
    console.log('\nTop 10 documentos más grandes (muestra):');
    allTop.forEach((d) => console.log(`  ${String(d.bytes).padStart(9)} B  ${d.path}`));

    const fieldTotals = {};
    for (const r of report) {
        for (const [k, v] of Object.entries(r.fieldsScaled)) fieldTotals[k] = (fieldTotals[k] || 0) + v;
    }
    console.log('\nTop 15 campos por bytes acumulados (estimado):');
    Object.entries(fieldTotals).sort((a, b) => b[1] - a[1]).slice(0, 15)
        .forEach(([k, v]) => console.log(`  ${(v / MIB).toFixed(2).padStart(9)} MiB  ${k}`));

    console.log(`\nTotal estimado datos + índices = ${(totalBytes / GIB).toFixed(3)} GiB vs facturado ~${BILLED_REFERENCE_GIB} GiB`);
    if (exempt.size > 0) {
        console.log(`Con exenciones (${[...exempt].join(', ')}): índices ${(totalIdxExempt / MIB).toFixed(1)} MiB (ahorro ~${((totalIdx - totalIdxExempt) / MIB).toFixed(1)} MiB)`);
    }
    if (totalBytes / GIB < 2.5) {
        console.log('Falta mucho para lo facturado: probablemente hay colecciones o documentos fuera de la muestra (cola larga). Prueba --full en la colección dominante.');
    }
    console.log(`Lecturas de documentos usadas: ${reads} (tope ${opts.maxReads}). Conteos: ${targets.length} agregaciones.`);
    console.log('Índices: aproximación ±30 %. Datos: exactos por documento según reglas de tamaño de Firestore.');

    if (opts.out) {
        const summary = { generatedAt: new Date().toISOString(), project: opts.project, emulator: isEmulator, reads, totalBytes, totalIdxExempt, collections: report, topDocs: allTop, fields: fieldTotals };
        fs.writeFileSync(opts.out, JSON.stringify(summary, null, 2));
        console.log(`Resumen guardado en ${opts.out}`);
    }
}

function measure(doc, stats, exempt) {
    const docPath = doc.ref.path;
    const collectionId = doc.ref.parent.id;
    const data = doc.data() || {};
    const stored = storedDocBytes(docPath, data);
    stats.sampled++;
    stats.stored.push(stored);
    stats.index.push(indexBytesForDoc(docPath, data, collectionId));
    stats.indexExempt.push(exempt.size ? indexBytesForDoc(docPath, data, collectionId, exempt) : null);
    for (const [fp, bytes] of Object.entries(leafFieldBytes(data))) {
        const key = `${collectionId}.${fp}`;
        stats.fields[key] = (stats.fields[key] || 0) + bytes;
    }
    stats.topDocs.push({ path: docPath, bytes: stored });
    stats.topDocs.sort((a, b) => b.bytes - a.bytes);
    stats.topDocs.length = Math.min(stats.topDocs.length, 10);
}

function summarize(stats, hasExempt) {
    const n = stats.sampled;
    const sumOf = (arr) => arr.reduce((s, v) => s + v, 0);
    const meanStored = n ? sumOf(stats.stored) / n : 0;
    const meanIdx = n ? sumOf(stats.index) / n : 0;
    const meanIdxExempt = hasExempt && n ? sumOf(stats.indexExempt) / n : meanIdx;
    const sortedStored = [...stats.stored].sort((a, b) => a - b);
    const scale = n ? stats.count / n : 0;
    const fieldsScaled = {};
    for (const [k, v] of Object.entries(stats.fields)) fieldsScaled[k] = v * scale;
    return {
        label: stats.label,
        count: stats.count,
        sampled: n,
        full: stats.full,
        median: percentile(sortedStored, 50),
        p95: percentile(sortedStored, 95),
        max: sortedStored.length ? sortedStored[sortedStored.length - 1] : 0,
        estData: meanStored * stats.count,
        estIdx: meanIdx * stats.count,
        estIdxExempt: meanIdxExempt * stats.count,
        estTotal: (meanStored + meanIdx) * stats.count,
        topDocs: stats.topDocs,
        fieldsScaled
    };
}

main().catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
});
