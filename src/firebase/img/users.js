import { ref, getDownloadURL, uploadBytes } from "firebase/storage";

import { firebaseStorage } from "../client";
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

export const storage = firebaseStorage;

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
