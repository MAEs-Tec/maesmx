import * as asesoriaDb from './asesorias.legacy';
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

export async function addAsesoria(maeInfo, userInfo, subject, comment, rating) {
    const result = await asesoriaDb.addAsesoria(maeInfo, userInfo, subject, comment, rating);
    await invalidateAsesoriaCaches();
    return result;
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
        async () => await asesoriaDb.getAsesorias(startDate, endDate)
    );
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

export async function getAsesoriasByUid(uid, options = {}) {
    const today = new Date();
    const asesorias = await getAsesorias(SEMESTER_START, today, options);
    return (asesorias ?? []).filter((asesoria) => asesoria.peerInfo?.uid === uid);
}

export async function updateAllExperienceAsesorias() {
    const result = await asesoriaDb.updateAllExperienceAsesorias();
    await invalidateAsesoriaCaches();
    return result;
}

export async function updateExperienceAsesorias(peerUid, userUid, subjectId, advisoryDate) {
    const result = await asesoriaDb.updateExperienceAsesorias(peerUid, userUid, subjectId, advisoryDate);
    await invalidateAsesoriaCaches();
    return result;
}

export async function getCommentsByUid(uid, options = {}) {
    const asesorias = await getAsesoriasByUid(uid, options);
    return (asesorias ?? []).filter((asesoria) => asesoria.comment?.trim());
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
        async () => await asesoriaDb.getAsesoriasByUidAndRating(uidUser, uidPeer)
    );
}

export async function updateAsesoria(id, data) {
    const result = await asesoriaDb.updateAsesoria(id, data);
    await invalidateAsesoriaCaches();
    return result;
}

export async function getTotalAsesorias(startDate = null, endDate = null, options = {}) {
    const asesorias = await getAsesorias(startDate, endDate, options);
    return (asesorias ?? []).length;
}

export async function getAsesoriasCountByUser(options = {}) {
    const asesorias = await getAsesorias(null, null, options);
    const userAsesoriasSet = new Set((asesorias ?? []).map(doc => doc.userInfo?.uid).filter(Boolean));
    return userAsesoriasSet.size;
}

export async function getAsesoriasCountByArea(options = {}) {
    const asesorias = await getAsesorias(null, null, options);
    const areasCount = {};

    (asesorias ?? []).forEach((asesoria) => {
        const subjectArea = asesoria?.subject?.area;
        const userUid = asesoria?.userInfo?.uid;

        if (!subjectArea || !userUid) {
            return;
        }

        if (!areasCount[subjectArea]) {
            areasCount[subjectArea] = {
                totalAsesorias: 0,
                userUids: new Set()
            };
        }

        areasCount[subjectArea].totalAsesorias++;
        areasCount[subjectArea].userUids.add(userUid);
    });

    return Object.keys(areasCount).map(area => ({
        area,
        totalAsesorias: areasCount[area].totalAsesorias,
        totalUniqueUsers: areasCount[area].userUids.size
    }));
}

export async function getAsesoriasCountByCampus(options = {}) {
    const asesorias = await getAsesorias(null, null, options);
    const campusCount = {};

    (asesorias ?? []).forEach((asesoria) => {
        const campus = asesoria?.userInfo?.campus;
        if (campus) {
            campusCount[campus] = (campusCount[campus] || 0) + 1;
        }
    });

    return Object.keys(campusCount).map(campus => ({
        campus,
        totalAsesorias: campusCount[campus]
    }));
}

export async function deleteOldAsesorias() {
    const result = await asesoriaDb.deleteOldAsesorias();
    await invalidateAsesoriaCaches();
    return result;
}
