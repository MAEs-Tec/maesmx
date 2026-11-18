import { firestoreDB } from "../../main";
import {
    collection,
    getDocs,
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
            // Sin orderBy: Firestore deja fuera los documentos a los que les falta el campo
            // del orden, y entonces el catálogo salía incompleto. Se ordena aquí.
            const docsSnap = await getDocs(collection(firestoreDB, "schools/tec.mx/subjects"));

            if (!docsSnap.empty) {
                return docsSnap.docs
                    .map(doc => {
                        const data = doc.data();
                        const id = data.id || doc.id;
                        return { ...data, id, name: data.name || id };
                    })
                    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
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

export async function upsertSubjects(subjects) {
    const batchSize = 10;
    for (let start = 0; start < subjects.length; start += batchSize) {
        const writes = subjects.slice(start, start + batchSize).map((subject) => {
            const subjectRef = doc(firestoreDB, `schools/tec.mx/subjects/${subject.id}`);
            return setDoc(subjectRef, subject);
        });
        await Promise.all(writes);
    }
}

export async function deleteSubject(subjectId) {
    const subjectRef = doc(firestoreDB, `schools/tec.mx/subjects/${subjectId}`);
    await deleteDoc(subjectRef);
    await invalidateCacheTags([CACHE_TAGS.SUBJECTS]);
}
