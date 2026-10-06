import { ref, getDownloadURL, uploadBytes } from "firebase/storage";

import { firebaseStorage } from "../client";
import { invalidateCacheTags, withCache } from "../cache/cache";
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys, profilePictureTag } from "../cache/config";
import { prepareImage } from './compress';

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
                if (error.code === 'storage/object-not-found') return DEFAULT_PROFILE_PICTURE;
                throw error;
            }
        }
    );
};

export const storage = firebaseStorage;

export async function uploadFile(file, email) {
    try {
        const storageRef = ref(storage, `users/${email}/photo`);
        const image = await prepareImage(file);
        await uploadBytes(storageRef, image, { contentType: image.type, cacheControl: 'private,max-age=300' });
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
        const image = await prepareImage(file, 'announcement');
        await uploadBytes(storageRef, image, { contentType: image.type, cacheControl: 'private,max-age=300' });
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
