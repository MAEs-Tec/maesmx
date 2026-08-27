import { firestoreDB } from "../../main";
import {
    collection,
    getDocs,
} from 'firebase/firestore';
import { withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';

export async function getMajors(options = {}) {
    return await withCache(
        cacheKeys.majors(),
        {
            ttlMs: CACHE_TTL_MS.MAJORS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.MAJORS]
        },
        async () => {
            const majorsRef = collection(firestoreDB, "schools/tec.mx/majors");
            const docsSnap = await getDocs(majorsRef);
            if (docsSnap) {
                return docsSnap.docs.map(doc => doc.data());
            }
            return null;
        }
    );
}
