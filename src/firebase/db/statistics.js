import { doc, collection, query, where, getDoc, getDocs } from 'firebase/firestore';
import { firestoreDB } from '../client';
import { withCache } from '../cache/cache';
import { CACHE_TTL_MS } from '../cache/config';
import { measuredRead } from '../diagnostics';
export function semesterKey() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    return `${parts.find(p => p.type === 'year').value}-${Number(parts.find(p => p.type === 'month').value) < 7 ? '01' : '02'}`;
}
export async function activeStatistics() {
    return withCache('stats:version', { ttlMs: CACHE_TTL_MS.STATISTICS, persist: false, tags: ['statistics'] }, async () => {
        const snap = await measuredRead('firestore:stats-version', () => getDoc(doc(firestoreDB, 'settings', 'analytics')));
        if (!snap.exists() || !snap.data().ready) throw new Error('Estadísticas pendientes de migración');
        return snap.data().activeVersion;
    });
}
export async function getDashboardStatistics(scope = 'all', options = {}) {
    const version = await activeStatistics();
    return withCache(`stats:dashboard:${version}:${scope}`, { ttlMs: CACHE_TTL_MS.STATISTICS, persist: true,
        forceRefresh: options.forceRefresh, tags: ['statistics', 'statistics:dashboard'] }, async () => {
        const snap = await measuredRead('firestore:dashboard', () => getDoc(doc(firestoreDB, 'analytics', version, 'summaries', scope)));
        return snap.exists() ? snap.data() : { totalAsesorias: 0, totalUniqueUsers: 0, areas: {}, campuses: {} };
    });
}
export async function getPeerAdvisoryCount(uid, options = {}) {
    const version = await activeStatistics(); const semester = semesterKey();
    return withCache(`stats:peer:${version}:${semester}:${uid}`, { ttlMs: CACHE_TTL_MS.STATISTICS, persist: true,
        forceRefresh: options.forceRefresh, tags: [`statistics:peer:${uid}`, 'statistics'] }, async () => {
        const snap = await measuredRead('firestore:peer-count', () => getDoc(doc(firestoreDB, 'analytics', version, 'counts', `${semester}~${uid}`)));
        return snap.exists() ? snap.data().count : 0;
    });
}
export async function getLeaderboardCounts(options = {}) {
    const version = await activeStatistics(); const semester = semesterKey();
    return withCache(`stats:leaderboard:${version}:${semester}`, { ttlMs: CACHE_TTL_MS.STATISTICS, persist: true,
        forceRefresh: options.forceRefresh, tags: ['statistics:leaderboard', 'statistics'] }, async () => {
        const snap = await measuredRead('firestore:leaderboard-counts', () => getDocs(query(collection(firestoreDB, 'analytics', version, 'counts'), where('semester', '==', semester))));
        return Object.fromEntries(snap.docs.map(doc => [doc.data().uid, doc.data().count]));
    });
}
