// Client side of the IPOV1 vault (see src/pipeline/build/vault.py).
// Passphrase -> PBKDF2-SHA-256 -> AES-256-GCM key -> decrypt -> gunzip -> JSON. Nothing leaves the browser.
const MAGIC = new TextEncoder().encode('IPOV1')
const DB = 'ipo-terminal'
const STORE = 'keys'

export interface VaultHeader { iterations: number; salt: Uint8Array; iv: Uint8Array; ct: Uint8Array }

export function parseVault(buf: ArrayBuffer): VaultHeader {
  const b = new Uint8Array(buf)
  if (b.length < 54 || !MAGIC.every((m, i) => b[i] === m)) throw new Error('Not a terminal vault')
  const iterations = new DataView(buf).getUint32(5, false)
  return { iterations, salt: b.slice(9, 25), iv: b.slice(25, 37), ct: b.slice(37) }
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base, { name: 'AES-GCM', length: 256 }, false /* non-extractable */, ['decrypt'])
}

async function gunzip(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

export async function decryptWithKey<T>(h: VaultHeader, key: CryptoKey): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: h.iv as BufferSource, additionalData: MAGIC as BufferSource }, key, h.ct as BufferSource)
  return JSON.parse(await gunzip(plain)) as T
}

export async function openVault<T>(buf: ArrayBuffer, passphrase: string): Promise<{ data: T; key: CryptoKey }> {
  const h = parseVault(buf)
  const key = await deriveKey(passphrase, h.salt, h.iterations)
  try {
    return { data: await decryptWithKey<T>(h, key), key }
  } catch {
    throw new Error('Incorrect password')
  }
}

// ---- "remember this device": stores the non-extractable CryptoKey (never the password) in IndexedDB ----
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function rememberKey(key: CryptoKey, salt: Uint8Array): Promise<void> {
  try {
    const d = await db()
    d.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, salt: Array.from(salt) }, 'vault')
  } catch { /* storage unavailable: silently skip */ }
}

export async function recallKey(salt: Uint8Array): Promise<CryptoKey | null> {
  try {
    const d = await db()
    const rec = await new Promise<{ key: CryptoKey; salt: number[] } | undefined>((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get('vault')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    if (!rec || rec.salt.length !== salt.length || rec.salt.some((v, i) => v !== salt[i])) return null
    return rec.key
  } catch { return null }
}

export async function forgetKey(): Promise<void> {
  try { (await db()).transaction(STORE, 'readwrite').objectStore(STORE).delete('vault') } catch { /* noop */ }
}
