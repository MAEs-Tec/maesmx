// Filtra videos por texto en título o descripción, normalizado (MaesActivos style)
import { normalize } from '@/utils/HorarioUtils';
export function filterVideosByText(videos, text) {
    if (!Array.isArray(videos)) return [];
    const normalizeText = typeof text === 'string' ? text : '';
    const query = normalize(normalizeText || '');
    if (!query) return videos;
    return videos.filter(video => {
        const title = normalize(video.Titulo || '');
        const info = normalize(video.Informacion || '');
        return title.includes(query) || info.includes(query);
    });
}
import { firestoreDB, firebaseStorage } from "../../main";
import {
    getDocs,
    addDoc,
    collection,
    serverTimestamp,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    writeBatch
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { extractYoutubeId, validatePdfFile, toSafePdfFileName, MAX_IMPORT_ROWS, MAX_TITLE_LENGTH } from '../../utils/maetecaImport.js';
export { extractYoutubeId } from '../../utils/maetecaImport.js';
import { getCurrentUser } from './users';
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';

export const VIDEO_MANAGER_ROLES = ['admin', 'tec', 'coordi'];

function assertVideoPermissions(user) {
    if (!VIDEO_MANAGER_ROLES.includes(user?.role)) {
        throw new Error('Tu rol no permite administrar la Maeteca.');
    }
}

async function invalidateVideoCaches() {
    await invalidateCacheTags([CACHE_TAGS.VIDEOS]);
}

async function fetchAllVideosFresh() {
    const videosRef = collection(firestoreDB, "videos");
    const snapshot = await getDocs(videosRef);

    if (snapshot.empty) {
        console.log("No se encontraron videos ");
        return [];
    }

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

//  CREAR documentos
export async function addVideoToMaeteca(videoData, { invalidate = true } = {}) {
    try {
        const user = await getCurrentUser();
        if (!user) throw new Error('No authenticated user for write');

        assertVideoPermissions(user);

        if (!extractYoutubeId(videoData?.Video)) throw new Error('El link no es de YouTube.');
        if (!String(videoData?.Titulo ?? '').trim()) throw new Error('Falta el nombre del video.');

        const payload = {
            ...videoData,
            Tipo: 'video',
            createdBy: { uid: user.uid, role: user.role },
            createdAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(firestoreDB, "videos"), payload);
        if (invalidate) {
            await invalidateVideoCaches();
        }
        console.log("Documento agregado con ID:", docRef.id);
        return docRef;
    } catch (error) {
        console.error("Error agregando documento:", error);
        throw error;
    }
}


//  LEER todos los videos
export async function getAllVideos(options = {}) {
    try {
        return await withCache(
            cacheKeys.videosAll(),
            {
                ttlMs: CACHE_TTL_MS.VIDEOS,
                persist: true,
                forceRefresh: options.forceRefresh ?? false,
                tags: [CACHE_TAGS.VIDEOS]
            },
            fetchAllVideosFresh
        );
    } catch (error) {
        console.error("Error obteniendo videos:", error);
        throw error;
    }
}

export function canUserManageVideos(role) {
    return VIDEO_MANAGER_ROLES.includes(role ?? '');
}

// Constantes reutilizables por la UI
export const AVAILABLE_TAG_OPTIONS = [
    { label: '#maeteca', value: 'maeteca' },
    { label: '#general', value: 'general' },
    { label: '#tutorial', value: 'tutorial' },
    { label: '#matematicas', value: 'matematicas' },
    { label: '#Quimica', value: 'Quimica' },
    { label: '#Ciencias sociales', value: 'Ciencias sociales' },
    { label: '#Creatividad', value: 'Creatividad' },
    { label: '#Fisica', value: 'Fisica' }
];

export const TAGS = [
    { name: 'Programación', code: 'PROG' },
    { name: 'Matemáticas', code: 'MATH' },
    { name: 'Física', code: 'PHY' }
];

export const VIDEO_SUBJECTS = [
    { name: 'General', code: 'general' },
    { name: 'Matemáticas', code: 'math' },
    { name: 'Programación', code: 'prog' }
];

export const VIDEO_CAREERS = [
    { name: 'Todas', code: 'all' },
    { name: 'ITC', code: 'itc' },
    { name: 'IMT', code: 'imt' },
    { name: 'IDS', code: 'ids' }
];

export const SEMESTERS = [
    { name: 'Primer Semestre', code: '1' },
    { name: 'Segundo Semestre', code: '2' },
    { name: 'Tercer Semestre', code: '3' }
];

export const TYPES = [
    { name: 'Video', code: 'VID' },
    { name: 'Artículo', code: 'ART' },
    { name: 'Libro', code: 'BOOK' }
];

export const RESOURCE_TYPES = [
    { name: 'Video', code: 'video' },
    { name: 'PDF', code: 'pdf' }
];

export function getResourceType(resource) {
    return resource?.Tipo === 'pdf' ? 'pdf' : 'video';
}

function validTitle(value) {
    const t = String(value ?? '').trim();
    return t.length > 0 && t.length <= MAX_TITLE_LENGTH ? t : null;
}

async function requireManager() {
    const user = await getCurrentUser();
    if (!user) throw new Error('No authenticated user for write');
    assertVideoPermissions(user);
    return user;
}

export async function addVideosBulk(items) {
    const { created } = await saveVideosBulk({ creates: items });
    return { created };
}

// Carga en masa: crea los videos nuevos y actualiza los que ya estaban (por link).
export async function saveVideosBulk({ creates = [], updates = [] } = {}) {
    const user = await requireManager();
    const total = (Array.isArray(creates) ? creates.length : 0) + (Array.isArray(updates) ? updates.length : 0);
    if (total === 0) throw new Error('No hay videos para subir.');
    if (total > MAX_IMPORT_ROWS) throw new Error(`Máximo ${MAX_IMPORT_ROWS} videos por carga.`);

    const relacionado = (value) => (Array.isArray(value) ? value.map((t) => String(t).trim()).filter(Boolean) : []);
    const writes = [];
    creates.forEach((item, i) => {
        if (!extractYoutubeId(item?.Video)) throw new Error(`Elemento ${i + 1}: El link no es de YouTube.`);
        const titulo = validTitle(item?.Titulo);
        if (!titulo) throw new Error(`Elemento ${i + 1}: el nombre del video es obligatorio y de máximo ${MAX_TITLE_LENGTH} caracteres.`);
        writes.push({
            kind: 'create',
            ref: doc(collection(firestoreDB, 'videos')),
            payload: {
                Tipo: 'video',
                Video: item.Video,
                Titulo: titulo,
                Materia: item.Materia ?? 'general',
                Carrera: item.Carrera ?? 'all',
                Relacionado: relacionado(item.Relacionado),
                Informacion: item.Informacion ?? '',
                createdBy: { uid: user.uid, role: user.role },
                createdAt: serverTimestamp()
            }
        });
    });
    updates.forEach((item, i) => {
        if (!item?.id) throw new Error(`Actualización ${i + 1}: falta el recurso.`);
        const titulo = validTitle(item.data?.Titulo);
        if (!titulo) throw new Error(`Actualización ${i + 1}: el nombre del video es obligatorio y de máximo ${MAX_TITLE_LENGTH} caracteres.`);
        writes.push({
            kind: 'update',
            ref: doc(firestoreDB, 'videos', item.id),
            payload: {
                Titulo: titulo,
                Materia: item.data.Materia ?? 'general',
                Carrera: item.data.Carrera ?? 'all',
                Relacionado: relacionado(item.data.Relacionado),
                updatedAt: serverTimestamp()
            }
        });
    });

    let created = 0;
    let updated = 0;
    try {
        for (let i = 0; i < writes.length; i += 400) {
            const chunk = writes.slice(i, i + 400);
            const batch = writeBatch(firestoreDB);
            for (const write of chunk) {
                if (write.kind === 'create') batch.set(write.ref, write.payload);
                else batch.update(write.ref, write.payload);
            }
            await batch.commit();
            created += chunk.filter((w) => w.kind === 'create').length;
            updated += chunk.filter((w) => w.kind === 'update').length;
        }
    } catch (error) {
        const wrapped = new Error(`Se guardaron ${created + updated} de ${total} videos antes del error: ${error.message}`);
        wrapped.created = created;
        wrapped.updated = updated;
        throw wrapped;
    } finally {
        if (created + updated > 0) await invalidateVideoCaches();
    }
    return { created, updated };
}

export async function addPdfToMaeteca({ file, Titulo, Materia, Carrera, Relacionado, Informacion } = {}) {
    const user = await requireManager();
    const fileError = validatePdfFile(file);
    if (fileError) throw new Error(fileError);
    const titulo = validTitle(Titulo);
    if (!titulo) throw new Error(`El nombre es obligatorio y de máximo ${MAX_TITLE_LENGTH} caracteres.`);

    const docRef = doc(collection(firestoreDB, 'videos'));
    const safeName = toSafePdfFileName(file.name);
    const path = `maeteca/${docRef.id}/${safeName}`;
    const fileRef = storageRef(firebaseStorage, path);

    await uploadBytes(fileRef, file, {
        contentType: 'application/pdf',
        contentDisposition: `inline; filename="${safeName}"`,
        cacheControl: 'public, max-age=3600'
    });
    try {
        const url = await getDownloadURL(fileRef);
        await setDoc(docRef, {
            Tipo: 'pdf',
            Archivo: url,
            ArchivoPath: path,
            ArchivoNombre: file.name,
            Titulo: titulo,
            Informacion: Informacion ?? '',
            Materia: Materia ?? 'general',
            Carrera: Carrera ?? 'all',
            Relacionado: [...(Relacionado ?? [])],
            createdBy: { uid: user.uid, role: user.role },
            createdAt: serverTimestamp()
        });
    } catch (error) {
        try {
            await deleteObject(fileRef);
        } catch (cleanupError) {
            console.warn('No se pudo borrar el PDF huérfano:', cleanupError);
        }
        throw error;
    }

    await invalidateVideoCaches();
    return { id: docRef.id };
}

export async function updateMaetecaResource(resource, fields) {
    await requireManager();
    if (!resource?.id) throw new Error('Recurso inválido.');
    const input = fields ?? {};
    const allowed = {};

    if ('Titulo' in input) {
        const t = validTitle(input.Titulo);
        if (!t) throw new Error(`El nombre es obligatorio y de máximo ${MAX_TITLE_LENGTH} caracteres.`);
        allowed.Titulo = t;
    }
    if ('Video' in input) {
        if (getResourceType(resource) !== 'video') throw new Error('Un PDF no tiene link de video.');
        if (!extractYoutubeId(input.Video)) throw new Error('El link no es de YouTube.');
        allowed.Video = String(input.Video).trim();
    }
    if ('Relacionado' in input) {
        if (!Array.isArray(input.Relacionado)) throw new Error('Relacionado debe ser una lista.');
        allowed.Relacionado = [...input.Relacionado];
    }
    for (const key of ['Informacion', 'Materia', 'Carrera']) {
        if (key in input) allowed[key] = input[key];
    }

    if (Object.keys(allowed).length === 0) return;
    await updateDoc(doc(firestoreDB, 'videos', resource.id), { ...allowed, updatedAt: serverTimestamp() });
    await invalidateVideoCaches();
}

export async function deleteMaetecaResource(resource) {
    await requireManager();
    if (!resource?.id) throw new Error('Recurso inválido.');
    if (resource.id === 'intro-maeteca') throw new Error('El video de introducción no se puede eliminar.');

    await deleteDoc(doc(firestoreDB, 'videos', resource.id));

    let fileDeleted = true;
    if (resource.ArchivoPath) {
        try {
            await deleteObject(storageRef(firebaseStorage, resource.ArchivoPath));
        } catch (error) {
            if (error?.code === 'storage/object-not-found') {
                fileDeleted = true;
            } else {
                console.warn('No se pudo borrar el archivo del recurso:', error);
                fileDeleted = false;
            }
        }
    }
    await invalidateVideoCaches();
    return { fileDeleted };
}

export async function loadMaetecaVideos(options = {}) {
    const data = await getAllVideos(options);
    return Array.isArray(data) ? data : [];
}

// Obtener un video por su id de documento
export async function getVideoById(id, options = {}) {
    if (!id) return null;
    try {
        return await withCache(
            cacheKeys.videoById(id),
            {
                ttlMs: CACHE_TTL_MS.VIDEOS,
                persist: true,
                forceRefresh: options.forceRefresh ?? false,
                tags: [CACHE_TAGS.VIDEOS]
            },
            async () => {
                const videos = await getAllVideos(options);
                return (videos ?? []).find((video) => video.id === id) ?? null;
            }
        );
    } catch (error) {
        console.error(`Error obteniendo video ${id}:`, error);
        throw error;
    }
}

// Genera la URL de embed (iframe) para un video de YouTube
export function getVideoEmbedUrl(video) {
    if (!video) return null;
    const url = typeof video === 'string' ? video : video.Video;
    if (!url) return null;
    const id = extractYoutubeId(url);
    return id ? `https://www.youtube.com/embed/${id}` : null;
}

export function getVideoThumbnail(video) {
    if (!video) return null;
    if (video.Thumbnail) return video.Thumbnail;
    const url = video.Video;
    if (!url) return null;
    const id = extractYoutubeId(url);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

export function openVideo(url) {
    if (!url || typeof window === 'undefined') return;
    window.open(url, '_blank', 'noopener');
}

export function handleThumbnailKey(event, url) {
    if (!url) return;
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openVideo(url);
    }
}

//  BUSCAR por array "Relacionado"
export async function getVideosByRelated(relacionadoItem, options = {}) {
    try {
        return await withCache(
            cacheKeys.videosByRelated(relacionadoItem),
            {
                ttlMs: CACHE_TTL_MS.VIDEOS,
                persist: true,
                forceRefresh: options.forceRefresh ?? false,
                tags: [CACHE_TAGS.VIDEOS]
            },
            async () => {
                const videos = await getAllVideos(options);
                return (videos ?? []).filter((video) => Array.isArray(video.Relacionado) && video.Relacionado.includes(relacionadoItem));
            }
        );
    } catch (error) {
        console.error("Error buscando por relacionado:", error);
        throw error;
    }
}

// Actualiza un documento de video
// (removed optional admin/update/delete/filter/subscribe helpers per request)


export async function createSampleVideos() {
        const user = await getCurrentUser();
        if (!user) throw new Error('No authenticated user for write');
        assertVideoPermissions(user);
        console.log("Usuario autenticado:", user); // Verifica la información del usuario

        const samples = [
    {
        "Informacion": "Video explicativo sobre el Método de Euler en modelación matemática.",
        "Relacionado": ["método de euler", "modelación matemática", "aproximación numérica"],
        "Titulo": "Método de Euler",
        "Video": "https://youtu.be/B9YR-GXGncw"
    },
    {
        "Informacion": "Video sobre funciones polinomiales y cómo calcular su derivada.",
        "Relacionado": ["funciones polinomiales", "derivadas", "modelación matemática"],
        "Titulo": "Funciones polinomiales y su derivada",
        "Video": "https://youtu.be/2ntPaw4vkc8"
    },
    {
        "Informacion": "Explicación de la función exponencial y el cálculo de su derivada.",
        "Relacionado": ["función exponencial", "derivadas", "modelación matemática"],
        "Titulo": "Función exponencial y su derivada",
        "Video": "https://youtu.be/6V_LmXGCbSg"
    },
    {
        "Informacion": "Derivación de constantes y suma de funciones en modelación matemática.",
        "Relacionado": ["derivadas", "constantes", "suma de funciones"],
        "Titulo": "Derivada de constante y suma de funciones",
        "Video": "https://youtu.be/9ghBNnZ6t7g"
    },
    {
        "Informacion": "Cómo derivar el producto de dos funciones.",
        "Relacionado": ["derivadas", "producto de funciones", "regla del producto"],
        "Titulo": "Derivada de producto de funciones",
        "Video": "https://youtu.be/8XS55_kOlmk"
    },
    {
        "Informacion": "Derivación de cociente de funciones con ejemplos paso a paso.",
        "Relacionado": ["derivadas", "cociente de funciones", "regla del cociente"],
        "Titulo": "Derivada de cociente de funciones",
        "Video": "https://youtu.be/cw9zLw6k3dA"
    },
    {
        "Informacion": "Uso de la regla de la cadena y derivación implícita.",
        "Relacionado": ["regla de la cadena", "derivación implícita", "derivadas"],
        "Titulo": "Regla de la cadena y derivación implícita",
        "Video": "https://youtu.be/aGRJEaYh9Ws"
    },
    {
        "Informacion": "Cambio de variable en integración y derivación.",
        "Relacionado": ["cambio de variable", "integrales", "derivadas"],
        "Titulo": "Cambio de variable",
        "Video": "https://youtu.be/pMLrvpBF_4o"
    },
    {
        "Informacion": "Integración por partes aplicada a problemas de ingeniería.",
        "Relacionado": ["integrales", "integración por partes", "modelación matemática"],
        "Titulo": "Integración por partes",
        "Video": "https://youtu.be/VzxmmKKY3GM"
    },
    {
        "Informacion": "Concepto y cálculo del plano tangente en superficies.",
        "Relacionado": ["plano tangente", "derivadas parciales", "superficies"],
        "Titulo": "Plano tangente",
        "Video": "https://youtu.be/ZzwEwfFTP7Q"
    },
    {
        "Informacion": "Cómo calcular derivadas direccionales y su interpretación geométrica.",
        "Relacionado": ["derivada direccional", "gradiente", "superficies"],
        "Titulo": "Derivada direccional",
        "Video": "https://youtu.be/RbySC1xgM9o"
    },
    {
        "Informacion": "Uso de la transformada de Laplace en ecuaciones diferenciales.",
        "Relacionado": ["transformada de laplace", "ecuaciones diferenciales", "modelación dinámica"],
        "Titulo": "Transformada de Laplace",
        "Video": "https://youtu.be/-7vsj9f24-c"
    },
    {
        "Informacion": "Conceptos básicos y operaciones con matrices.",
        "Relacionado": ["matrices", "álgebra lineal", "operaciones matriciales"],
        "Titulo": "Matrices: conceptos básicos y operaciones",
        "Video": "https://youtu.be/krpLf9XP4vs"
    },
    {
        "Informacion": "Cómo calcular la matriz de cofactores.",
        "Relacionado": ["matrices", "cofactores", "determinantes"],
        "Titulo": "Matriz de cofactores",
        "Video": "https://youtu.be/9uZ96OEcTuc"
    },
    {
        "Informacion": "Definición y obtención de la matriz adjunta.",
        "Relacionado": ["matrices", "matriz adjunta", "álgebra lineal"],
        "Titulo": "Matriz adjunta",
        "Video": "https://youtu.be/PhJwWFWQQiY"
    },
    {
        "Informacion": "Cálculo de la matriz inversa paso a paso.",
        "Relacionado": ["matrices", "inversa de matriz", "determinantes"],
        "Titulo": "Matriz inversa",
        "Video": "https://youtu.be/nyFLyIeeHmA"
    },
    {
        "Informacion": "Cálculo del determinante en sistemas de ecuaciones nxn.",
        "Relacionado": ["determinantes", "sistemas lineales", "álgebra lineal"],
        "Titulo": "Cálculo del determinante en sistemas nxn",
        "Video": "https://youtu.be/XgWuTkx0CjA"
    },
    {
        "Informacion": "Resolución de sistemas lineales por el método de Gauss-Jordan.",
        "Relacionado": ["gauss-jordan", "sistemas lineales", "álgebra lineal"],
        "Titulo": "Método de Gauss-Jordan",
        "Video": "https://youtu.be/MslG1TrSQO4"
    },
    {
        "Informacion": "Cálculo con operadores aplicado a ingeniería.",
        "Relacionado": ["operadores", "pensamiento computacional", "matemáticas aplicadas"],
        "Titulo": "Cálculo con operadores",
        "Video": "https://youtu.be/AiJIcK3yIZw"
    },
    {
        "Informacion": "Uso del método Solver para resolver problemas de programación lineal.",
        "Relacionado": ["programación lineal", "solver", "análisis de decisiones"],
        "Titulo": "Método Solver en programación lineal",
        "Video": "https://youtu.be/c-DPPmNef0Y"
    },
    {
        "Informacion": "Representación gráfica de modelos de programación lineal.",
        "Relacionado": ["programación lineal", "gráficas", "análisis de decisiones"],
        "Titulo": "Gráficas en programación lineal",
        "Video": "https://youtu.be/RQ2pSyjH-64"
    },
    {
        "Informacion": "Uso del comando Array en AutoCAD.",
        "Relacionado": ["autocad", "comando array", "dibujo asistido"],
        "Titulo": "Comando Array",
        "Video": "https://youtu.be/t3W_DDSnTDU"
    },
    {
        "Informacion": "Cómo usar el comando Offset para crear copias paralelas de objetos.",
        "Relacionado": ["autocad", "offset", "diseño técnico"],
        "Titulo": "Comando Offset",
        "Video": "https://youtu.be/FXU5ZzXTwRQ"
    },
    {
        "Informacion": "Cálculo del área de una figura en AutoCAD.",
        "Relacionado": ["autocad", "área", "medición"],
        "Titulo": "Cálculo del área de una figura",
        "Video": "https://youtu.be/IpBFI7Zhymg"
    },
    {
        "Informacion": "Uso de los comandos Trim y Fillet para edición de figuras.",
        "Relacionado": ["autocad", "trim", "fillet", "dibujo 2D"],
        "Titulo": "Comandos Trim y Fillet",
        "Video": "https://youtu.be/fA-z6OjDvMQ"
    }
];

        const insertedIds = [];
        try {
                for (const item of samples) {
                        // addVideoToMaeteca will attach createdBy and createdAt
                        const ref = await addVideoToMaeteca(item, { invalidate: false });
                        if (ref && ref.id) insertedIds.push(ref.id);
                        console.log(`Agregado: ${item.Titulo} -> ${ref?.id}`);
                }
                await invalidateVideoCaches();
                console.log(`Videos de ejemplo creados  Total: ${insertedIds.length}`);
                return insertedIds;
        } catch (error) {
                console.error("Error creando videos de ejemplo:", error);
                throw error;
        }
}

