#!/usr/bin/env node
// Recomprime una sola vez las fotos de perfil y portadas ya subidas a Storage.
// Por defecto es dry-run (no escribe nada). Ver README en el comentario USAGE.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import sharp from 'sharp';
import { MARK, outputFormat, parseArgs, planAction, productionGuard, readEnvValue } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const USAGE = `Uso: node scripts/storage-tools/resize-storage-photos.mjs [opciones]

  --bucket <nombre>          Bucket (default: STORAGE_BUCKET o VITE_FIREBASE_STORAGE_BUCKET del .env)
  --project <id>             Proyecto (default: peer-teaching)
  --prefix users/            Prefijo a procesar (repetible; default: users/ y announcements/)
  --apply                    Escribe cambios (sin esta bandera es dry-run)
  --i-know-this-is-prod      Obligatorio junto con --apply cuando NO hay FIREBASE_STORAGE_EMULATOR_HOST
  --backup-dir <ruta>        Carpeta local de respaldo (default: ./storage-backup-<fecha>)
  --limit <N>                Procesa solo los primeros N objetos
  --concurrency <N>          Trabajos en paralelo (default: 4)
  --force                    Reprocesa aunque tenga la marca ${MARK}
`;

function formatBytes(n) {
    return `${(n / 1024).toFixed(1)} KB`;
}

// Recompresion de un objeto. Devuelve una fila del reporte.
async function processFile(file, ctx) {
    const { bucket, opts, backupDir } = ctx;
    const name = file.name;
    const [meta] = await file.getMetadata();
    const existingMeta = meta.metadata ?? {};

    // Primera pasada sin dimensiones: solo descarta lo que no depende de la imagen.
    const pre = planAction({
        name,
        contentType: meta.contentType,
        size: Number(meta.size),
        width: Infinity,
        height: Infinity,
        cacheControl: meta.cacheControl,
        metadata: existingMeta,
        force: opts.force
    });
    if (pre.action === 'skip') {
        return { path: name, status: 'omitido', reason: pre.reason };
    }

    const [buf] = await file.download();
    const info = await sharp(buf, { failOn: 'none' }).metadata();
    const swapped = info.orientation >= 5;
    const width = swapped ? info.height : info.width;
    const height = swapped ? info.width : info.height;

    const plan = planAction({
        name,
        contentType: meta.contentType,
        size: buf.length,
        width,
        height,
        cacheControl: meta.cacheControl,
        metadata: existingMeta,
        force: opts.force
    });
    if (plan.action === 'skip') {
        return { path: name, status: 'omitido', reason: plan.reason };
    }

    const cfg = plan.cfg;
    let action = plan.action;
    let out = null;
    let outType = meta.contentType;
    let dims = `${width}x${height}`;

    if (action === 'recompress') {
        const fmt = outputFormat(meta.contentType, cfg);
        if (!fmt) {
            return { path: name, status: 'omitido', reason: `formato no soportado: ${meta.contentType}` };
        }
        let pipe = sharp(buf, { failOn: 'none' })
            .rotate()
            .resize({ width: cfg.maxW, height: cfg.maxH, fit: cfg.fit, withoutEnlargement: true });
        if (fmt === 'jpeg') {
            pipe = pipe.flatten({ background: '#ffffff' }).jpeg({ quality: cfg.quality, mozjpeg: true });
            outType = 'image/jpeg';
        } else if (fmt === 'png') {
            pipe = pipe.png({ compressionLevel: 9, palette: true, quality: cfg.quality });
        } else {
            pipe = pipe.webp({ quality: cfg.quality });
        }
        const result = await pipe.toBuffer({ resolveWithObject: true });
        dims = `${result.info.width}x${result.info.height}`;
        if (result.data.length >= buf.length * 0.9) {
            // Sin ganancia real: solo se actualiza cacheControl, los bytes no cambian.
            action = 'cache-only';
        } else {
            out = result.data;
        }
    }

    const row = {
        path: name,
        status: action,
        antes: buf.length,
        despues: out ? out.length : buf.length,
        dims,
        reason: action === 'cache-only' && plan.action === 'recompress' ? 'sin ganancia, solo cacheControl' : plan.reason
    };
    if (!opts.apply) {
        return row;
    }

    const newMeta = { ...existingMeta, optimizedBy: MARK, originalBytes: String(buf.length) };
    const token = existingMeta.firebaseStorageDownloadTokens;

    if (action === 'cache-only') {
        // Sin cambio de bytes, no hace falta respaldo.
        await file.setMetadata({ cacheControl: cfg.cache, metadata: newMeta });
    } else {
        // Respaldo local verificado antes de sobrescribir.
        const backupPath = join(backupDir, name);
        await mkdir(dirname(backupPath), { recursive: true });
        await writeFile(backupPath, buf);
        await writeFile(`${backupPath}.meta.json`, JSON.stringify({
            generation: meta.generation,
            contentType: meta.contentType,
            metadata: existingMeta,
            cacheControl: meta.cacheControl
        }, null, 2));
        const copied = await stat(backupPath);
        if (copied.size !== buf.length) {
            throw new Error('respaldo incompleto, no se sobrescribe el objeto');
        }

        await file.save(out, {
            resumable: false,
            contentType: outType,
            metadata: { cacheControl: cfg.cache, metadata: newMeta }
        });

        const [after] = await file.getMetadata();
        if (token && after.metadata?.firebaseStorageDownloadTokens !== token) {
            await file.setMetadata({ metadata: { ...existingMeta, optimizedBy: MARK, originalBytes: String(buf.length) } });
            throw new Error('el token de descarga no se conservo; se restauro la metadata, revisar a mano');
        }
        if (!token) {
            row.reason = 'sin token de descarga previo: revisar URLs guardadas';
        }
    }
    return row;
}

async function runPool(items, concurrency, fn) {
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    });
    await Promise.all(workers);
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        console.error(USAGE);
        return 1;
    }
    if (opts.help) {
        console.log(USAGE);
        return 0;
    }

    const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '';
    const guard = productionGuard({ apply: opts.apply, iKnowProd: opts.iKnowProd, emulatorHost });
    if (guard) {
        console.error(guard.message);
        return guard.code;
    }
    console.log(emulatorHost ? 'Modo: EMULADOR' : 'MODO PRODUCCION (sin --apply solo lee)');

    let bucketName = opts.bucket || process.env.STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || '';
    if (!bucketName) {
        try {
            const envText = await readFile(resolve(here, '../../.env'), 'utf8');
            bucketName = readEnvValue(envText, 'VITE_FIREBASE_STORAGE_BUCKET');
        } catch {
            // Sin .env: se pide --bucket abajo
        }
    }
    if (!bucketName) {
        console.error('Falta el bucket: usa --bucket <nombre>');
        return 1;
    }

    admin.initializeApp({ projectId: opts.project, storageBucket: bucketName });
    const bucket = admin.storage().bucket(bucketName);
    const backupDir = opts.backupDir || join(process.cwd(), `storage-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);

    const listed = [];
    for (const prefix of opts.prefixes) {
        const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
        listed.push(...files);
    }
    const files = opts.limit ? listed.slice(0, opts.limit) : listed;
    console.log(`Bucket ${bucketName}: ${files.length} objetos a revisar. Modo ${opts.apply ? 'APPLY' : 'dry-run'}.`);

    const ctx = { bucket, opts, backupDir };
    const totals = { antes: 0, despues: 0, errores: 0, omitidos: 0 };
    await runPool(files, opts.concurrency, async file => {
        try {
            const row = await processFile(file, ctx);
            if (row.status === 'omitido') {
                totals.omitidos++;
                console.log(`omitido\t${row.path}\t${row.reason}`);
                return;
            }
            totals.antes += row.antes ?? 0;
            totals.despues += row.despues ?? 0;
            const pct = row.antes ? Math.round((1 - row.despues / row.antes) * 100) : 0;
            console.log(`${row.status}\t${row.path}\t${formatBytes(row.antes)} -> ${formatBytes(row.despues)} (${pct}%)\t${row.dims}\t${row.reason || ''}`);
        } catch (error) {
            totals.errores++;
            console.error(`ERROR\t${file.name}\t${error.message}`);
        }
    });

    console.log(`Resumen: ${files.length} objetos, omitidos ${totals.omitidos}, errores ${totals.errores}, bytes ${formatBytes(totals.antes)} -> ${formatBytes(totals.despues)}.`);
    if (opts.apply) {
        console.log(`Respaldo local: ${backupDir}`);
    }
    return totals.errores > 0 ? 1 : 0;
}

main().then(code => {
    process.exitCode = code;
}).catch(error => {
    console.error('Fallo inesperado:', error.message);
    process.exitCode = 1;
});
