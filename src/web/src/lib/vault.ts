// Client side of the IPOV2 vault (see src/pipeline/build/vault.py).
// username + password → PBKDF2-SHA-256 (512 bits) → [KEK | sync key]. KEK unwraps this build's data key; the
// sync key encrypts your portfolio for cross-device sync. Nothing (password, keys) ever leaves the browser.
const MAGIC = new TextEncoder().encode('IPOV2')
const DB = 'ipo-terminal'
const STORE = 'keys'
const te = new TextEncoder()

export interface VaultHeader { iters: number; salt: Uint8Array; users: { u: string; iv: string; wk: string }[]; iv: Uint8Array; ct: Uint8Array }
export interface Session { uid: string; username: string; kek: CryptoKey; udk: CryptoKey; salt: string }

const hex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map(h => parseInt(h, 16)))
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')

export function parseVault(buf: ArrayBuffer): VaultHeader {
  const b = new Uint8Array(buf)
  if (b.length < 40 || !MAGIC.every((m, i) => b[i] === m)) throw new Error('Not a terminal vault')
  const hl = new DataView(buf).getUint32(5, false)
  const h = JSON.parse(new TextDecoder().decode(b.slice(9, 9 + hl)))
  const rest = b.slice(9 + hl)
  return { iters: h.iters, salt: hex(h.salt), users: h.users, iv: rest.slice(0, 12), ct: rest.slice(12) }
}

export async function userId(username: string) {
  return toHex(await crypto.subtle.digest('SHA-256', te.encode('ipo-terminal-user:' + username.trim().toLowerCase()))).slice(0, 24)
}

async function userSalt(publicSalt: Uint8Array, uid: string) {
  const b = new Uint8Array([...publicSalt, ...te.encode(uid)])
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b)).slice(0, 16)
}

/** Derive the session keys. Both are non-extractable. */
export async function deriveSession(username: string, password: string, h: VaultHeader): Promise<Session> {
  const uid = await userId(username)
  const salt = await userSalt(h.salt, uid)
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: h.iters }, base, 512))
  const kek = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['decrypt'])
  const udk = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt'])
  bits.fill(0)
  return { uid, username: username.trim(), kek, udk, salt: toHex(h.salt.buffer as ArrayBuffer) }
}

async function gunzip(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Open the vault with an existing session (used on login, auto-unlock and every live refresh). */
export async function openWithSession<T>(h: VaultHeader, s: Session): Promise<T> {
  const e = h.users.find(x => x.u === s.uid)
  if (!e) throw new Error('Unknown username or wrong password')
  let dekRaw: ArrayBuffer
  try {
    dekRaw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex(e.iv) as BufferSource, additionalData: te.encode('IPOV2-key:' + s.uid) as BufferSource }, s.kek, hex(e.wk) as BufferSource)
  } catch { throw new Error('Unknown username or wrong password') }
  const dek = await crypto.subtle.importKey('raw', dekRaw, 'AES-GCM', false, ['decrypt'])
  new Uint8Array(dekRaw).fill(0)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: h.iv as BufferSource, additionalData: MAGIC as BufferSource }, dek, h.ct as BufferSource)
  return JSON.parse(await gunzip(plain)) as T
}

export async function login<T>(buf: ArrayBuffer, username: string, password: string): Promise<{ data: T; session: Session }> {
  const h = parseVault(buf)
  const session = await deriveSession(username, password, h)
  return { data: await openWithSession<T>(h, session), session }
}

// ---- user data encryption (cross-device sync) ----
export async function sealUser(s: Session, obj: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('IPOU1:' + s.uid) }, s.udk, te.encode(JSON.stringify(obj)))
  return new Uint8Array([...te.encode('IPOU1'), ...iv, ...new Uint8Array(ct)])
}
export async function openUser<T>(s: Session, b: Uint8Array): Promise<T> {
  if (new TextDecoder().decode(b.slice(0, 5)) !== 'IPOU1') throw new Error('Not a user file')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(5, 17), additionalData: te.encode('IPOU1:' + s.uid) }, s.udk, b.slice(17))
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

// ---- "remember this device": stores the non-extractable keys (never the password) in IndexedDB ----
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
export async function rememberSession(s: Session): Promise<void> {
  try { (await db()).transaction(STORE, 'readwrite').objectStore(STORE).put(s, 'session') } catch { /* storage unavailable */ }
}
export async function recallSession(publicSaltHex: string): Promise<Session | null> {
  try {
    const d = await db()
    const rec = await new Promise<Session | undefined>((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get('session')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    return rec && rec.salt === publicSaltHex && rec.kek && rec.udk ? rec : null
  } catch { return null }
}
export async function forgetSession(): Promise<void> {
  try { const st = (await db()).transaction(STORE, 'readwrite').objectStore(STORE); st.delete('session'); st.delete('vault') } catch { /* noop */ }
}
export const saltHex = (h: VaultHeader) => toHex(h.salt.buffer as ArrayBuffer)
