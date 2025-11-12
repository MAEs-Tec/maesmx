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
import { firestoreDB } from "../../main";
import {
    getDocs,
    getDoc,
    addDoc,
    setDoc,
    doc,
    collection,
    query,
    where,
    serverTimestamp
} from 'firebase/firestore';
import { getCurrentUser } from './users';

export const VIDEO_MANAGER_ROLES = ['admin', 'tec', 'coordi'];

function assertVideoPermissions(user) {
    if (!VIDEO_MANAGER_ROLES.includes(user?.role)) {
        const role = user?.role ?? 'unknown';
        throw new Error(`Insufficient permissions for role '${role}' to manage Maeteca videos`);
    }
}

// ✅ CREAR documentos
export async function addVideoToMaeteca(videoData) {
    try {
        const user = await getCurrentUser();
        if (!user) throw new Error('No authenticated user for write');

        assertVideoPermissions(user);

        const payload = {
            ...videoData,
            createdBy: { uid: user.uid, role: user.role },
            createdAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(firestoreDB, "videos"), payload);
        console.log("Documento agregado con ID:", docRef.id);
        return docRef;
    } catch (error) {
        console.error("Error agregando documento:", error);
        throw error;
    }
}


// ✅ LEER todos los videos
export async function getAllVideos() {
    try {
        const videosRef = collection(firestoreDB, "videos");
        const snapshot = await getDocs(videosRef);

        if (snapshot.empty) {
            console.log("No se encontraron videos ❌");
            return [];
        }

        const videos = [];
        snapshot.forEach(doc => {
            videos.push({ id: doc.id, ...doc.data() });
        });

        return videos;
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

// Extrae el id de YouTube desde varias formas de URL
export function extractYoutubeId(url) {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
        /youtube\.com\/watch\?v=([^&]+)/,
        /youtube\.com\/embed\/([^?]+)/,
        /youtu\.be\/([^?]+)/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m?.[1]) return m[1];
    }
    return null;
}

export async function loadMaetecaVideos() {
    const data = await getAllVideos();
    return Array.isArray(data) ? data : [];
}

// Obtener un video por su id de documento
export async function getVideoById(id) {
    if (!id) return null;
    try {
        const docRef = doc(firestoreDB, 'videos', id);
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) {
            console.log(`Documento con id ${id} no encontrado`);
            return null;
        }
        return { id: snapshot.id, ...snapshot.data() };
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
    if (id) return `https://www.youtube.com/embed/${id}`;
    return url;
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

// ✅ BUSCAR por array "Relacionado"
export async function getVideosByRelated(relacionadoItem) {
    try {
        const videosRef = collection(firestoreDB, "videos");
        const q = query(
            videosRef, 
            where("Relacionado", "array-contains", relacionadoItem)
        );
        
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            console.log("No se encontraron documentos ❌");
            return [];
        }

        const videos = [];
        snapshot.forEach(doc => {
            videos.push({ id: doc.id, ...doc.data() });
        });

        return videos;
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
                        const ref = await addVideoToMaeteca(item);
                        if (ref && ref.id) insertedIds.push(ref.id);
                        console.log(`Agregado: ${item.Titulo} -> ${ref?.id}`);
                }
                console.log(`Videos de ejemplo creados ✅ Total: ${insertedIds.length}`);
                return insertedIds;
        } catch (error) {
                console.error("Error creando videos de ejemplo:", error);
                throw error;
        }
}

