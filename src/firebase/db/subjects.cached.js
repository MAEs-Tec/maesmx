import { firestoreDB } from "../../main";
import {
    collection,
    getDocs,
    query,
    orderBy,
} from 'firebase/firestore';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';

export async function getSubjects(options = {}) {
    return await withCache(
        cacheKeys.subjects(),
        {
            ttlMs: CACHE_TTL_MS.SUBJECTS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.SUBJECTS]
        },
        async () => {
            const subjectsRef = collection(firestoreDB, "schools/tec.mx/subjects");
            const q = query(subjectsRef, orderBy("name"));
            const docsSnap = await getDocs(q);

            if (!docsSnap.empty) {
                return docsSnap.docs.map(doc => doc.data());
            }

            return null;
        }
    );
}

export async function addSubject(subject) {
    const subjectRef = doc(firestoreDB, `schools/tec.mx/subjects/${subject.id}`);
    await setDoc(subjectRef, subject);
    await invalidateCacheTags([CACHE_TAGS.SUBJECTS]);
}

export async function deleteSubject(subjectId) {
    const subjectRef = doc(firestoreDB, `schools/tec.mx/subjects/${subjectId}`);
    await deleteDoc(subjectRef);
    await invalidateCacheTags([CACHE_TAGS.SUBJECTS]);
  }
