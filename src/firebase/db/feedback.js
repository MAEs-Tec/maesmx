// Sugerencias y reportes de fallos. El envío pasa por la función submitFeedback
// (guarda en Firestore y abre el issue en GitHub); la lectura es solo para admin/tec.
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { firebaseApp, firestoreDB } from '../../main';

export const FEEDBACK_TYPES = [
    { code: 'sugerencia', name: 'Sugerencia o idea', icon: 'pi pi-lightbulb' },
    { code: 'fallo', name: 'Algo falla', icon: 'pi pi-exclamation-triangle' }
];

export const FEEDBACK_STATUSES = [
    { code: 'nuevo', name: 'Nuevo', severity: 'info' },
    { code: 'en_revision', name: 'En revisión', severity: 'warning' },
    { code: 'hecho', name: 'Hecho', severity: 'success' },
    { code: 'descartado', name: 'Descartado', severity: 'secondary' }
];

export const FEEDBACK_LIMITS = { titleMin: 5, titleMax: 120, bodyMin: 10, bodyMax: 4000 };

export async function submitFeedback({ type, title, body, page }) {
    const callable = httpsCallable(getFunctions(firebaseApp), 'submitFeedback');
    const result = await callable({
        type,
        title,
        body,
        page,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
    });
    return result.data;
}

// Admin/tec: vuelve a intentar el issue de GitHub de un envío que se guardó sin él.
export async function retryFeedbackIssue(id) {
    const callable = httpsCallable(getFunctions(firebaseApp), 'retryFeedbackIssue');
    const result = await callable({ id });
    return result.data;
}

export async function listFeedback({ max = 300 } = {}) {
    const snapshot = await getDocs(query(collection(firestoreDB, 'feedback'), orderBy('createdAt', 'desc'), limit(max)));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function updateFeedbackStatus(id, status) {
    if (!FEEDBACK_STATUSES.some((s) => s.code === status)) throw new Error('Estado no válido.');
    const email = getAuth().currentUser?.email ?? '';
    await updateDoc(doc(firestoreDB, 'feedback', id), {
        status,
        statusBy: email.split('@')[0] || null,
        statusAt: serverTimestamp()
    });
}
