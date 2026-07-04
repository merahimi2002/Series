const DB_NAME = 'SeriesDB';
const STORE_NAME = 'kv-store';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbSetItem(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(value, key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function dbGetItem(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbRemoveItem(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function dbClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function migrateFromLocalStorage() {
    const keys = ['excelCache', 'missingValuesMap', 'tvInfoCache', 'tvmazeCache', 'customSiteUrl'];
    let migrated = false;

    for (const key of keys) {
        const value = localStorage.getItem(key);
        if (value !== null) {
            try {
                // Store as parsed JSON if possible, otherwise as string
                const parsed = JSON.parse(value);
                await dbSetItem(key, parsed);
            } catch (e) {
                await dbSetItem(key, value);
            }
            localStorage.removeItem(key);
            migrated = true;
        }
    }
    return migrated;
}

// Export functions for use in other files
window.db = {
    setItem: dbSetItem,
    getItem: dbGetItem,
    removeItem: dbRemoveItem,
    clear: dbClear,
    migrate: migrateFromLocalStorage
};