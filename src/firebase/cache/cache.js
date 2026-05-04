import { Timestamp } from 'firebase/firestore';

const DB_NAME = 'maesmx-cache';
const STORE_NAME = 'entries';

const memoryCache = new Map();
const inFlightRequests = new Map();

function isBrowser() {
    return typeof window !== 'undefined';
}

function isTimestampLike(value) {
    return (
        value &&
        typeof value === 'object' &&
        typeof value.seconds === 'number' &&
        typeof value.nanoseconds === 'number' &&
        typeof value.toDate === 'function'
    );
}

function serializeValue(value) {
    if (value === undefined) {
        return { __cacheType: 'undefined' };
    }

    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (value instanceof Date) {
        return { __cacheType: 'Date', value: value.toISOString() };
    }

    if (isTimestampLike(value)) {
        return {
            __cacheType: 'Timestamp',
            seconds: value.seconds,
            nanoseconds: value.nanoseconds
        };
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeValue(item));
    }

    const serialized = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
        serialized[key] = serializeValue(nestedValue);
    });
    return serialized;
}

function deserializeValue(value) {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => deserializeValue(item));
    }

    if (value.__cacheType === 'undefined') {
        return undefined;
    }

    if (value.__cacheType === 'Date') {
        return new Date(value.value);
    }

    if (value.__cacheType === 'Timestamp') {
        return new Timestamp(value.seconds, value.nanoseconds);
    }

    const deserialized = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
        deserialized[key] = deserializeValue(nestedValue);
    });
    return deserialized;
}

function cloneValue(value) {
    return deserializeValue(serializeValue(value));
}

function isExpired(entry) {
    return typeof entry?.expiresAt === 'number' && entry.expiresAt <= Date.now();
}

function normalizeTags(tags = []) {
    return Array.from(new Set(tags.filter(Boolean)));
}

function createEntry(key, value, { ttlMs = 0, tags = [] } = {}) {
    return {
        key,
        value: cloneValue(value),
        expiresAt: ttlMs > 0 ? Date.now() + ttlMs : Number.POSITIVE_INFINITY,
        tags: normalizeTags(tags),
        updatedAt: Date.now()
    };
}

function getMemoryEntry(key) {
    const entry = memoryCache.get(key);
    if (!entry) {
        return null;
    }

    if (isExpired(entry)) {
        memoryCache.delete(key);
        return null;
    }

    return entry;
}

function setMemoryEntry(key, entry) {
    memoryCache.set(key, {
        ...entry,
        value: cloneValue(entry.value),
        tags: normalizeTags(entry.tags)
    });
}

async function openDb() {
    if (!isBrowser() || !('indexedDB' in window)) {
        return null;
    }

    return await new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readPersistentEntry(key) {
    const db = await openDb();
    if (!db) {
        return null;
    }

    return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
    });
}

async function writePersistentEntry(entry) {
    const db = await openDb();
    if (!db) {
        return;
    }

    const record = {
        ...entry,
        value: serializeValue(entry.value),
        tags: normalizeTags(entry.tags)
    };

    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function deletePersistentEntry(key) {
    const db = await openDb();
    if (!db) {
        return;
    }

    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getAllPersistentEntries() {
    const db = await openDb();
    if (!db) {
        return [];
    }

    return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
    });
}

async function hydratePersistentEntry(key) {
    const entry = await readPersistentEntry(key);
    if (!entry) {
        return null;
    }

    const hydratedEntry = {
        ...entry,
        value: deserializeValue(entry.value),
        tags: normalizeTags(entry.tags)
    };

    if (isExpired(hydratedEntry)) {
        await deletePersistentEntry(key);
        return null;
    }

    setMemoryEntry(key, hydratedEntry);
    return hydratedEntry;
}

export async function setCachedValue(key, value, { ttlMs = 0, tags = [], persist = false } = {}) {
    const entry = createEntry(key, value, { ttlMs, tags });
    setMemoryEntry(key, entry);

    if (persist) {
        await writePersistentEntry(entry);
    }

    return cloneValue(entry.value);
}

export async function withCache(
    key,
    { ttlMs = 0, tags = [], persist = false, forceRefresh = false, cacheNull = true } = {},
    loader
) {
    if (!forceRefresh) {
        const memoryEntry = getMemoryEntry(key);
        if (memoryEntry) {
            return cloneValue(memoryEntry.value);
        }

        if (persist) {
            const persistentEntry = await hydratePersistentEntry(key);
            if (persistentEntry) {
                return cloneValue(persistentEntry.value);
            }
        }
    }

    if (inFlightRequests.has(key)) {
        return cloneValue(await inFlightRequests.get(key));
    }

    const request = (async () => {
        const freshValue = await loader();
        if (freshValue !== null || cacheNull) {
            await setCachedValue(key, freshValue, { ttlMs, tags, persist });
        }
        return freshValue;
    })().finally(() => {
        inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, request);
    return cloneValue(await request);
}

export async function invalidateCacheKey(key) {
    memoryCache.delete(key);
    await deletePersistentEntry(key);
}

export async function invalidateCacheTags(tags = []) {
    const wantedTags = normalizeTags(tags);
    if (wantedTags.length === 0) {
        return;
    }

    for (const [key, entry] of memoryCache.entries()) {
        if (entry.tags?.some((tag) => wantedTags.includes(tag))) {
            memoryCache.delete(key);
        }
    }

    const persistentEntries = await getAllPersistentEntries();
    const keysToDelete = persistentEntries
        .filter((entry) => entry.tags?.some((tag) => wantedTags.includes(tag)))
        .map((entry) => entry.key);

    await Promise.all(keysToDelete.map((key) => deletePersistentEntry(key)));
}

export function clearMemoryCache() {
    memoryCache.clear();
}
