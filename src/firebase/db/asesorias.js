import { callCostFunction, operationIdFor, completeOperation } from '../costApi';
import { getPeerAdvisoryCount, getDashboardStatistics } from './statistics';
import { getAsesoriasPage, exportAsesorias, currentSemester } from "./advisoryQueries";
export { getAsesoriasPage, exportAsesorias } from './advisoryQueries';
import { firestoreDB } from "../client";
import { collection, getDocs } from "firebase/firestore";
 
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys, userTag } from '../cache/config';








async function invalidateAsesoriaCaches() {
    await invalidateCacheTags([CACHE_TAGS.ASESORIAS]);
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




// Función para obtener asesorías por UID, reutilizando getAsesorias
export async function getAsesoriasByUid(uid, options = {}) {
    const range = options.startDate ? options : currentSemester();
    if (options.exportAll) return exportAsesorias({ ...range, peerUid: uid });
    return (await getAsesoriasPage({ ...range, ...options, peerUid: uid })).items;
}

export async function updateAllExperienceAsesorias() { throw new Error('Utiliza el mantenimiento versionado de estadísticas; no se recalculan puntos históricos automáticamente'); }

// Función auxiliar para actualizar el campo 'duplicate' en una asesoría



// Función para actualizar puntos basados en el nuevo sistema de asesorías.
export async function updateExperienceAsesorias() { throw new Error('Los puntos se calculan al registrar la asesoría en el backend'); }

export async function getEvaluacionesRecibidas(uid, revealedAt = undefined, clearedAt = null, options = {}) {
    if (revealedAt === null) return options.page ? { items: [], cursor: null } : [];
    const page = await getAsesoriasPage({ peerUid: uid, evaluated: true, before: revealedAt, after: clearedAt, ...options });
    page.items = page.items.filter(a => a.duplicate !== true);
    return options.page ? page : page.items;
}

export async function updateRatingBonusForMae(uid) { return { uid, managedByBackend: true }; }

// Función para obtener asesorías por UID, reutilizando getAsesorias
export async function getCommentsByUid(uid, options = {}) {
    try {
        const asesorias = await getAsesoriasByUid(uid, options);
        return asesorias.filter(asesoria => asesoria.comment?.trim());
    } catch (error) {
        console.error("Error fetching asesorias by UID: ", error);
        throw error;
    }
}

async function fetchAsesoriasByUidAndRatingFresh(uidUser, uidPeer = null) {
    return (await getAsesoriasPage({ userUid: uidUser, peerUid: uidPeer, evaluated: false })).items.filter(a => a.duplicate !== true);
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
                deletePromises.push(callCostFunction('deleteAdvisory', { id: docSnapshot.id, operationId: operationIdFor(`delete:${docSnapshot.id}`) }));
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
        docs.map(d => updateAsesoria(d.id, { rating: null, comment: '' }))
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
