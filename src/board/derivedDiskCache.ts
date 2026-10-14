/** Disposable bounded preview cache. Originals and saves never enter it.
 * Payloads and their small eviction ledger commit/evict atomically. */
export const DERIVED_CACHE_LIMIT = 256 * 1024 * 1024
const MAX_ENTRY = 32 * 1024 * 1024, MAX_ENTRIES = 128
const STORE = 'previews', LEDGER = 'metadata'
type Metadata = { key: string; width: number; height: number; bytes: number; used: number }
type Entry = Metadata & { blob: Blob }
let opened: Promise<IDBDatabase> | undefined
const database = () => opened ??= new Promise((resolve, reject) => {
  let settled = false
  const request = indexedDB.open('art-equation-derived-engine-26', 2)
  request.onupgradeneeded = () => {
    const db = request.result
    // Version-1 derivatives are disposable; avoid importing unaccounted blobs.
    if (db.objectStoreNames.contains(STORE)) request.transaction!.objectStore(STORE).clear()
    else db.createObjectStore(STORE, { keyPath: 'key' })
    db.createObjectStore(LEDGER, { keyPath: 'key' })
  }
  request.onerror = () => { settled = true; opened = undefined; reject(request.error) }
  request.onblocked = () => { settled = true; opened = undefined; reject(new Error('Derived cache database is blocked')) }
  request.onsuccess = () => {
    const db = request.result
    if (settled) { db.close(); return } // a rejected opener must not leak a connection
    settled = true
    db.onversionchange = () => { db.close(); opened = undefined }
    db.onclose = () => { opened = undefined }
    resolve(db)
  }
})
export async function derivedCacheKey(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return 'tiff-utif-3.1-png-v1:' + [...digest].map(value => value.toString(16).padStart(2,'0')).join('')
}
const validKey = (key: string) => /^tiff-utif-3\.1-png-v1:[a-f0-9]{64}$/.test(key)
const validMetadata = (row: Metadata) => typeof row.key === 'string' && validKey(row.key)
  && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= MAX_ENTRY
  && Number.isFinite(row.used) && row.used >= 0
  && Number.isSafeInteger(row.width) && Number.isSafeInteger(row.height)
  && row.width > 0 && row.height > 0 && row.width * row.height <= 8 * 1024 * 1024
const validEntry = (row: Entry) => validMetadata(row)
  && row.blob instanceof Blob && row.blob.type === 'image/png' && row.bytes === row.blob.size
async function touchDerivedPreview(key: string) {
  try {
    const db = await database(), tx = db.transaction(LEDGER, 'readwrite'), store = tx.objectStore(LEDGER), request = store.get(key)
    request.onsuccess = () => { if (request.result && validMetadata(request.result)) store.put({ ...request.result, used: Date.now() }) }
    // Readers do not wait on recency writes. Missing entries are never recreated.
    tx.onerror = event => event.preventDefault()
  } catch { /* Optional recency bookkeeping must not break source decoding */ }
}
export async function readDerivedPreview(key: string): Promise<Entry | undefined> {
  if (!validKey(key)) return
  try {
    const db = await database()
    return await new Promise(resolve => {
      const tx = db.transaction(STORE), request = tx.objectStore(STORE).get(key)
      let entry: Entry | undefined, corrupt = false
      request.onsuccess = () => {
        const row = request.result as Entry | undefined
        if (row && validEntry(row)) entry = row
        else if (row) corrupt = true
      }
      tx.oncomplete = () => {
        if (entry) void touchDerivedPreview(key)
        else if (corrupt) void removeDerivedPreview(key)
        resolve(entry)
      }
      tx.onabort = tx.onerror = () => resolve(undefined)
    })
  } catch { return } // Profile/quota failures fall back to original decoding.
}
export async function writeDerivedPreview(key: string, blob: Blob, width: number, height: number) {
  if (!validKey(key) || blob.type !== 'image/png' || blob.size > MAX_ENTRY || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 8 * 1024 * 1024) return false
  try {
    const db = await database()
    return await new Promise<boolean>(resolve => {
      const tx = db.transaction([STORE, LEDGER], 'readwrite'), store = tx.objectStore(STORE), ledger = tx.objectStore(LEDGER), request = ledger.getAll()
      request.onsuccess = () => {
        const rows = (request.result as Metadata[]).filter(row => {
          if (!validMetadata(row)) { store.delete(row.key); ledger.delete(row.key); return false }
          return row.key !== key
        }).sort((a,b) => a.used - b.used || a.key.localeCompare(b.key))
        let bytes = rows.reduce((sum,row) => sum + row.bytes, blob.size), count = rows.length + 1
        for (const row of rows) {
          if (bytes <= DERIVED_CACHE_LIMIT && count <= MAX_ENTRIES) break
          store.delete(row.key); ledger.delete(row.key); bytes -= row.bytes; count--
        }
        const metadata = { key, width, height, bytes: blob.size, used: Date.now() } satisfies Metadata
        store.put({ ...metadata, blob } satisfies Entry); ledger.put(metadata)
      }
      tx.oncomplete = () => resolve(true)
      tx.onabort = tx.onerror = () => resolve(false)
    })
  } catch { return false }
}
export async function derivedCacheStatus() {
  try {
    const db = await database()
    return await new Promise<{ available: boolean; entries: number; bytes: number; limit: number }>(resolve => {
      const request = db.transaction(LEDGER).objectStore(LEDGER).getAll()
      request.onsuccess = () => {
        const rows = (request.result as Metadata[]).filter(validMetadata)
        resolve({ available: true, entries: rows.length, bytes: rows.reduce((sum,row) => sum + row.bytes,0), limit: DERIVED_CACHE_LIMIT })
      }
      request.onerror = () => resolve({ available: false, entries: 0, bytes: 0, limit: DERIVED_CACHE_LIMIT })
    })
  } catch { return { available: false, entries: 0, bytes: 0, limit: DERIVED_CACHE_LIMIT } }
}
export async function clearDerivedCache() {
  const db = await database()
  await new Promise<void>((resolve,reject) => {
    const tx = db.transaction([STORE, LEDGER], 'readwrite'); tx.objectStore(STORE).clear(); tx.objectStore(LEDGER).clear()
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error)
  })
}
export async function removeDerivedPreview(key: string) {
  try {
    const db = await database()
    await new Promise<void>(resolve => {
      const tx = db.transaction([STORE, LEDGER], 'readwrite'); tx.objectStore(STORE).delete(key); tx.objectStore(LEDGER).delete(key)
      tx.oncomplete = tx.onabort = tx.onerror = () => resolve()
    })
  } catch { /* Cache repair never changes the source */ }
}
