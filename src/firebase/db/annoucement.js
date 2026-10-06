import { measuredRead } from '../diagnostics';
const getDocs = (...args) => measuredRead('firestore:annoucement:query', () => getDocsRaw(...args));
const getDoc = (...args) => measuredRead('firestore:annoucement:document', () => getDocRaw(...args));
function mexicoDayStart() {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return Timestamp.fromDate(new Date(`${key}T00:00:00-06:00`));
}
function announcementDate(value) {
    if (!value) return null;
    if (value?.toDate) return value;
    return Timestamp.fromDate(new Date(value));
}
import { callCostFunction } from '../costApi';
import { firestoreDB } from "../client";
import { addDoc, collection, query, getDocs as getDocsRaw, where, and, or, Timestamp, updateDoc, doc, getDoc as getDocRaw, deleteDoc } from "firebase/firestore";
import { addAnnoucement } from "../img/users";
 
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';


async function invalidateAnnouncementCaches() {
    await invalidateCacheTags([CACHE_TAGS.ANNOUNCEMENTS, CACHE_TAGS.GROUP_ANNOUNCEMENTS]);
}

export async function saveAnnouncement(announcementData, selectedFile) {
    try {
        console.log(announcementData.maesAsignados)
        let imageUrl = '';
        let imagePath = null;

        if (selectedFile) {
            const filePath = `announcements/${crypto.randomUUID()}/image.webp`;
            imagePath = filePath;
            imageUrl = await addAnnoucement(selectedFile, filePath);
        }
        const docRef = await addDoc(collection(firestoreDB, 'announcements'), {
            ...announcementData,
            imageUrl, imagePath, dateTime: announcementDate(announcementData.dateTime), 
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
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt )); 


        return announcements;
    } catch (error) {
        console.error('Error fetching announcements:', error);
        throw error;
    }
}


async function fetchAnnouncementsFresh() {
    try {
        const announcementsCollection = collection(firestoreDB, 'announcements');
        const q = query(announcementsCollection, and(where('visible', '==', true), or(where('dateTime', '>=', mexicoDayStart()), where('dateTime', '==', null))));
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
            .sort((a, b) => {
                const dateA = a.createdAt.seconds ? new Date(a.createdAt.seconds * 1000) : new Date(a.createdAt);
                const dateB = b.createdAt.seconds ? new Date(b.createdAt.seconds * 1000) : new Date(b.createdAt);
                return dateA - dateB;
            });
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
            where('visible', '==', true),
            where('dateTime', '>=', mexicoDayStart())
        );

        const querySnapshot = await getDocs(q);

        const now = new Date();
        console.log(now);
        const announcements = querySnapshot.docs
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
                dateTime: doc.data().dateTime.toDate(), 
            }))
            .filter(ann => {
                return ann.dateTime >= now || ann.dateTime.toDateString() === now.toDateString();
            })
            .sort((a, b) => a.createdAt.seconds - b.createdAt.seconds); // Ordenar por fecha de creación

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


export async function updateUserAsistence(announcementId, userId) {
    const snap = await getDoc(doc(firestoreDB, 'announcements', announcementId));
    const result = await callCostFunction('setGroupAttendance', { id: announcementId, uid: userId, present: !snap.data()?.asistence?.[userId] });
    await invalidateAnnouncementCaches();
    await invalidateCacheTags([CACHE_TAGS.LEADERBOARD, CACHE_TAGS.MAES]);
    return result;
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
            dateTime: doc.data().dateTime.toDate(),
        }));

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
        let imageUrl; let imagePath;
        const previous = (await getDoc(docRef)).data();

        if (selectedFile) {
            
            const filePath = `announcements/${announcementId}/${crypto.randomUUID()}.webp`;
            imagePath = filePath;
            imageUrl = await addAnnoucement(selectedFile, filePath);
        }

        await updateDoc(docRef, {
            ...updatedData,
            ...(imageUrl ? { imageUrl, imagePath } : {}),
            ...(updatedData.dateTime !== undefined ? { dateTime: announcementDate(updatedData.dateTime) } : {})
        });

        if (imagePath && previous?.imagePath && previous.imagePath !== imagePath) {
            await callCostFunction('cleanupAnnouncementImage', { path: previous.imagePath }).catch(error => {
                console.warn('La imagen sustituida queda pendiente de limpieza:', error.message);
            });
        }

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
