import { firestoreDB } from "../../main";
import {
    addDoc,
    collection,
    query,
    getDocs,
    where,
    updateDoc,
    doc, 
    getDoc,
    deleteDoc,
    serverTimestamp,
    runTransaction
} from 'firebase/firestore';
import { addAnnoucement } from "../img/users";
import { 
    updatePoints
} from './users'; 
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';
import { POINTS_RULES } from "../../utils/PointsUtils";

// createdAt puede ser Timestamp, Date o faltar en anuncios viejos; sin fecha van al inicio
const createdAtMs = (announcement) => {
    const createdAt = announcement?.createdAt;
    if (!createdAt) return 0;
    if (typeof createdAt.seconds === 'number') return createdAt.seconds * 1000;
    const time = new Date(createdAt).getTime();
    return Number.isNaN(time) ? 0 : time;
};

const sortByCreatedAt = (a, b) => createdAtMs(a) - createdAtMs(b);

const toDateOrNull = (value) => {
    if (!value) return null;
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

async function invalidateAnnouncementCaches() {
    await invalidateCacheTags([CACHE_TAGS.ANNOUNCEMENTS, CACHE_TAGS.GROUP_ANNOUNCEMENTS]);
}

export async function saveAnnouncement(announcementData, selectedFile) {
    try {
        console.log(announcementData.maesAsignados)
        let imageUrl = '';

        if (selectedFile) {
            const filePath = `announcements/${announcementData.type}/${selectedFile.name}`;
            imageUrl = await addAnnoucement(selectedFile, filePath);
        }
        const docRef = await addDoc(collection(firestoreDB, 'announcements'), {
            ...announcementData,
            imageUrl, 
            preregister: {},
            asistence: {},
            createdAt: new Date(),
            visible: true
        });

        await invalidateAnnouncementCaches();
        return docRef.id;
    } catch (error) {
        console.error('Error al guardar el anuncio:', error);
        throw error;
    }
}

async function fetchAnnouncementsEditFresh() {
    try {
        const announcementsCollection = collection(firestoreDB, 'announcements');
        
        const querySnapshot = await getDocs(query(announcementsCollection));
        
        const announcements = querySnapshot.docs
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
            }))
            .sort(sortByCreatedAt);


        return announcements;
    } catch (error) {
        console.error('Error fetching announcements:', error);
        throw error;
    }
}


async function fetchAnnouncementsFresh() {
    try {
        const announcementsCollection = collection(firestoreDB, 'announcements');
        const q = query(announcementsCollection, where('visible', '==', true));
        const querySnapshot = await getDocs(q);
        const now = new Date();
        console.log(querySnapshot.docs)
        const announcements = querySnapshot.docs
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
            }))
            .filter(announcement => {
                // Filtrar por fecha válida
                if (announcement.dateTime) {
                    const dateTime = announcement.dateTime.seconds
                        ? new Date(announcement.dateTime.seconds * 1000)
                        : new Date(announcement.dateTime);
                    if (dateTime < now && dateTime.toDateString() !== now.toDateString()) {
                        return false;
                    }
                }

                // Filtrar por visible o tipo Especial
                const isVisible = announcement.visible === true;
                const isSpecial = announcement.id === undefined;
                console.log(announcement.type)
                console.log(announcement.visible)
                return isVisible || isSpecial;
            })
            .sort(sortByCreatedAt);
            console.log(announcements)
        return announcements;
    } catch (error) {
        console.error('Error fetching announcements:', error);
        throw error;
    }
}


async function fetchAnnouncementsGrupalesFresh() {
    try {
        const announcementsCollection = collection(firestoreDB, 'announcements');

        const q = query(
            announcementsCollection,
            where('type', '==', 'Asesoría'),
            where('visible', '==', true)
        );

        const querySnapshot = await getDocs(q);

        const now = new Date();
        console.log(now);
        const announcements = querySnapshot.docs
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
                dateTime: toDateOrNull(doc.data().dateTime), 
            }))
            .filter(ann => {
                // Sin fecha válida no se puede mostrar como próxima asesoría
                if (!ann.dateTime) return false;
                return ann.dateTime >= now || ann.dateTime.toDateString() === now.toDateString();
            })
            .sort(sortByCreatedAt); // Ordenar por fecha de creación

        console.log(announcements);
        return announcements;
    } catch (error) {
        console.error('Error fetching announcements:', error);
        throw error;
    }
}


export async function addUserToPreregsiter(announcementId, user) {
    try {
        const announcementRef = doc(firestoreDB, 'announcements', announcementId);
        const announcementSnapshot = await getDoc(announcementRef);
        if (!announcementSnapshot.exists()) {
            throw new Error(`El anuncio con ID ${announcementId} no existe.`);
        }

        const announcementData = announcementSnapshot.data();

        const currentPreregs = announcementData.preregister || {};
        if (currentPreregs[user.uid]) {
            throw new Error('Usuario ya registrado');
        }
        const updatedPreregs = {
            ...currentPreregs,
            [user.uid]: user,
        };

        const currentAsistence = announcementData.asistence || {};
        const updatedAsistence = {
            ...currentAsistence,
            [user.uid]: false,
        };

        await updateDoc(announcementRef, {
            preregister: updatedPreregs,
            asistence: updatedAsistence,
        });

        await invalidateAnnouncementCaches();
        console.log(`Usuario ${user.uid} agregado exitosamente a preregister y asistencia.`);
    } catch (error) {
        console.error('Error añadiendo usuario a preregister:', error);
        throw error; 
    }
}


export async function processAsistence(announcementId) {
    const announcementRef = doc(firestoreDB, 'announcements', announcementId);
    const announcementSnapshot = await getDoc(announcementRef);
    const data = announcementSnapshot.data();

    const preregister = data.preregister || {};
    const asistence = data.asistence || {};
    const dateTime = data.dateTime || '';

    const preregisterKeys = Object.keys(preregister);
    if (preregisterKeys.length === 0) {
        console.log("No preregister data found.");
        return [];  
    }

    const result = preregisterKeys.map(uid => {
        const user = preregister[uid];

        return {
            uid: uid,
            dateTime: dateTime,
            name: user.name || '',
            career: user.career || '',
            area: user.area || '',
            campus: user.campus || '',
            asistence: asistence[uid] || false 
        };
    });

    console.log("Result:", result);
    return result;
}


// status explícito (true/false); si no se manda, alterna el valor actual
export async function updateUserAsistence(announcementId, userId, status) {
    try {
        const announcementRef = doc(firestoreDB, 'announcements', announcementId);

        // La transacción reclama pointsAwarded junto con la asistencia: si dos personas
        // marcan al mismo tiempo o se reintenta, solo una otorga los puntos grupales.
        const { newAsistenceStatus, maesToAward } = await runTransaction(firestoreDB, async (transaction) => {
            const announcementSnapshot = await transaction.get(announcementRef);
            if (!announcementSnapshot.exists()) {
                throw new Error(`El anuncio con ID ${announcementId} no existe.`);
            }

            const announcementData = announcementSnapshot.data();
            const currentAsistence = announcementData.asistence || {};
            const maesAsignados = announcementData.maesAsignados || [];

            const newAsistenceStatus = typeof status === 'boolean' ? status : !currentAsistence[userId];
            const updatedAsistence = {
                ...currentAsistence,
                [userId]: newAsistenceStatus,
            };

            const awardableMaes = maesAsignados.filter(mae => mae?.uid && mae.assigned !== false);
            const shouldAwardGroupPoints = newAsistenceStatus && announcementData.pointsAwarded !== true && awardableMaes.length > 0;
            const pointsUpdate = shouldAwardGroupPoints
                ? {
                    pointsAwarded: true,
                    pointsAwardedAt: serverTimestamp(),
                    pointsAwardedTo: awardableMaes.map(mae => mae.uid)
                }
                : {};

            transaction.update(announcementRef, {
                asistence: updatedAsistence,
                ...pointsUpdate
            });

            return { newAsistenceStatus, maesToAward: shouldAwardGroupPoints ? awardableMaes : [] };
        });

        // Se otorgan después de reclamar pointsAwarded: un fallo aquí puede dejar puntos sin dar, nunca duplicados
        for (const mae of maesToAward) {
            try {
                await updatePoints(mae.uid, POINTS_RULES.groupAdvisory);
                console.log(`Puntos de asesoría grupal para ${mae.name}: +${POINTS_RULES.groupAdvisory}`);
            } catch (pointsError) {
                console.error(`No se pudieron otorgar los puntos grupales a ${mae.uid}:`, pointsError);
            }
        }

        await invalidateAnnouncementCaches();
        console.log(`Asistencia para el usuario ${userId} actualizada exitosamente a ${newAsistenceStatus}.`);
        return newAsistenceStatus;
    } catch (error) {
        console.error('Error actualizando la asistencia del usuario:', error);
        throw error;
    }
}


export async function processConfirms(announcementId) {
    const announcementRef = doc(firestoreDB, 'announcements', announcementId);
    const announcementSnapshot = await getDoc(announcementRef);
    const data = announcementSnapshot.data();

    const preregister = data.preregister || {};  
    const asistence = data.asistence || {}; 
    const dateTime = data.dateTime || '';  

    const preregisterKeys = Object.keys(preregister);  
    if (preregisterKeys.length === 0) {
        console.log("No preregister data found.");
        return [];  
    }

    const result = preregisterKeys
        .filter(uid => asistence[uid] === true)  
        .map(uid => {
            const user = preregister[uid];  
            console.log("Processing user:", user);

            return {
                uid: uid,
                dateTime: dateTime,
                name: user.name || '',
                career: user.career || '',
                area: user.area || '',
                campus: user.campus || '',
                asistence: true 
            };
        });
    return result; 
}


export async function addExtraVariables() {
    try {
        const usersRef = collection(firestoreDB, 'announcements');
        const querySnapshot = await getDocs(usersRef);
        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref; 
                return updateDoc(userRef, {
                    maesAsignados: []
                });
          
        });

        await Promise.all(promises);
        await invalidateAnnouncementCaches();

        console.log("Background have been successfully added to eligible users.");
    } catch (error) {
        console.error("Error adding background to eligible users: ", error);
        throw error;
    }
}

async function fetchAnnouncementsAllGrupalesFresh() {
    try {
        const announcementsCollection = collection(firestoreDB, 'announcements');

        const q = query(
            announcementsCollection,
            where('type', '==', 'Asesoría')
        );

        const querySnapshot = await getDocs(q);

        const now = new Date(); 
        const announcements = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            dateTime: toDateOrNull(doc.data().dateTime),
        })).filter(announcement => announcement.dateTime);

        const futureAnnouncements = announcements
            .filter(announcement => 
                announcement.dateTime > now || 
                announcement.dateTime.toDateString() === now.toDateString()
            ) 
            .sort((a, b) => a.dateTime - b.dateTime); 

        const pastAnnouncements = announcements
            .filter(announcement => 
                announcement.dateTime < now &&
                announcement.dateTime.toDateString() !== now.toDateString()
            )
            .sort((a, b) => a.dateTime - b.dateTime); 

   
        const sortedAnnouncements = [...futureAnnouncements, ...pastAnnouncements];


        return sortedAnnouncements;
    } catch (error) {
        console.error('Error fetching announcements:', error);
        throw error;
    }
}

export async function deleteAnnouncementById(id) {
    try {
        const announcementDocRef = doc(firestoreDB, "announcements", id);
        
        await deleteDoc(announcementDocRef);
        await invalidateAnnouncementCaches();
        
        console.log(`Announcement with ID ${id} deleted successfully.`);
    } catch (error) {
        console.error(`Error deleting announcement with ID ${id}:`, error);
        throw error;
    }
}

export async function updateAnnouncement(announcementId, updatedData, selectedFile = null) {
    try {
        const docRef = doc(firestoreDB, 'announcements', announcementId);  
        let imageUrl;

        if (selectedFile) {
            const announcementType = updatedData.type || 'Otro';
            const filePath = `announcements/${announcementType}/${announcementId}-${Date.now()}-${selectedFile.name}`;
            imageUrl = await addAnnoucement(selectedFile, filePath);
        }

        await updateDoc(docRef, {
            ...updatedData,
            ...(imageUrl ? { imageUrl } : {})
        });

        await invalidateAnnouncementCaches();
        return docRef.id;  
    } catch (error) {
        console.error('Error al actualizar el anuncio:', error);
        throw error;
    }
}

export const toggleVisibilityById = async (id) => {
  try {
    console.log(id)
    const dialogDocRef = doc(firestoreDB,  'announcements', id);

    const docSnap = await getDoc(dialogDocRef);

    if (docSnap.exists()) {
      const currentVisibility = docSnap.data().visible

      await updateDoc(dialogDocRef, {
        visible: !currentVisibility
      });

      await invalidateAnnouncementCaches();
      console.log(`Visibilidad del diálogo con ID ${id} actualizada correctamente`);
    } else {
      console.log("El documento no existe");
    }
  } catch (error) {
    console.error(`Error al actualizar la visibilidad del diálogo con ID ${id}:`, error);
    throw error;
  }
};

export async function getAnnouncementsEdit(options = {}) {
    return await withCache(
        cacheKeys.announcementsEdit(),
        {
            ttlMs: CACHE_TTL_MS.ANNOUNCEMENTS_EDIT,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS]
        },
        fetchAnnouncementsEditFresh
    );
}

export async function getAnnouncements(options = {}) {
    return await withCache(
        cacheKeys.announcementsVisible(),
        {
            ttlMs: CACHE_TTL_MS.ANNOUNCEMENTS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS]
        },
        fetchAnnouncementsFresh
    );
}

export async function getAnnouncementsGrupales(options = {}) {
    return await withCache(
        cacheKeys.announcementsGroup(),
        {
            ttlMs: CACHE_TTL_MS.GROUP_ANNOUNCEMENTS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS, CACHE_TAGS.GROUP_ANNOUNCEMENTS]
        },
        fetchAnnouncementsGrupalesFresh
    );
}

export async function getAnnouncementsAllGrupales(options = {}) {
    return await withCache(
        cacheKeys.announcementsAllGroup(),
        {
            ttlMs: CACHE_TTL_MS.GROUP_ANNOUNCEMENTS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS, CACHE_TAGS.GROUP_ANNOUNCEMENTS]
        },
        fetchAnnouncementsAllGrupalesFresh
    );
}
