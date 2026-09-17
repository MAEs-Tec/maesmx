import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestoreDB } from '../../main';
import { invalidateCacheTags } from '../cache/cache';
import { CACHE_TAGS, userTag } from '../cache/config';

// Role changes made by an administrator must reach an already open session.
export function subscribeCurrentUserRole(onChange, onError) {
    let stopProfile;
    let disposed = false;
    let generation = 0;
    const stopAuth = onAuthStateChanged(getAuth(), (user) => {
        const currentGeneration = ++generation;
        stopProfile?.();
        onChange(null);
        if (!user?.email || disposed) return;
        const uid = user.email.split('@')[0].toLowerCase();
        stopProfile = onSnapshot(doc(firestoreDB, 'users', uid), (snapshot) => {
            if (disposed || currentGeneration !== generation) return;
            const profile = snapshot.exists() ? snapshot.data() : null;
            onChange(profile ? { uid, role: profile.role } : null);
            void invalidateCacheTags([CACHE_TAGS.CURRENT_USER, CACHE_TAGS.USER_DETAILS, userTag(uid)])
                .catch(error => console.error('No se pudo actualizar la caché del usuario:', error));
        }, (error) => {
            if (disposed || currentGeneration !== generation) return;
            onChange(null);
            onError?.(error);
        });
    });

    return () => {
        disposed = true;
        stopAuth();
        stopProfile?.();
    };
}
