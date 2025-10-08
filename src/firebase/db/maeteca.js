import { firestoreDB } from "../../main";
import {
    getDocs,
    addDoc,
    setDoc,
    doc,
    collection,
    query,
    where,
    serverTimestamp
} from 'firebase/firestore';
import { getCurrentUser } from './users';

const VIDEO_MANAGER_ROLES = ['admin', 'tec'];

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
            Video: "https://www.youtube.com/embed/EhhYnfaePb4"
        });

        // Video con ID fijo
        await addVideoWithFixedId("intro-maeteca", {
            Informacion: "Introducción a la plataforma Maeteca",
            Relacionado: ["maeteca", "tutorial", "introduccion"],
            Titulo: "Cómo usar la Maeteca",
            Video: "https://www.youtube.com/embed/sample123"
        });

        console.log("Videos de ejemplo creados ✅");
    } catch (error) {
        console.error("Error creando videos de ejemplo:", error);
        throw error;
    }
}

// ✅ CREAR/REEMPLAZAR documento con ID fijo
export async function addVideoWithFixedId(id, videoData) {
    try {
        const user = await getCurrentUser();
        if (!user) throw new Error('No authenticated user for write');
    assertVideoPermissions(user);
        const videoRef = doc(firestoreDB, "videos", id);
        await setDoc(
            videoRef,
            {
                ...videoData,
                createdBy: { uid: user.uid, role: user.role },
                createdAt: serverTimestamp()
            },
            { merge: true }
        );
        console.log(`Documento con ID fijo '${id}' agregado/actualizado ✅`);
        return videoRef;
    } catch (error) {
        console.error("Error agregando documento con ID fijo:", error);
        throw error;
    }
}