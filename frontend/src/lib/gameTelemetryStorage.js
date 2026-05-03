const DB_NAME = 'reflex_game_telemetry_db'
const DB_VERSION = 1
const STORE = 'eye_frames'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('sessionKey', 'sessionKey', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Append many eye readings for one session (single transaction).
 * @param {string} sessionKey — server session id as string, or `local-<uuid>` when offline
 * @param {{ offsetMs: number, eyeOffsetX: number|null, eyeOffsetY: number|null, eyeConfidence: number|null, blinkDetected?: boolean }[]} rows
 */
export async function bulkAppendEyeFrames(sessionKey, rows) {
  if (!sessionKey || !rows?.length) return

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    rows.forEach((row) => {
      store.add({
        sessionKey,
        offsetMs: row.offsetMs,
        eyeOffsetX: row.eyeOffsetX,
        eyeOffsetY: row.eyeOffsetY,
        eyeConfidence: row.eyeConfidence,
        blinkDetected: Boolean(row.blinkDetected),
      })
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getEyeFramesForSession(sessionKey) {
  if (!sessionKey) return []

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const index = store.index('sessionKey')
    const request = index.getAll(sessionKey)

    request.onsuccess = () => {
      const rows = request.result || []
      rows.sort((a, b) => a.offsetMs - b.offsetMs)
      resolve(
        rows.map((row) => ({
          offsetMs: row.offsetMs,
          eyeOffsetX: row.eyeOffsetX,
          eyeOffsetY: row.eyeOffsetY,
          eyeConfidence: row.eyeConfidence,
          blinkDetected: Boolean(row.blinkDetected),
        }))
      )
    }
    request.onerror = () => reject(request.error)
  })
}

export async function clearEyeFramesForSession(sessionKey) {
  if (!sessionKey) return

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const index = store.index('sessionKey')
    const range = IDBKeyRange.only(sessionKey)
    const cursorRequest = index.openCursor(range)

    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
