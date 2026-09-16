import { ref, getDownloadURL, getStorage, uploadBytes } from "firebase/storage";
import { initializeApp } from "firebase/app";
import { firebaseStorage } from "../../main";
import { invalidateCacheTags, withCache } from "../cache/cache";
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys, profilePictureTag } from "../cache/config";

const DEFAULT_PROFILE_PICTURE = 'https://randomuser.me/api/portraits/lego/5.jpg';

export const getUserProfilePicture = async (email) => {
    if (!email) {
        return DEFAULT_PROFILE_PICTURE;
    }

    const normalizedEmail = email.toLowerCase();

    return await withCache(
        cacheKeys.profilePicture(normalizedEmail),
        {
            ttlMs: CACHE_TTL_MS.PROFILE_PICTURE,
            persist: true,
            tags: [CACHE_TAGS.PROFILE_PICTURES, profilePictureTag(normalizedEmail)]
        },
        async () => {
            try {
                return await getDownloadURL(ref(firebaseStorage, `users/${normalizedEmail}/photo`));
            } catch (error) {
                console.error(normalizedEmail, 'Has no profile picture');
                return DEFAULT_PROFILE_PICTURE;
            }
        }
    );
};

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export const firebaseAppImage = initializeApp(firebaseConfig);

export const storage = getStorage(firebaseAppImage);

export async function uploadFile(file, email) {
    try {
        const storageRef = ref(storage, `users/${email}/photo`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        await invalidateUserProfilePictureCache(email);
        return url;
    } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
    }
}

export async function addAnnoucement(file, path) {
    try {
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
    } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
    }
}

export async function invalidateUserProfilePictureCache(email) {
    if (!email) {
        return;
    }

    await invalidateCacheTags([profilePictureTag(email.toLowerCase())]);
}
