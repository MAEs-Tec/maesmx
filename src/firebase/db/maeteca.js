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

export const VIDEO_MANAGER_ROLES = ['admin', 'tec'];

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

    const patterns = [
        /youtube\.com\/watch\?v=([^&]+)/,
        /youtube\.com\/embed\/([^?]+)/,
        /youtu\.be\/([^?]+)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
            return `https://www.youtube.com/embed/${match[1]}`;
        }
    }

    // Si no es un enlace de YouTube reconocible, devolver la URL tal cual (puede ser ya un embed)
    return url;
}

export function getVideoThumbnail(video) {
    if (!video) return null;
    if (video.Thumbnail) return video.Thumbnail;

    const url = video.Video;
    if (!url) return null;

    const patterns = [
        /youtube\.com\/watch\?v=([^&]+)/,
        /youtube\.com\/embed\/([^?]+)/,
        /youtu\.be\/([^?]+)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
            return `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
        }
    }

    return null;
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


export async function createSampleVideos() {
    const user = await getCurrentUser();
    if (!user) throw new Error('No authenticated user for write');
    assertVideoPermissions(user);
    console.log("Usuario autenticado:", user); // Verifica la información del usuario
    try {
        // Video con ID automático
        await addVideoToMaeteca({
            Informacion: "Video explicativo sobre bibliotecas digitales",
            Relacionado: ["biblioteca", "digital", "recursos"],
            Titulo: "¿Qué es una biblioteca digital?",
            Video: "https://www.youtube.com/watch?v=mGbv1A_PKDY"
        });
        // Video con ID automático
        await addVideoToMaeteca({
            Informacion: "Video explicativo sobre bibliotecas digitales",
            Relacionado: ["biblioteca", "digital", "recursos"],
            Titulo: "¿Qué es una biblioteca digital?",
            Video: "https://www.youtube.com/watch?v=mGbv1A_PKDY"
        });
        // Video con ID automático
        await addVideoToMaeteca({
            Informacion: "Video explicativo sobre bibliotecas digitales",
            Relacionado: ["biblioteca", "digital", "recursos"],
            Titulo: "¿Qué es una biblioteca digital?",
            Video: "https://www.youtube.com/watch?v=mGbv1A_PKDY"
        });
        // Video con ID automático
        await addVideoToMaeteca({
            Informacion: "Video explicativo sobre bibliotecas digitales",
            Relacionado: ["biblioteca", "digital", "recursos"],
            Titulo: "¿Qué es una biblioteca digital?",
            Video: "https://www.youtube.com/watch?v=mGbv1A_PKDY"
        });
        // Video con ID automático
        await addVideoToMaeteca({
            Informacion: "Video explicativo sobre bibliotecas digitales",
            Relacionado: ["biblioteca", "digital", "recursos"],
            Titulo: "¿Qué es una biblioteca digital?",
            Video: "https://www.youtube.com/watch?v=mGbv1A_PKDY"
        });
        // Video con ID automático
        await addVideoToMaeteca({
            Informacion: "Video explicativo sobre bibliotecas digitales",
            Relacionado: ["biblioteca", "digital", "recursos"],
            Titulo: "¿Qué es una biblioteca digital?",
            Video: "https://www.youtube.com/watch?v=mGbv1A_PKDY"
        });


        console.log("Videos de ejemplo creados ✅");
    } catch (error) {
        console.error("Error creando videos de ejemplo:", error);
        throw error;
    }
}

