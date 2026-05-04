import { firestoreDB } from "../../main";
import {
    collection,
    getDocs,
} from 'firebase/firestore';
import { withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';

export async function getCampuses(options = {}) {
    return await withCache(
        cacheKeys.campuses(),
        {
            ttlMs: CACHE_TTL_MS.CAMPUSES,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.CAMPUSES]
        },
        async () => {
            const campusesRef = collection(firestoreDB, "schools/tec.mx/campus");
            const docsSnap = await getDocs(campusesRef);

            if (docsSnap) {
                return docsSnap.docs.map(doc => doc.data());
            }

            return null;
        }
    );
}
