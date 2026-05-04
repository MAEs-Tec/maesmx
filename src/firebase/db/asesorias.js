import { firestoreDB } from "../../main";
import {
    addDoc,
    collection,
    query,
    where,
    getDocs,
    Timestamp,
    updateDoc, 
    doc,
    deleteDoc,
} from 'firebase/firestore';
import { 
    updatePoints,
    updateUserAchievementBadge
} from './users'; 
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';

const SEMESTER_START = new Date('2024-08-05');

function normalizeDateKey(date) {
    if (!date) {
        return 'all';
    }

    if (date instanceof Date) {
        return date.toISOString();
    }

    return String(date);
}

function getCurrentSemesterRange() {
    const now = new Date();
    const currentYear = now.getFullYear();

    if (now.getMonth() < 6) {
        return {
            start: new Date(currentYear, 0, 1),
            end: new Date(currentYear, 5, 30, 23, 59, 59, 999)
        };
    }

    return {
        start: new Date(currentYear, 6, 1),
        end: new Date(currentYear, 11, 31, 23, 59, 59, 999)
    };
}

async function invalidateAsesoriaCaches() {
    await invalidateCacheTags([CACHE_TAGS.ASESORIAS]);
}

function timestampToMs(value) {
    if (!value) return null;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') return new Date(value).getTime();
    return null;
}

// Registra la asesoría del mae
export async function addAsesoria(maeInfo, userInfo, subject, comment, rating) {
    // Changing to use payload instead to debug it
    const payload = {
        peerInfo: {
            uid: maeInfo.uid,
            name: maeInfo.name,
            career: maeInfo.career,
            profilePictureUrl: maeInfo.photoURL || '', // Uses the photoURL pretty sure lol instead of profilePictureURL for some reason -_-
            // Datos para el excel
            area: maeInfo.area || '',
            campus: maeInfo.campus || ''
        },
        userInfo: {
            uid: userInfo.uid,
            name: userInfo.name,
            career: userInfo.career,
            profilePictureUrl: userInfo.photoURL || userInfo.profilePictureUrl || '', // Shouldn't matter because it's the student pero ps si se echan redesign at some point
            // Datos para excel
            area: userInfo.area || '',
            campus: userInfo.campus || '',
            // Added pq me interesa, could help in the future si queremos detectar cuanta de la gente son alumnos o si son maes entre ellos
            role: userInfo.role
        },
        rating,
        comment,
        subject,
        date: Timestamp.now()
    };

    // Debug para ver q se anden guardando los datos correctos
    //console.log("Saving asesoria:", payload);

    await addDoc(collection(firestoreDB, "asesorias"), payload);

    updateExperienceAsesorias(maeInfo.uid, userInfo.uid, subject.id, Timestamp.now());
    await invalidateAsesoriaCaches();
    return;
}

export async function getAsesoriasCountForUserInCurrentSemester(userId, options = {}) {
    const { start, end } = getCurrentSemesterRange();
    const semesterKey = `${start.getFullYear()}-${start.getMonth() < 6 ? '01' : '02'}`;

    return await withCache(
        cacheKeys.asesoriasSemesterByPeer(userId, semesterKey),
        {
            ttlMs: CACHE_TTL_MS.ASESORIAS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ASESORIAS]
        },
        async () => {
            const asesorias = await getAsesorias(start, end, options);
            return (asesorias ?? []).filter((doc) => {
                const dateMs = timestampToMs(doc.date);
                return (
                    doc.peerInfo?.uid === userId &&
                    doc.duplicate !== true &&
                    dateMs !== null &&
                    dateMs >= start.getTime() &&
                    dateMs <= end.getTime()
                );
            }).length;
        }
    );
}


async function fetchAsesoriasFresh(startDate = null, endDate = null) {
    try {
        const asesoriasRef = collection(firestoreDB, "asesorias");
        let q;

        if (startDate && endDate) {
            // Ajustar endDate para incluir todo el último día
            const endDateAdjusted = new Date(endDate);
            endDateAdjusted.setHours(23, 59, 59, 999);

            const startTimestamp = Timestamp.fromDate(new Date(startDate));
            const endTimestamp = Timestamp.fromDate(endDateAdjusted);

            q = query(
                asesoriasRef,
                where("date", ">=", startTimestamp),
                where("date", "<=", endTimestamp)
            );
        } else {
            q = query(asesoriasRef);
        }

        const querySnapshot = await getDocs(q);
        const asesorias = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Ordena las asesorías por fecha de la más reciente a la más antigua
        asesorias.sort((a, b) => {
            const dateA = a.date?.seconds || 0;
            const dateB = b.date?.seconds || 0;
            return dateB - dateA;
        });

        return asesorias;
    } catch (error) {
        console.error("Error fetching asesorias: ", error);
        return [];
    }
}

// Función para obtener asesorías por UID, reutilizando getAsesorias
export async function getAsesoriasByUid(uid, options = {}) {
    try {
        const today = new Date(); 
        const asesorias = await getAsesorias(SEMESTER_START, today, options);

        const asesoriasFiltradas = asesorias.filter(asesoria => asesoria.peerInfo?.uid === uid);

        return asesoriasFiltradas;
    } catch (error) {
        console.error("Error fetching asesorias by UID: ", error);
        return [];
    }
}

export async function updateAllExperienceAsesorias() {
    const startDate = new Date('2024-08-05');
    const today = new Date();
    const asesorias = await getAsesorias(startDate, today);
    const processed = new Set(); // Conjunto para evitar procesar la misma asesoría más de una vez

    for (const advisory of asesorias) {
        const { peerInfo, userInfo, date, subject } = advisory;
        const advisoryDate = date.toDate();

        // Generar clave única para evitar reprocesar la misma asesoría
        const key = `${peerInfo.uid}-${userInfo.uid}-${subject.id}-${advisoryDate.getTime()}`;
        if (processed.has(key)) continue; // Si ya se procesó, omitimos esta asesoría
        processed.add(key); // Marcar como procesada

        // Encontrar asesorías similares en un rango de 2 horas
        const similarAdvisories = asesorias.filter(ad => {
            const adDate = ad.date.toDate();
            return (
                ad.peerInfo.uid === peerInfo.uid &&
                ad.userInfo.uid === userInfo.uid &&
                ad.subject.id === subject.id &&
                Math.abs(adDate.getTime() - advisoryDate.getTime()) <= 2 * 60 * 60 * 1000 // 2 horas en ms
            );
        });

        // Iteramos sobre las asesorías similares y actualizamos el campo 'duplicate'
        for (let i = 0; i < similarAdvisories.length; i++) {
            const ad = similarAdvisories[i];
            const isDuplicate = i > 0; // La primera no es duplicada, las demás sí

            try {
                await updateAdvisoryDuplicateField(ad.id, isDuplicate);
                console.log(
                    ad, 
                    isDuplicate 
                        ? "Marcada como duplicada" 
                        : "Primera ocurrencia - No duplicada"
                );
            } catch (error) {
                console.error(`Error al actualizar la asesoría con ID: ${ad.id}`, error);
            }
        }
    }
    await invalidateAsesoriaCaches();
}

// Función auxiliar para actualizar el campo 'duplicate' en una asesoría
async function updateAdvisoryDuplicateField(advisoryDate, isDuplicate) {
    try {
        const asesoriasRef = collection(firestoreDB, "asesorias");

        const q = query(asesoriasRef, where("date", "==", advisoryDate));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            console.log(`No se encontró ninguna asesoría con la fecha: ${advisoryDate}`);
            return;
        }

        const docRef = querySnapshot.docs[0].ref;

        await updateDoc(docRef, { duplicate: isDuplicate });

        console.log(`Asesoría actualizada correctamente con fecha: ${advisoryDate}`);
    } catch (error) {
        console.error(`Error actualizando la asesoría con fecha ${advisoryDate}:`, error);
        throw error; 
    }
}


// Función para actualizar puntos basados en asesorías similares
export async function updateExperienceAsesorias(peerUid, userUid, subjectId, advisoryDate) {
    try {
        if (!(advisoryDate instanceof Date)) {
            if (advisoryDate.toDate) {
                advisoryDate = advisoryDate.toDate();
            } else {
                advisoryDate = new Date(advisoryDate); 
            }
        }

        const today = Timestamp.now().toDate();
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0); 
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999); 

        const asesoriasRef = collection(firestoreDB, "asesorias");

        const q = query(
            asesoriasRef,
            where("date", ">=", startOfDay),
            where("date", "<=", endOfDay)
        );


        const querySnapshot = await getDocs(q);
        const asesorias = querySnapshot.docs.map(doc => doc.data());
        const similarAdvisories = asesorias.filter(ad => {
            const adDate = ad.date.toDate();
            return ad.peerInfo.uid === peerUid &&
                ad.userInfo.uid === userUid &&
                ad.subject.id === subjectId && 
                Math.abs(adDate.getTime() - advisoryDate.getTime()) <= 2 * 60 * 60 * 1000;
        });
        const ultimoElemento = asesorias[asesorias.length - 1];
        if (similarAdvisories.length > 1) {
            await updatePoints(peerUid, -150);
            await updateAdvisoryDuplicateField(ultimoElemento.date, true );
            await updateUserAchievementBadge(userUid, "18");
        } else {
            await updateAdvisoryDuplicateField(ultimoElemento.date, false );
            if(subjectId === "MAE"){
                await updatePoints(peerUid, 15); 
            }else{
                await updatePoints(peerUid, 60); 
            }
            
        }
        await invalidateAsesoriaCaches();

    } catch (error) {
        console.error("Error actualizando la experiencia de asesorías:", error);
    }
}

// Función para obtener asesorías por UID, reutilizando getAsesorias
export async function getCommentsByUid(uid, options = {}) {
    try {
        const asesorias = await getAsesoriasByUid(uid, options);
        return asesorias.filter(asesoria => asesoria.comment?.trim());
    } catch (error) {
        console.error("Error fetching asesorias by UID: ", error);
        return [];
    }
}


async function fetchAsesoriasByUidAndRatingFresh(uidUser , uidPeer = null) {
    try {
        const asesoriasRef = collection(firestoreDB, "asesorias");

        let queryConstraints = [
            where("userInfo.uid", "==", uidUser),           
            where("rating", "==", null),
            where("duplicate", "==", false),
        ];

        if (uidPeer) {
            queryConstraints.unshift( where("peerInfo.uid", "==", uidPeer));
        }

        const q = query(asesoriasRef, ...queryConstraints);
        const querySnapshot = await getDocs(q);

        const asesorias = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return asesorias;
    } catch (error) {
        console.error("Error fetching asesorias: ", error);
        return [];
    }
}
export async function updateAsesoria(id, data) {
    try {
     
      const asesoriaRef = doc(firestoreDB, "asesorias", id);
      await updateDoc(asesoriaRef, data);
      await invalidateAsesoriaCaches();
      
      console.log("Asesoria actualizada exitosamente");
    } catch (error) {
      console.error("Error updating asesoria: ", error);
    }
  }
  

  export async function getTotalAsesorias(startDate = null, endDate = null, options = {}) {
    try {
        const asesorias = await getAsesorias(startDate, endDate, options);
        const totalAsesorias = asesorias.length;
        return totalAsesorias;
    } catch (error) {
        console.error("Error fetching total asesorias: ", error);
        return 0; 
    }
}


export async function getAsesoriasCountByUser(options = {}) {
    try {
        const asesorias = await getAsesorias(null, null, options);
        const userAsesoriasSet = new Set((asesorias ?? []).map(doc => doc.userInfo?.uid).filter(Boolean));
        return userAsesoriasSet.size;
    } catch (error) {
        console.error("Error al obtener el conteo de asesorías por usuario: ", error);
        throw error;
    }
}

export async function getAsesoriasCountByArea(options = {}) {
    try {
        const asesorias = await getAsesorias(null, null, options);
        const areasCount = {};

        (asesorias ?? []).forEach(asesoriaData => {
            const subjectArea = asesoriaData?.subject?.area;
            const userUid = asesoriaData?.userInfo?.uid;

            if (subjectArea && userUid) {
                if (!areasCount[subjectArea]) {
                    areasCount[subjectArea] = {
                        totalAsesorias: 0,
                        userUids: new Set()
                    };
                }

                areasCount[subjectArea].totalAsesorias++;
                areasCount[subjectArea].userUids.add(userUid);
            }
        });

        return Object.keys(areasCount).map(area => ({
            area,
            totalAsesorias: areasCount[area].totalAsesorias,
            totalUniqueUsers: areasCount[area].userUids.size
        }));
    } catch (error) {
        console.error("Error al obtener el conteo de asesorías y usuarios por área: ", error);
        throw error;
    }
}


export async function getAsesoriasCountByCampus(options = {}) {
    try {
        const asesorias = await getAsesorias(null, null, options);
        const campusCount = {};

        (asesorias ?? []).forEach(doc => {
            const campus = doc?.userInfo?.campus;
            if (campus) {
                campusCount[campus] = (campusCount[campus] || 0) + 1;
            }
        });

        return Object.keys(campusCount).map(campus => ({
            campus,
            totalAsesorias: campusCount[campus]
        }));
    } catch (error) {
        console.error("Error al obtener el conteo de asesorías por campus: ", error);
        throw error;
    }
}

// Eliminar todas las asesorias pasadas 
export async function deleteOldAsesorias() {
    try {
        const querySnapshot = await getDocs(collection(firestoreDB, "asesorias"));
        const currentYear = new Date().getFullYear();
        
        const deletePromises = [];
        
        querySnapshot.forEach(docSnapshot => {
            const asesoriasData = docSnapshot.data();
            const asesoriasDate = asesoriasData?.date ? new Date(asesoriasData.date) : null;
            
            if (asesoriasDate && asesoriasDate.getFullYear() !== currentYear) {
                deletePromises.push(deleteDoc(doc(firestoreDB, "asesorias", docSnapshot.id)));
            }
        });
        
        await Promise.all(deletePromises);
        await invalidateAsesoriaCaches();
        console.log("Asesorías antiguas eliminadas correctamente.");
    } catch (error) {
        console.error("Error al eliminar asesorías antiguas: ", error);
        throw error;
    }
}

export async function getAsesorias(startDate = null, endDate = null, options = {}) {
    const startKey = normalizeDateKey(startDate);
    const endKey = normalizeDateKey(endDate);

    return await withCache(
        cacheKeys.asesoriasRange(startKey, endKey),
        {
            ttlMs: CACHE_TTL_MS.ASESORIAS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ASESORIAS]
        },
        async () => await fetchAsesoriasFresh(startDate, endDate)
    );
}

export async function getAsesoriasByUidAndRating(uidUser, uidPeer = null, options = {}) {
    return await withCache(
        cacheKeys.asesoriasPendingRating(uidUser, uidPeer ?? 'all'),
        {
            ttlMs: CACHE_TTL_MS.ASESORIAS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ASESORIAS]
        },
        async () => await fetchAsesoriasByUidAndRatingFresh(uidUser, uidPeer)
    );
}
