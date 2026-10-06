import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { firestoreDB } from '../client';
async function readSettings() {
    const snap = await getDoc(doc(firestoreDB, 'settings', 'evaluations'));
    return snap.exists() ? snap.data() : {};
}
export async function getEvaluationsRevealedAt() { return (await readSettings()).evaluationsRevealedAt || null; }
export async function getEvaluationsClearedAt() { return (await readSettings()).evaluationsClearedAt || null; }
export function revelarEvaluaciones() { return setDoc(doc(firestoreDB, 'settings', 'evaluations'), { evaluationsRevealedAt: serverTimestamp() }, { merge: true }); }
export function borrarEvaluaciones() { return setDoc(doc(firestoreDB, 'settings', 'evaluations'), { evaluationsClearedAt: serverTimestamp() }, { merge: true }); }
