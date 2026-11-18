// Utilidades puras para la carga en masa de la Maeteca (sin Firebase ni alias).

export const TEMPLATE_HEADERS = ['Link', 'Nombre del video', 'Materia', 'Carrera', 'Etiquetas'];
export const MAX_IMPORT_ROWS = 500;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 120;
export const GENERAL_SUBJECT = Object.freeze({ id: 'general', name: 'General' });

export function normalizeKey(value) {
    return String(value ?? '')
        .replace(/﻿/g, '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
    'youtu.be'
]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractYoutubeId(url) {
    if (typeof url !== 'string') return null;
    let text = url.trim();
    if (!text) return null;
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;

    let candidate = null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') {
        candidate = segments[0] ?? null;
    } else if (segments[0] === 'watch') {
        candidate = parsed.searchParams.get('v');
    } else if (['embed', 'shorts', 'live'].includes(segments[0])) {
        candidate = segments[1] ?? null;
    }
    return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

export function resolveSubjectValue(input, subjects) {
    const key = normalizeKey(input);
    if (!key || key === 'general') return 'general';
    const list = Array.isArray(subjects) ? subjects : [];
    const found = list.find((s) => s && (normalizeKey(s.name) === key || normalizeKey(s.id) === key));
    return found ? found.id : null;
}

export function resolveCareerValue(input, careers) {
    const key = normalizeKey(input);
    if (!key) return 'all';
    const list = Array.isArray(careers) ? careers : [];
    const found = list.find((c) => c && (normalizeKey(c.name) === key || normalizeKey(c.code) === key));
    return found ? found.code : null;
}

export function resolveTagValue(input, tagOptions) {
    const key = normalizeKey(String(input ?? '').trim().replace(/^#+/, ''));
    if (!key) return null;
    const list = Array.isArray(tagOptions) ? tagOptions : [];
    const found = list.find((o) => o && (
        normalizeKey(o.value) === key
        || normalizeKey(String(o.label ?? '').replace(/^#+/, '')) === key
    ));
    return found ? found.value : null;
}

const cell = (value) => String(value ?? '').trim();

export function parseVideoRows(rows, { subjects, careers, tagOptions, existingVideos } = {}) {
    const list = Array.isArray(rows) ? rows : [];

    const dataRows = [];
    list.forEach((row, index) => {
        if (!row || typeof row !== 'object') return;
        const values = Object.values(row);
        if (values.every((v) => cell(v) === '')) return;
        const rowNumber = typeof row.__rowNum__ === 'number' ? row.__rowNum__ + 1 : index + 2;
        dataRows.push({ row, rowNumber });
    });

    if (dataRows.length === 0) {
        throw new Error('El archivo no tiene filas con videos. Llena la hoja "Videos" de la plantilla.');
    }

    const headerMap = new Map();
    for (const row of list) {
        if (!row || typeof row !== 'object') continue;
        for (const key of Object.keys(row)) {
            const norm = normalizeKey(key);
            if (!headerMap.has(norm)) headerMap.set(norm, key);
        }
    }
    const required = [TEMPLATE_HEADERS[0], TEMPLATE_HEADERS[1]];
    const missing = required.filter((h) => !headerMap.has(normalizeKey(h)));
    if (missing.length) {
        throw new Error(`Faltan las columnas: ${missing.join(', ')}. Usa la plantilla.`);
    }

    if (dataRows.length > MAX_IMPORT_ROWS) {
        throw new Error(`El archivo tiene ${dataRows.length} filas con datos; el máximo es ${MAX_IMPORT_ROWS}. Divídelo en varios archivos.`);
    }

    const get = (row, header) => {
        const original = headerMap.get(normalizeKey(header));
        return original === undefined ? '' : cell(row[original]);
    };

    const existingIds = new Set();
    for (const v of Array.isArray(existingVideos) ? existingVideos : []) {
        if (!v || v.Tipo === 'pdf') continue;
        const id = extractYoutubeId(v.Video);
        if (id) existingIds.add(id);
    }
    const seenInFile = new Map();
    const careerList = Array.isArray(careers) ? careers : [];

    const valid = [];
    const invalid = [];

    for (const { row, rowNumber } of dataRows) {
        const link = get(row, 'Link');
        const titulo = get(row, 'Nombre del video');
        const materiaTxt = get(row, 'Materia');
        const carreraTxt = get(row, 'Carrera');
        const etiquetasTxt = get(row, 'Etiquetas');
        const errors = [];

        let videoId = null;
        if (!link) {
            errors.push('Falta el link.');
        } else {
            videoId = extractYoutubeId(link);
            if (!videoId) errors.push('El link no es de YouTube.');
        }

        if (!titulo) errors.push('Falta el nombre del video.');
        else if (titulo.length > MAX_TITLE_LENGTH) errors.push(`El nombre pasa de ${MAX_TITLE_LENGTH} caracteres.`);

        const materia = resolveSubjectValue(materiaTxt, subjects);
        if (materia === null) errors.push(`La materia "${materiaTxt}" no existe.`);

        const carrera = resolveCareerValue(carreraTxt, careers);
        if (carrera === null) {
            errors.push(`La carrera "${carreraTxt}" no existe. Usa ${careerList.map((c) => c.name).join(', ')}.`);
        }

        const relacionado = [];
        if (etiquetasTxt) {
            for (const part of etiquetasTxt.split(',').map((t) => t.trim()).filter(Boolean)) {
                const tag = resolveTagValue(part, tagOptions);
                if (tag === null) errors.push(`La etiqueta "${part}" no existe.`);
                else if (!relacionado.includes(tag)) relacionado.push(tag);
            }
        }

        if (videoId) {
            if (existingIds.has(videoId)) {
                errors.push('Este video ya está en la Maeteca.');
            } else if (seenInFile.has(videoId)) {
                errors.push(`Este video ya aparece en la fila ${seenInFile.get(videoId)}.`);
            }
        }

        if (errors.length) {
            invalid.push({
                rowNumber,
                raw: { link, titulo, materia: materiaTxt, carrera: carreraTxt, etiquetas: etiquetasTxt },
                errors
            });
        } else {
            seenInFile.set(videoId, rowNumber);
            valid.push({
                rowNumber,
                data: {
                    Tipo: 'video',
                    Video: link,
                    Titulo: titulo,
                    Materia: materia,
                    Carrera: carrera,
                    Relacionado: relacionado,
                    Informacion: ''
                }
            });
        }
    }

    return { valid, invalid };
}

// Hojas de la plantilla de carga en masa, como matrices de celdas. La hoja "Materias"
// sale del catálogo actual para que se pueda buscar y copiar el nombre o la clave.
export function buildTemplateSheets({ subjects, careers, tagOptions } = {}) {
    const subjectList = (Array.isArray(subjects) ? subjects : [])
        .filter((s) => s && s.id && s.name)
        .map((s) => [String(s.id), String(s.name)])
        .sort((a, b) => a[1].localeCompare(b[1], 'es'));
    const careerNames = (Array.isArray(careers) ? careers : []).map((c) => c.name).join(', ');
    const tagValues = (Array.isArray(tagOptions) ? tagOptions : []).map((o) => o.value).join(', ');

    return {
        Videos: [[...TEMPLATE_HEADERS]],
        Instrucciones: [
            ['Columna', 'Obligatoria', 'Qué poner', 'Ejemplo'],
            ['Link', 'Sí', 'Link de YouTube (youtube.com/watch?v=..., youtu.be/..., youtube.com/embed/... o youtube.com/shorts/...). Un video por fila.', 'https://youtu.be/B9YR-GXGncw'],
            ['Nombre del video', 'Sí', `Título que se muestra en la tarjeta. Máximo ${MAX_TITLE_LENGTH} caracteres.`, 'Método de Euler'],
            ['Materia', 'No', 'Nombre o clave de la materia, tal como aparece en la hoja "Materias". Vacío = General.', subjectList[0]?.[0] ?? 'General'],
            ['Carrera', 'No', `${careerNames}. Vacío = Todas.`, 'ITC'],
            ['Etiquetas', 'No', `Una o varias separadas por coma, sin #. Opciones: ${tagValues}.`, 'matematicas, tutorial'],
            [],
            ['Notas'],
            ['Llena la hoja "Videos" a partir de la fila 2. No cambies ni reordenes los encabezados de la fila 1.'],
            ['Las filas totalmente vacías se ignoran.'],
            [`Máximo ${MAX_IMPORT_ROWS} videos por archivo.`],
            ['En la hoja "Materias" puedes buscar con Ctrl+B y copiar la clave o el nombre.']
        ],
        Materias: [['Clave', 'Nombre'], [GENERAL_SUBJECT.id, GENERAL_SUBJECT.name], ...subjectList]
    };
}

export function validatePdfFile(file) {
    if (!file) return 'Elige un archivo PDF.';
    const type = file.type ?? '';
    const isPdf = type === 'application/pdf'
        || (type === '' && /\.pdf$/i.test(String(file.name ?? '')));
    if (!isPdf) return 'Solo se permiten archivos PDF.';
    if (file.size === 0) return 'El archivo está vacío.';
    if (file.size >= MAX_PDF_BYTES) return 'El PDF debe pesar menos de 10 MB.';
    return null;
}

export function toSafePdfFileName(name) {
    const base = String(name ?? '')
        .replace(/\.[^./\\]*$/, '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 80)
        .replace(/^[-.]+|[-.]+$/g, '');
    return `${base || 'documento'}.pdf`;
}
