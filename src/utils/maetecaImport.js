// Utilidades puras para la carga en masa de la Maeteca (sin Firebase ni alias).

export const TEMPLATE_HEADERS = ['Link', 'Nombre del video', 'Materia', 'Carrera', 'Etiquetas'];
export const MAX_IMPORT_ROWS = 500;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 120;
export const MAX_TAG_LENGTH = 40;
export const GENERAL_SUBJECT = Object.freeze({ id: 'general', name: 'General' });
export const ALL_CAREERS = Object.freeze({ name: 'Todas', code: 'all', fullName: 'Todas las carreras' });

export function normalizeKey(value) {
    return String(value ?? '')
        .replace(/\uFEFF/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
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
    const found = list.find((c) => c && (
        normalizeKey(c.name) === key
        || normalizeKey(c.code) === key
        || (c.fullName && normalizeKey(c.fullName) === key)
    ));
    return found ? found.code : null;
}

// Opciones de carrera a partir del catálogo schools/tec.mx/majors. El código va en
// minúsculas para seguir leyendo los videos que ya guardaron 'itc', 'imt', etc.
export function buildCareerOptions(majors, fallback = []) {
    const seen = new Set(['all']);
    const options = [];
    for (const major of Array.isArray(majors) ? majors : []) {
        const siglas = String(major?.id ?? '').trim();
        const code = siglas.toLowerCase();
        if (!siglas || seen.has(code)) continue;
        seen.add(code);
        options.push({ name: siglas, code, fullName: String(major.name ?? '').trim() || siglas });
    }
    if (!options.length) {
        const rest = (Array.isArray(fallback) ? fallback : []).filter((c) => c && c.code !== 'all');
        return [ALL_CAREERS, ...rest.map((c) => ({ fullName: c.name, ...c }))];
    }
    options.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return [ALL_CAREERS, ...options];
}

// Texto de una etiqueta tal como se guarda: sin # al inicio y sin espacios de sobra.
export function cleanTag(input) {
    return String(input ?? '').trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
}

// Etiquetas conocidas: las de la lista base más las que ya usan los recursos.
export function buildTagOptions(baseOptions, resources) {
    const byKey = new Map();
    const add = (value, label) => {
        const tag = cleanTag(value);
        const key = normalizeKey(tag);
        if (!tag || byKey.has(key)) return;
        byKey.set(key, { value: tag, label: label || `#${tag}` });
    };
    for (const option of Array.isArray(baseOptions) ? baseOptions : []) add(option?.value, option?.label);
    for (const resource of Array.isArray(resources) ? resources : []) {
        for (const tag of Array.isArray(resource?.Relacionado) ? resource.Relacionado : []) add(tag);
    }
    return [...byKey.values()].sort((a, b) => a.value.localeCompare(b.value, 'es'));
}

// Devuelve la etiqueta existente que coincide o, si no hay, la nueva ya limpia.
// null si queda vacía o pasa del largo máximo.
export function resolveTagValue(input, tagOptions) {
    const tag = cleanTag(input);
    const key = normalizeKey(tag);
    if (!key || tag.length > MAX_TAG_LENGTH) return null;
    const list = Array.isArray(tagOptions) ? tagOptions : [];
    const found = list.find((o) => o && (
        normalizeKey(o.value) === key
        || normalizeKey(cleanTag(o.label)) === key
    ));
    return found ? found.value : tag;
}

const cell = (value) => String(value ?? '').trim();

const sameList = (a, b) => {
    const left = [...(Array.isArray(a) ? a : [])].sort();
    const right = [...(Array.isArray(b) ? b : [])].sort();
    return left.length === right.length && left.every((v, i) => v === right[i]);
};

// Lee las filas de la hoja "Videos". Un link que ya está en la Maeteca no se duplica:
// la fila actualiza ese video (nombre, materia, carrera y etiquetas).
// Devuelve { valid (nuevos), updates, unchanged, invalid, newTags }.
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

    // id de YouTube -> recursos de video que ya lo usan
    const existingById = new Map();
    for (const v of Array.isArray(existingVideos) ? existingVideos : []) {
        if (!v || v.Tipo === 'pdf') continue;
        const id = extractYoutubeId(v.Video);
        if (id) existingById.set(id, [...(existingById.get(id) ?? []), v]);
    }
    const seenInFile = new Map();
    const careerList = Array.isArray(careers) ? careers : [];
    const knownTags = new Set((Array.isArray(tagOptions) ? tagOptions : []).map((o) => normalizeKey(o?.value)));
    const newTags = new Map();

    const valid = [];
    const updates = [];
    const unchanged = [];
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
            errors.push(`La carrera "${carreraTxt}" no existe. Usa las siglas de la hoja "Carreras" (${careerList.slice(0, 6).map((c) => c.name).join(', ')}${careerList.length > 6 ? '…' : ''}).`);
        }

        const relacionado = [];
        const rowNewTags = [];
        if (etiquetasTxt) {
            for (const part of etiquetasTxt.split(',').map((t) => t.trim()).filter(Boolean)) {
                const tag = resolveTagValue(part, tagOptions);
                if (tag === null) {
                    if (cleanTag(part)) errors.push(`La etiqueta "${part}" pasa de ${MAX_TAG_LENGTH} caracteres.`);
                } else if (!relacionado.some((t) => normalizeKey(t) === normalizeKey(tag))) {
                    relacionado.push(tag);
                    if (!knownTags.has(normalizeKey(tag))) rowNewTags.push(tag);
                }
            }
        }

        const matches = videoId ? existingById.get(videoId) ?? [] : [];
        if (videoId) {
            if (seenInFile.has(videoId)) {
                errors.push(`Este video ya aparece en la fila ${seenInFile.get(videoId)}.`);
            } else if (matches.length > 1) {
                errors.push(`Este video está ${matches.length} veces en la Maeteca. Edítalo desde la página.`);
            }
        }

        if (errors.length) {
            invalid.push({
                rowNumber,
                raw: { link, titulo, materia: materiaTxt, carrera: carreraTxt, etiquetas: etiquetasTxt },
                errors
            });
            continue;
        }

        seenInFile.set(videoId, rowNumber);
        for (const tag of rowNewTags) {
            if (!newTags.has(normalizeKey(tag))) newTags.set(normalizeKey(tag), tag);
        }

        if (matches.length === 1) {
            const current = matches[0];
            const data = { Titulo: titulo, Materia: materia, Carrera: carrera, Relacionado: relacionado };
            const same = cell(current.Titulo) === titulo
                && (current.Materia || 'general') === materia
                && (current.Carrera || 'all') === carrera
                && sameList(current.Relacionado, relacionado);
            if (same) unchanged.push({ rowNumber, id: current.id, titulo, link });
            else updates.push({ rowNumber, id: current.id, link, data });
            continue;
        }

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

    return { valid, updates, unchanged, invalid, newTags: [...newTags.values()] };
}

// Fila de la hoja "Videos" para un recurso existente, en el mismo formato que se carga.
function videoRow(video, subjects, careers) {
    const subjectList = Array.isArray(subjects) ? subjects : [];
    const materiaId = video.Materia || 'general';
    let materia = GENERAL_SUBJECT.name;
    if (materiaId !== 'general') {
        const subject = subjectList.find((s) => s && s.id === materiaId);
        const repeated = subject && subjectList.filter((s) => s && normalizeKey(s.name) === normalizeKey(subject.name)).length > 1;
        materia = subject && !repeated ? String(subject.name) : String(materiaId);
    }
    const carreraCode = video.Carrera || 'all';
    const career = (Array.isArray(careers) ? careers : []).find((c) => c && c.code === carreraCode);
    const carrera = career ? career.name : (carreraCode === 'all' ? ALL_CAREERS.name : String(carreraCode).toUpperCase());
    const etiquetas = (Array.isArray(video.Relacionado) ? video.Relacionado : []).map(cleanTag).filter(Boolean).join(', ');
    return [String(video.Video ?? ''), String(video.Titulo ?? ''), materia, carrera, etiquetas];
}

// Hojas de la plantilla de carga en masa, como matrices de celdas. Las hojas "Materias" y
// "Carreras" salen de los catálogos para que se pueda buscar y copiar el nombre o la clave.
// Con `videos`, la hoja "Videos" sale llena con los videos actuales (para editarlos y volver a subirlos).
export function buildTemplateSheets({ subjects, careers, tagOptions, videos } = {}) {
    const subjectList = (Array.isArray(subjects) ? subjects : [])
        .filter((s) => s && s.id && s.name)
        .map((s) => [String(s.id), String(s.name)])
        .sort((a, b) => a[1].localeCompare(b[1], 'es'));
    const careerList = (Array.isArray(careers) ? careers : []).filter((c) => c && c.name);
    const careerRows = careerList.map((c) => [String(c.name), String(c.fullName ?? c.name)]);
    const tagValues = (Array.isArray(tagOptions) ? tagOptions : []).map((o) => o.value).join(', ');
    const videoRows = (Array.isArray(videos) ? videos : [])
        .filter((v) => v && v.Tipo !== 'pdf' && v.Video)
        .map((v) => videoRow(v, subjects, careerList));

    return {
        Videos: [[...TEMPLATE_HEADERS], ...videoRows],
        Instrucciones: [
            ['Columna', 'Obligatoria', 'Qué poner', 'Ejemplo'],
            ['Link', 'Sí', 'Link de YouTube (youtube.com/watch?v=..., youtu.be/..., youtube.com/embed/... o youtube.com/shorts/...). Un video por fila.', 'https://youtu.be/B9YR-GXGncw'],
            ['Nombre del video', 'Sí', `Título que se muestra en la tarjeta. Máximo ${MAX_TITLE_LENGTH} caracteres.`, 'Método de Euler'],
            ['Materia', 'No', 'Nombre o clave de la materia, tal como aparece en la hoja "Materias". Vacío = General.', subjectList[0]?.[0] ?? 'General'],
            ['Carrera', 'No', 'Siglas o nombre de la carrera, tal como aparece en la hoja "Carreras". Vacío = Todas.', careerRows[1]?.[0] ?? 'Todas'],
            ['Etiquetas', 'No', `Una o varias separadas por coma, sin #. Puedes usar las que ya existen o escribir nuevas (máximo ${MAX_TAG_LENGTH} caracteres cada una). Existentes: ${tagValues || 'ninguna'}.`, 'matematicas, tutorial'],
            [],
            ['Notas'],
            ['Llena la hoja "Videos" a partir de la fila 2. No cambies ni reordenes los encabezados de la fila 1.'],
            ['Si el link ya está en la Maeteca, la fila actualiza ese video (nombre, materia, carrera y etiquetas) en vez de duplicarlo.'],
            ['Las filas totalmente vacías se ignoran. Borrar una fila no borra el video de la Maeteca.'],
            [`Máximo ${MAX_IMPORT_ROWS} videos por archivo.`],
            ['En las hojas "Materias" y "Carreras" puedes buscar con Ctrl+B y copiar la clave o el nombre.']
        ],
        Materias: [['Clave', 'Nombre'], [GENERAL_SUBJECT.id, GENERAL_SUBJECT.name], ...subjectList],
        Carreras: [['Siglas', 'Nombre'], ...careerRows]
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
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 80)
        .replace(/^[-.]+|[-.]+$/g, '');
    return `${base || 'documento'}.pdf`;
}
