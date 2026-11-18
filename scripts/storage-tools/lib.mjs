// Helpers puros del script de recompresion de Storage. Sin dependencias: se pueden probar sin red.

export const MARK = 'resize-v1';
export const DEFAULT_PROJECT = 'peer-teaching';
export const DEFAULT_PREFIXES = ['users/', 'announcements/'];

export const CONFIGS = {
    users: { maxW: 320, maxH: 320, fit: 'cover', format: 'jpeg', quality: 80, skipIfBytesBelow: 60 * 1024, cache: 'public, max-age=3600' },
    announcements: { maxW: 1280, maxH: 1280, fit: 'inside', format: 'keep', quality: 78, skipIfBytesBelow: 250 * 1024, cache: 'public, max-age=31536000, immutable' }
};

// Elige la configuracion por ruta del objeto. Devuelve null si la ruta no se procesa.
export function configForPath(name = '') {
    if (/^users\/[^/]+\/photo$/.test(name)) {
        return { name: 'users', ...CONFIGS.users };
    }
    if (name.startsWith('announcements/')) {
        return { name: 'announcements', ...CONFIGS.announcements };
    }
    return null;
}

// Decide que hacer con un objeto antes de descargarlo.
// action: 'skip' | 'cache-only' | 'recompress'
export function planAction({ name = '', contentType, size, width, height, cacheControl, metadata, force = false }) {
    if (name.endsWith('/')) {
        return { action: 'skip', reason: 'carpeta', cfg: null };
    }
    const cfg = configForPath(name);
    if (!cfg) {
        return { action: 'skip', reason: 'ruta no configurada', cfg: null };
    }
    if (!force && metadata?.optimizedBy === MARK) {
        return { action: 'skip', reason: 'ya optimizado', cfg };
    }
    if (!String(contentType ?? '').startsWith('image/')) {
        return { action: 'skip', reason: 'no es imagen', cfg };
    }
    const small = size < cfg.skipIfBytesBelow
        && width <= cfg.maxW * 1.25
        && height <= cfg.maxH * 1.25;
    if (small && cacheControl === cfg.cache) {
        return { action: 'skip', reason: 'ya es pequeno', cfg };
    }
    if (small) {
        return { action: 'cache-only', reason: 'pequeno, solo cacheControl', cfg };
    }
    return { action: 'recompress', reason: '', cfg };
}

// Formato de salida para una imagen existente. null si no se soporta.
export function outputFormat(contentType, cfg) {
    if (cfg.format === 'jpeg') {
        return 'jpeg';
    }
    if (contentType === 'image/jpeg') return 'jpeg';
    if (contentType === 'image/png') return 'png';
    if (contentType === 'image/webp') return 'webp';
    return null;
}

// Guarda de produccion. Devuelve null si se puede continuar, o {code, message}.
export function productionGuard({ apply = false, iKnowProd = false, emulatorHost = '' } = {}) {
    if (emulatorHost) {
        return null;
    }
    if (apply && !iKnowProd) {
        return {
            code: 2,
            message: 'MODO PRODUCCION: --apply requiere ademas --i-know-this-is-prod. No se modifico nada.'
        };
    }
    return null;
}

// Lee un valor KEY=valor de un texto tipo .env sin imprimir nada mas.
export function readEnvValue(text = '', key) {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm');
    const match = text.match(re);
    if (!match) return '';
    return match[1].trim().replace(/^["']|["']$/g, '');
}

// Interpreta argv. Lanza Error con mensaje claro si un flag no se conoce.
export function parseArgs(argv = []) {
    const opts = {
        bucket: '',
        project: DEFAULT_PROJECT,
        prefixes: [],
        apply: false,
        iKnowProd: false,
        backupDir: '',
        limit: 0,
        concurrency: 4,
        force: false,
        help: false
    };
    const takeValue = (i, flag) => {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(`Falta el valor de ${flag}`);
        }
        return value;
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--bucket': opts.bucket = takeValue(i, arg); i++; break;
            case '--project': opts.project = takeValue(i, arg); i++; break;
            case '--prefix': opts.prefixes.push(takeValue(i, arg)); i++; break;
            case '--backup-dir': opts.backupDir = takeValue(i, arg); i++; break;
            case '--limit': opts.limit = Number(takeValue(i, arg)); i++; break;
            case '--concurrency': opts.concurrency = Number(takeValue(i, arg)); i++; break;
            case '--apply': opts.apply = true; break;
            case '--i-know-this-is-prod': opts.iKnowProd = true; break;
            case '--force': opts.force = true; break;
            case '--help':
            case '-h': opts.help = true; break;
            default:
                throw new Error(`Opcion desconocida: ${arg}`);
        }
    }
    if (opts.prefixes.length === 0) {
        opts.prefixes = [...DEFAULT_PREFIXES];
    }
    for (const prefix of opts.prefixes) {
        if (!DEFAULT_PREFIXES.includes(prefix)) {
            throw new Error(`Prefijo no soportado: ${prefix}`);
        }
    }
    if (!Number.isInteger(opts.limit) || opts.limit < 0) {
        throw new Error('--limit debe ser un entero >= 0');
    }
    if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
        throw new Error('--concurrency debe ser un entero >= 1');
    }
    return opts;
}
