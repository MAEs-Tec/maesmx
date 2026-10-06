import { collection, query, where, orderBy, documentId, limit, startAfter, getDocs, Timestamp } from 'firebase/firestore';
import { firestoreDB } from '../client';
import { measuredRead } from '../diagnostics';

export function calendarKey(value) {
    if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const key = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number.isNaN(Date.parse(`${key}T00:00:00Z`)) || new Date(`${key}T00:00:00Z`).toISOString().slice(0,10) !== key) throw new Error('Fecha inválida');
    return key;
}
export function currentSemester() {
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
    const first = Number(parts.month) < 7;
    return { startDate: `${parts.year}-${first ? '01-01' : '07-01'}`, endDate: `${parts.year}-${first ? '06-30' : '12-31'}` };
}
export function dateConstraints(startDate, endDate) {
    if (!startDate && !endDate) return [];
    if (!startDate || !endDate) throw new Error('Selecciona ambas fechas');
    const start = new Date(`${calendarKey(startDate)}T00:00:00-06:00`);
    const end = new Date(`${calendarKey(endDate)}T00:00:00-06:00`);
    end.setTime(end.getTime() + 86400000);
    if (start >= end) throw new Error('El inicio debe ser anterior al fin');
    return [where('date', '>=', Timestamp.fromDate(start)), where('date', '<', Timestamp.fromDate(end))];
}
export async function getAsesoriasPage({ peerUid, startDate, endDate, subjectId, evaluated = null, userUid, before = null, after = null, cursor = null, pageSize = 50 } = {}) {
    const constraints = dateConstraints(startDate, endDate);
    if (userUid) constraints.push(where('userInfo.uid', '==', userUid));
    if (before) constraints.push(where('date', '<=', before));
    if (after) constraints.push(where('date', '>', after));
    if (peerUid) constraints.push(where('peerInfo.uid', '==', peerUid));
    if (subjectId) constraints.push(where('subject.id', '==', subjectId));
    if (evaluated !== null) constraints.push(where('hasRating', '==', evaluated));
    constraints.push(orderBy('date', 'desc'), orderBy(documentId(), 'desc'));
    if (cursor) constraints.push(startAfter(cursor.date, cursor.id));
    constraints.push(limit(Math.min(50, Math.max(1, pageSize))));
    const snapshot = await measuredRead('firestore:advisory-page', () => getDocs(query(collection(firestoreDB, 'asesorias'), ...constraints)));
    const last = snapshot.docs.at(-1);
    return { items: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(a => a._test !== true && !a._type),
        cursor: snapshot.size === Math.min(50, Math.max(1, pageSize)) && last ? { id: last.id, date: last.data().date, rating: last.data().rating } : null };
}
export async function exportAsesorias(options = {}, onProgress = () => {}) {
    let cursor = null;
    const items = [];
    do {
        const page = await getAsesoriasPage({ ...options, cursor });
        items.push(...page.items); cursor = page.cursor;
        onProgress(items.length);
    } while (cursor);
    return items;
}
