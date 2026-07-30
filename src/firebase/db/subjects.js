import { firestoreDB } from "../../main";
import {
    collection,
    getDocs,
    query,
    orderBy,
} from 'firebase/firestore';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';

export async function getSubjects() {
    const subjectsRef = collection(firestoreDB, "schools/tec.mx/subjects");
    
    const q = query(subjectsRef, orderBy("name"));

    const docsSnap = await getDocs(q);

    if (!docsSnap.empty) {
        return docsSnap.docs.map(doc => doc.data());
    } else {
        return null;
    }
}

export async function addSubject(subject) {
    const subjectRef = doc(firestoreDB, `schools/tec.mx/subjects/${subject.id}`);
    await setDoc(subjectRef, subject);
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
  }
