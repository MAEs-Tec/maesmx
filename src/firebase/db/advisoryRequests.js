import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy,
    query, serverTimestamp, startAfter, updateDoc, where
} from 'firebase/firestore';
import { firebaseApp, firestoreDB } from '../../main';
import { invalidateCacheTags } from '../cache/cache';
import { CACHE_TAGS } from '../cache/config';

const requests = () => collection(firestoreDB, 'advisoryRequests');
const rows = snapshot => snapshot.docs.map(item => ({ ...item.data(), id: item.id }));
const callable = name => async (payload = {}) => {
    const result = await httpsCallable(getFunctions(firebaseApp), name)(payload);
    return result.data;
};

export const createAdvisoryRequest = callable('createAdvisoryRequest');
export const offerAdvisoryHelp = callable('offerAdvisoryHelp');
export const withdrawAdvisoryOffer = callable('withdrawAdvisoryOffer');
export const assignAdvisoryRequest = callable('assignAdvisoryRequest');
export const unassignAdvisoryRequest = callable('unassignAdvisoryRequest');
export const closeAdvisoryRequest = callable('closeAdvisoryRequest');

export async function registerRequestedAdvisory(payload) {
    const result = await callable('registerRequestedAdvisory')(payload);
    // The server has committed already. A local cache failure must not suggest
    // that the student should create another advisory.
    try {
        await invalidateCacheTags([CACHE_TAGS.ASESORIAS, CACHE_TAGS.USERS, CACHE_TAGS.CURRENT_USER]);
    } catch (error) {
        console.warn('No se pudo actualizar el caché de asesorías:', error);
    }
    return result;
}

function subscribeList(constraints, next, error) {
    return onSnapshot(query(requests(), ...constraints, orderBy('createdAt', 'desc'), limit(50)),
        snapshot => next(rows(snapshot)), error);
}

export function subscribeMyRequests(studentKey, next, error) {
    return subscribeList([where('studentKey', '==', studentKey)], next, error);
}

export function subscribeCampusRequests(campus, next, error) {
    return subscribeList([where('campus', '==', campus)], next, error);
}

export function subscribeRequest(id, next, error) {
    return onSnapshot(doc(firestoreDB, 'advisoryRequests', id),
        snapshot => next(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null), error);
}

export function subscribeOffers(id, next, error, maeKey = null) {
    if (maeKey) {
        return onSnapshot(doc(firestoreDB, 'advisoryRequests', id, 'offers', maeKey),
            snapshot => next(snapshot.exists() ? [{ ...snapshot.data(), id: snapshot.id }] : []), error);
    }
    return onSnapshot(collection(firestoreDB, 'advisoryRequests', id, 'offers'),
        snapshot => next(rows(snapshot)), error);
}

// One Firestore listener per user, shared (ref-counted) by every component that
// needs the notifications. Late subscribers get the last snapshot replayed.
const sharedNotifications = new Map();

export function subscribeNotifications(userKey, next, error) {
    let shared = sharedNotifications.get(userKey);
    if (!shared) {
        shared = { listeners: new Set(), stop: null, last: null };
        const current = shared;
        sharedNotifications.set(userKey, current);
        current.stop = onSnapshot(query(collection(firestoreDB, 'advisoryNotifications', userKey, 'items'),
            orderBy('createdAt', 'desc'), limit(50)), snapshot => {
            current.last = rows(snapshot);
            [...current.listeners].forEach(listener => listener.next(current.last));
        }, cause => {
            // A failed listener is terminated by Firestore; drop it so the next subscriber retries.
            if (sharedNotifications.get(userKey) === current) sharedNotifications.delete(userKey);
            [...current.listeners].forEach(listener => listener.error?.(cause));
            current.listeners.clear();
        });
    }
    const listener = { next, error };
    shared.listeners.add(listener);
    if (shared.last) next(shared.last);
    const owner = shared;
    return () => {
        if (!owner.listeners.delete(listener) || owner.listeners.size) return;
        owner.stop?.();
        if (sharedNotifications.get(userKey) === owner) sharedNotifications.delete(userKey);
    };
}

export async function markNotificationRead(userKey, id) {
    await updateDoc(doc(firestoreDB, 'advisoryNotifications', userKey, 'items', id), { readAt: serverTimestamp() });
}

export async function getAdvisoryRequest(id) {
    const snapshot = await getDoc(doc(firestoreDB, 'advisoryRequests', id));
    return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
}

export async function getMatchingRequests(studentKey, maeKey, subjectId = null) {
    const constraints = [
        where('studentKey', '==', studentKey),
        where('assignedMaeKey', '==', maeKey),
        where('status', 'in', ['assigned', 'closed'])
    ];
    const snapshot = await getDocs(query(requests(), ...constraints));
    return rows(snapshot).filter(item =>
        (item.status === 'assigned' || item.closeReason === 'missing_registration') &&
        (!subjectId || item.subject?.id === subjectId)
    );
}

// Historical pages are fetched on demand instead of attaching more listeners.
export async function getRequestHistory({ studentKey, campus, cursor = null }) {
    const constraints = [where(studentKey ? 'studentKey' : 'campus', '==', studentKey || campus),
        orderBy('createdAt', 'desc'), limit(50)];
    if (cursor) constraints.push(startAfter(cursor));
    const snapshot = await getDocs(query(requests(), ...constraints));
    return { items: rows(snapshot), cursor: snapshot.docs.at(-1) || null, hasMore: snapshot.size === 50 };
}
