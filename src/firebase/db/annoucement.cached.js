import * as announcementDb from './annoucement.legacy';
import { invalidateCacheTags, withCache } from '../cache/cache';
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';

async function invalidateAnnouncementCaches() {
    await invalidateCacheTags([CACHE_TAGS.ANNOUNCEMENTS, CACHE_TAGS.GROUP_ANNOUNCEMENTS]);
}

export async function saveAnnouncement(announcementData, selectedFile) {
    const result = await announcementDb.saveAnnouncement(announcementData, selectedFile);
    await invalidateAnnouncementCaches();
    return result;
}

export async function getAnnouncementsEdit(options = {}) {
    return await withCache(
        cacheKeys.announcementsEdit(),
        {
            ttlMs: CACHE_TTL_MS.ANNOUNCEMENTS_EDIT,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS]
        },
        async () => await announcementDb.getAnnouncementsEdit()
    );
}

export async function getAnnouncements(options = {}) {
    return await withCache(
        cacheKeys.announcementsVisible(),
        {
            ttlMs: CACHE_TTL_MS.ANNOUNCEMENTS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS]
        },
        async () => await announcementDb.getAnnouncements()
    );
}

export async function getAnnouncementsGrupales(options = {}) {
    return await withCache(
        cacheKeys.announcementsGroup(),
        {
            ttlMs: CACHE_TTL_MS.GROUP_ANNOUNCEMENTS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS, CACHE_TAGS.GROUP_ANNOUNCEMENTS]
        },
        async () => await announcementDb.getAnnouncementsGrupales()
    );
}

export async function addUserToPreregsiter(announcementId, user) {
    const result = await announcementDb.addUserToPreregsiter(announcementId, user);
    await invalidateAnnouncementCaches();
    return result;
}

export const processAsistence = announcementDb.processAsistence;
export const processConfirms = announcementDb.processConfirms;

export async function updateUserAsistence(announcementId, userId) {
    const result = await announcementDb.updateUserAsistence(announcementId, userId);
    await invalidateAnnouncementCaches();
    return result;
}

export async function addExtraVariables() {
    const result = await announcementDb.addExtraVariables();
    await invalidateAnnouncementCaches();
    return result;
}

export async function getAnnouncementsAllGrupales(options = {}) {
    return await withCache(
        cacheKeys.announcementsAllGroup(),
        {
            ttlMs: CACHE_TTL_MS.GROUP_ANNOUNCEMENTS,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ANNOUNCEMENTS, CACHE_TAGS.GROUP_ANNOUNCEMENTS]
        },
        async () => await announcementDb.getAnnouncementsAllGrupales()
    );
}

export async function deleteAnnouncementById(id) {
    const result = await announcementDb.deleteAnnouncementById(id);
    await invalidateAnnouncementCaches();
    return result;
}

export async function updateAnnouncement(announcementId, updatedData) {
    const result = await announcementDb.updateAnnouncement(announcementId, updatedData);
    await invalidateAnnouncementCaches();
    return result;
}

export async function toggleVisibilityById(id) {
    const result = await announcementDb.toggleVisibilityById(id);
    await invalidateAnnouncementCaches();
    return result;
}
