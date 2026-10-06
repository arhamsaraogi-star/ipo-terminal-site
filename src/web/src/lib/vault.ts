// Client side of the IPOV3 vault (see src/pipeline/build/vault.py) and self-service accounts.
//
//   access code ──PBKDF2──▶ MK (master key) ──unwraps──▶ this build's data key ──decrypts──▶ terminal data
//   password    ──PBKDF2──▶ [KEK | personal key]   KEK wraps MK in your account file; the personal key encrypts your portfolio
//
// Sign up once with the access code; after that, username + password on any device. Nothing secret leaves the browser.
const MAGIC = new TextEncoder().encode('IPOV3')
const DB = 'ipo-terminal'
const STORE = 'keys'
const te = new TextEncoder()
export const MIN_PASSWORD = 6

export interface VaultHeader { iters: number; salt: Uint8Array; saltHex: string; repo: string | null; mk: { iv: string; wk: string }; iv: Uint8Array; ct: Uint8Array }
export interface Session { uid: string; username: string; mk: CryptoKey; udk: CryptoKey; salt: string }
export interface AccountFile { v: 1; username: string; salt: string; iters: number; iv: string; wk: string; created: string }

const hex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map(h => parseInt(h, 16)))
const toHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('')

export function parseVault(buf: ArrayBuffer): VaultHeader {
  const b = new Uint8Array(buf)
  if (b.length < 40 || !MAGIC.every((m, i) => b[i] === m)) throw new Error('Not a terminal vault')
  const hl = new DataView(buf).getUint32(5, false)
  const h = JSON.parse(new TextDecoder().decode(b.slice(9, 9 + hl)))
  const rest = b.slice(9 + hl)
  return { iters: h.iters, salt: hex(h.salt), saltHex: h.salt, repo: h.repo ?? null, mk: h.mk, iv: rest.slice(0, 12), ct: rest.slice(12) }
}

export const normUser = (u: string) => u.trim().toLowerCase()
export async function userId(username: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('ipo-terminal-user:' + normUser(username))))).slice(0, 24)
}

async function pbkdf2(secret: string, salt: Uint8Array, iters: number, bits: number) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iters }, base, bits))
}
const aes = (raw: Uint8Array, usages: KeyUsage[], extractable = false) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', extractable, usages)

async function gunzip(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Decrypt the vault with the master key (login, auto-unlock and every live refresh). */
export async function openWithMk<T>(h: VaultHeader, mk: CryptoKey): Promise<T> {
  const dekRaw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex(h.mk.iv) as BufferSource, additionalData: te.encode('IPOV3-dek') as BufferSource }, mk, hex(h.mk.wk) as BufferSource))
  const dek = await aes(dekRaw, ['decrypt'])
  dekRaw.fill(0)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: h.iv as BufferSource, additionalData: MAGIC as BufferSource }, dek, h.ct as BufferSource)
  return JSON.parse(await gunzip(plain)) as T
}

/** Access code → raw master key bytes (only during sign-up, to wrap it for the new account). Throws if the code is wrong. */
export async function masterFromCode(h: VaultHeader, code: string): Promise<{ raw: Uint8Array; key: CryptoKey }> {
  const raw = await pbkdf2(code, h.salt, h.iters, 256)
  const key = await aes(raw, ['encrypt', 'decrypt'])
  try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex(h.mk.iv) as BufferSource, additionalData: te.encode('IPOV3-dek') as BufferSource }, key, hex(h.mk.wk) as BufferSource) } catch { throw new Error('Wrong access code') }
  return { raw, key }
}

async function passwordKeys(password: string, salt: Uint8Array, iters: number) {
  const bits = await pbkdf2(password, salt, iters, 512)
  const kek = await aes(bits.slice(0, 32), ['encrypt', 'decrypt'])
  const udk = await aes(bits.slice(32), ['encrypt', 'decrypt'])
  bits.fill(0)
  return { kek, udk }
}

/** Create an account file: MK wrapped under the user's password. */
export async function createAccount(h: VaultHeader, username: string, password: string, code: string): Promise<{ file: AccountFile; session: Session }> {
  if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`)
  const { raw, key: mk } = await masterFromCode(h, code)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { kek, udk } = await passwordKeys(password, salt, h.iters)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const uid = await userId(username)
  const wk = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('IPOV3-acct:' + uid) }, kek, raw as BufferSource))
  raw.fill(0)
  const file: AccountFile = { v: 1, username: username.trim(), salt: toHex(salt), iters: h.iters, iv: toHex(iv), wk: toHex(wk), created: new Date().toISOString() }
  return { file, session: { uid, username: username.trim(), mk, udk, salt: h.saltHex } }
}

/** Sign in with an account file + password. */
export async function unlockAccount(h: VaultHeader, file: AccountFile, password: string): Promise<Session> {
  const uid = await userId(file.username)
  const { kek, udk } = await passwordKeys(password, hex(file.salt), file.iters)
  let raw: Uint8Array
  try { raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex(file.iv) as BufferSource, additionalData: te.encode('IPOV3-acct:' + uid) as BufferSource }, kek, hex(file.wk) as BufferSource)) }
  catch { throw new Error('Wrong username or password') }
  const mk = await aes(raw, ['encrypt', 'decrypt'])
  raw.fill(0)
  return { uid, username: file.username, mk, udk, salt: h.saltHex }
}

/** Re-wrap MK under a new password (change password). Requires being signed in with the old password. */
export async function changePassword(h: VaultHeader, file: AccountFile, oldPw: string, newPw: string, code?: string): Promise<{ file: AccountFile; session: Session }> {
  if (newPw.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`)
  // MK is non-extractable in the session, so re-derive it from the old account wrap
  const uid = await userId(file.username)
  const { kek } = await passwordKeys(oldPw, hex(file.salt), file.iters)
  let raw: Uint8Array
  try { raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex(file.iv) as BufferSource, additionalData: te.encode('IPOV3-acct:' + uid) as BufferSource }, kek, hex(file.wk) as BufferSource)) }
  catch { if (!code) throw new Error('Current password is wrong'); raw = (await masterFromCode(h, code)).raw }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keys = await passwordKeys(newPw, salt, h.iters)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wk = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('IPOV3-acct:' + uid) }, keys.kek, raw as BufferSource))
  const mk = await aes(raw, ['encrypt', 'decrypt'])
  raw.fill(0)
  return { file: { ...file, salt: toHex(salt), iv: toHex(iv), wk: toHex(wk) }, session: { uid, username: file.username, mk, udk: keys.udk, salt: h.saltHex } }
}

// ---- web-news requests: company names only, encrypted with the terminal master key so CI can read them ----
export async function sealRequest(s: Session, names: { name: string; country?: string; symbol?: string }[]): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('IPOR1') }, s.mk, te.encode(JSON.stringify({ names })))
  return new Uint8Array([...te.encode('IPOR1'), ...iv, ...new Uint8Array(ct)])
}

// ---- personal data encryption (cross-device sync) ----
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

// ---- "keep me signed in": the non-extractable keys (never the password) in IndexedDB ----
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
export async function recallSession(saltHex: string): Promise<Session | null> {
  try {
    const d = await db()
    const rec = await new Promise<Session | undefined>((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get('session')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    return rec && rec.salt === saltHex && rec.mk && rec.udk ? rec : null
  } catch { return null }
}
export async function forgetSession(): Promise<void> {
  try { const st = (await db()).transaction(STORE, 'readwrite').objectStore(STORE); st.delete('session'); st.delete('vault') } catch { /* noop */ }
}
