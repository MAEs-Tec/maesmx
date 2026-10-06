import { callCostFunction, operationIdFor, completeOperation } from '../costApi';
import { getPeerAdvisoryCount, getDashboardStatistics } from './statistics';
import { getAsesoriasPage, exportAsesorias, currentSemester, calendarKey } from './advisoryQueries';
export { getAsesoriasPage, exportAsesorias } from './advisoryQueries';
import { firestoreDB } from "../client";
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
    getDoc,
} from 'firebase/firestore';
import { 
    updatePoints,
    updateRatingBonusPoints
} from './users'; 
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys, userTag } from '../cache/config';
import {
    calculateRatingBonus,
    getAdvisoryPointsReason,
    getIndividualAdvisoryPoints,
    POINTS_RULES,
    toMillis
} from "../../utils/PointsUtils";



function normalizeDateKey(date) {
    if (!date) {
        return 'all';
    }

    if (date instanceof Date) {
        return calendarKey(date);
    }

    return String(date);
}

function getCurrentSemesterRange(referenceDate = new Date()) {
    const now = referenceDate;
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
    return toMillis(value);
}

function isRealAsesoria(asesoria) {
    return asesoria?._test !== true && !asesoria?._type;
}

// Registra la asesoría del mae
export async function addAsesoria(maeInfo, userInfo, subject, comment, rating) {
    const payload = { peerUid: maeInfo.uid, subjectId: subject.id, comment: comment || '', rating: rating ?? null };
    const key = `register:${userInfo.uid}:${maeInfo.uid}:${subject.id}:${comment || ''}:${rating ?? ''}`;
    const operationId = operationIdFor(key);
    const result = await callCostFunction('registerAdvisory', { ...payload, operationId });
    completeOperation(key);
    await invalidateCacheTags([`statistics:peer:${maeInfo.uid}`, 'statistics:dashboard', 'statistics:leaderboard', CACHE_TAGS.LEADERBOARD, userTag(maeInfo.uid), CACHE_TAGS.MAES]);
    await invalidateAsesoriaCaches();
    return result;
}

export async function getAsesoriasCountForUserInCurrentSemester(userId, options = {}) { return getPeerAdvisoryCount(userId, options); }


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
    const range = options.startDate ? options : currentSemester();
    if (options.exportAll) return exportAsesorias({ ...range, peerUid: uid });
    return (await getAsesoriasPage({ ...range, ...options, peerUid: uid })).items;
}

export async function updateAllExperienceAsesorias() { throw new Error('Utiliza el mantenimiento versionado de estadísticas; no se recalculan puntos históricos automáticamente'); }

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


// Función para actualizar puntos basados en el nuevo sistema de asesorías.
export async function updateExperienceAsesorias() { throw new Error('Los puntos se calculan al registrar la asesoría en el backend'); }

export async function getEvaluacionesRecibidas(uid, revealedAt = undefined, clearedAt = null, options = {}) {
    try {
        const includeTests = options.includeTests === true;
        const asesorias = await getAsesoriasByUid(uid, options);

        return (asesorias ?? [])
            .filter(a => a.rating != null && a.duplicate !== true && (includeTests || !a._test))
            .filter(a => {
                const dateMs = toMillis(a.date);
                if (includeTests && a._test) return true;
                if (clearedAt && dateMs !== null && dateMs <= toMillis(clearedAt)) return false;
                if (revealedAt === undefined) return true;
                if (!revealedAt) return false;
                return dateMs !== null && dateMs <= toMillis(revealedAt);
            })
            .sort((a, b) => (toMillis(b.date) || 0) - (toMillis(a.date) || 0));
    } catch (error) {
        console.error("Error fetching evaluaciones recibidas:", error);
        return [];
    }
}

export async function updateRatingBonusForMae(uid) { return { uid, managedByBackend: true }; }

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
        })).filter(isRealAsesoria);

        return asesorias;
    } catch (error) {
        console.error("Error fetching asesorias: ", error);
        return [];
    }
}
export async function updateAsesoria(id, data) {
    const key = `evaluation:${id}:${JSON.stringify(data)}`;
    const result = await callCostFunction('updateAdvisory', { id, patch: data, operationId: operationIdFor(key) });
    completeOperation(key);
    await invalidateCacheTags(['statistics', CACHE_TAGS.MAES, CACHE_TAGS.LEADERBOARD, CACHE_TAGS.USERS]);
    await invalidateAsesoriaCaches();
    return result;
}
  

  export async function getTotalAsesorias() { return (await getDashboardStatistics()).totalAsesorias; }


export async function getAsesoriasCountByUser() { return (await getDashboardStatistics()).totalUniqueUsers; }

export async function getAsesoriasCountByArea() { return Object.values((await getDashboardStatistics()).areas).map(a => ({ area: a.label, totalAsesorias: a.totalAsesorias, totalUniqueUsers: a.totalUniqueUsers })); }


export async function getAsesoriasCountByCampus() { return Object.values((await getDashboardStatistics()).campuses).map(a => ({ campus: a.label, totalAsesorias: a.totalAsesorias })); }

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

export async function borrarTodasEvaluaciones() {
    const asesoriasRef = collection(firestoreDB, "asesorias");
    const snap = await getDocs(asesoriasRef);
    if (snap.empty) return { scanned: 0, cleared: 0, failed: 0, sampleErrors: [] };

    const docs = snap.docs.filter(d => {
        const data = d.data();
        return isRealAsesoria(data) && data.rating != null;
    });

    const results = await Promise.allSettled(
        docs.map(d => updateDoc(d.ref, { rating: null, comment: '' }))
    );

    let cleared = 0;
    let failed = 0;
    const sampleErrors = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            cleared++;
        } else {
            failed++;
            if (sampleErrors.length < 3) {
                sampleErrors.push({ id: docs[i].id, reason: r.reason?.message || String(r.reason) });
            }
        }
    });

    await invalidateAsesoriaCaches();
    if (failed > 0) {
        console.error(`borrarTodasEvaluaciones: fallaron ${failed}/${docs.length}. Ejemplos:`, sampleErrors);
    }
    console.log(`borrarTodasEvaluaciones: ${cleared} limpiadas en DB, ${failed} fallidas`);

    return { scanned: snap.size, cleared, failed, sampleErrors };
}

export async function getAsesorias(startDate = null, endDate = null, options = {}) {
    const range = startDate || endDate ? { startDate, endDate } : currentSemester();
    return options.exportAll ? exportAsesorias(range) : (await getAsesoriasPage({ ...range, ...options })).items;
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
