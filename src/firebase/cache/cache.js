import { Timestamp } from 'firebase/firestore';
import { recordCostOperation } from '../diagnostics';

const DB_NAME = 'maesmx-cache-v2';
const STORE_NAME = 'entries';

const memoryCache = new Map();
const inFlightRequests = new Map();
let scope = 'unconfigured:anonymous';
let generation = 0;
let persistentQueue = Promise.resolve();
function enqueuePersistent(task) {
    const result = persistentQueue.then(task);
    persistentQueue = result.catch(() => {});
    return result;
}
const scopedKey = key => `${scope}:${key}`;
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('maesmx-cache-v2') : null;
if (channel) channel.onmessage = ({ data }) => {
    if (data?.scope !== scope) return;
    if (data.type === 'tags') invalidateCacheTags(data.tags, false);
    if (data.type === 'logout') configureCacheSession(data.project, null, false);
};

export async function configureCacheSession(project = 'unknown', uid = null, broadcast = true) {
    const previous = scope;
    const next = `${project}:${uid || 'anonymous'}`;
    if (previous === next) return;
    generation++;
    scope = next;
    memoryCache.clear();
    inFlightRequests.clear();
    if (!uid && broadcast) channel?.postMessage({ type: 'logout', scope: previous, project });
    await enqueuePersistent(async () => {
        const records = await getAllPersistentEntries();
        await Promise.all(records.filter(entry => entry.key.startsWith(`${previous}:`)).map(entry => deletePersistentEntry(entry.key)));
    }).catch(error => console.warn('Cache session cleanup failed', error));
}

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
    key = scopedKey(key);
    const entry = createEntry(key, value, { ttlMs, tags });
    setMemoryEntry(key, entry);

    if (persist) {
        try {
            await enqueuePersistent(() => writePersistentEntry(entry));
        } catch (error) {
            console.warn(`Persistent cache write failed for ${key}; using memory cache only.`, error);
        }
    }

    return cloneValue(entry.value);
}

export async function withCache(
    key,
    { ttlMs = 0, tags = [], persist = false, forceRefresh = false, cacheNull = true } = {},
    loader
) {
    const originalKey = key;
    key = scopedKey(key);
    const requestGeneration = generation;
    if (!forceRefresh) {
        const memoryEntry = getMemoryEntry(key);
        if (memoryEntry) {
            recordCostOperation('cache:memory-hit');
            return cloneValue(memoryEntry.value);
        }

        if (persist) {
            try {
                await persistentQueue;
                const persistentEntry = await hydratePersistentEntry(key);
                if (persistentEntry && generation === requestGeneration) {
                    recordCostOperation('cache:persistent-hit');
                    return cloneValue(persistentEntry.value);
                }
            } catch (error) {
                console.warn(`Persistent cache read failed for ${key}; loading fresh data.`, error);
            }
        }
    }

    if (inFlightRequests.has(key)) {
        recordCostOperation('cache:deduplicated');
        return cloneValue(await inFlightRequests.get(key));
    }

    const request = (async () => {
        recordCostOperation('cache:miss');
        const freshValue = await loader();
        if ((freshValue !== null || cacheNull) && generation === requestGeneration) {
            // Serialize invalidation and writes. A late response cannot repopulate
            // persistent storage after a mutation or an account change.
            await enqueuePersistent(async () => {
                if (generation !== requestGeneration || scopedKey(originalKey) !== key) return;
                const entry = createEntry(key, freshValue, { ttlMs, tags });
                setMemoryEntry(key, entry);
                if (persist) await writePersistentEntry(entry);
            }).catch(error => console.warn('Persistent cache write failed', error));
        }
        return freshValue;
    })().finally(() => {
        if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, request);
    return cloneValue(await request);
}

export async function invalidateCacheKey(key) {
    key = scopedKey(key);
    generation++;
    inFlightRequests.delete(key);
    memoryCache.delete(key);
    try {
        await enqueuePersistent(() => deletePersistentEntry(key));
    } catch (error) {
        console.warn(`Persistent cache delete failed for ${key}.`, error);
    }
}

export async function invalidateCacheTags(tags = [], broadcast = true) {
    const wantedTags = normalizeTags(tags);
    if (wantedTags.length === 0) {
        return;
    }
    generation++;
    inFlightRequests.clear();
    const targetScope = scope;
    if (broadcast) channel?.postMessage({ type: 'tags', tags: wantedTags, scope });

    for (const [key, entry] of memoryCache.entries()) {
        if (entry.tags?.some((tag) => wantedTags.includes(tag))) {
            memoryCache.delete(key);
        }
    }

    try {
        await enqueuePersistent(async () => {
            const persistentEntries = await getAllPersistentEntries();
            const keysToDelete = persistentEntries
                .filter(entry => entry.key.startsWith(`${targetScope}:`) && entry.tags?.some(tag => wantedTags.includes(tag)))
                .map(entry => entry.key);
            await Promise.all(keysToDelete.map(key => deletePersistentEntry(key)));
        });
    } catch (error) {
        console.warn('Persistent cache tag invalidation failed.', error);
    }
}

export function clearMemoryCache() {
    memoryCache.clear();
}
