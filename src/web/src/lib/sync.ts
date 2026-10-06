// Cross-device memory: your portfolio, tracking list and private companies, encrypted with your personal key
// (derived from your password — the server never sees it) and stored as users/<uid>.bin on the repo's `userdata`
// branch through the GitHub API. The API token lives inside the encrypted vault, so only signed-in users have it.
import type { Pf } from './portfolio'
import { openUser, sealUser, type AccountFile, type Session } from './vault'

export interface SyncCfg { repo: string; branch: string; token: string }
export interface Remote { pf: Pf; updated_at: string; device?: string }
const API = 'https://api.github.com'

const b64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0))

async function gh(cfg: SyncCfg, path: string, init: RequestInit = {}) {
  return fetch(`${API}/repos/${cfg.repo}${path}`, {
    ...init, cache: 'no-store',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
  })
}

async function ensureBranch(cfg: SyncCfg) {
  const r = await gh(cfg, `/git/ref/heads/${cfg.branch}`)
  if (r.ok) return
  const repo = await (await gh(cfg, '')).json()
  const base = await (await gh(cfg, `/git/ref/heads/${repo.default_branch ?? 'main'}`)).json()
  const c = await gh(cfg, '/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${cfg.branch}`, sha: base.object.sha }) })
  if (!c.ok && c.status !== 422) throw explain(c.status, 'branch setup')
}

/** Say what went wrong in words the user (and the admin) can act on. */
export function explain(status: number, what: string): Error {
  const hint = status === 401 ? 'the sync token was rejected — renew the SYNC_TOKEN secret and re-run Refresh'
    : status === 403 ? 'GitHub refused (token lacks Contents: read & write on this repo, or rate-limited — retrying)'
    : status === 404 ? 'repository or sync branch not found for this token'
    : status === 0 ? 'offline or blocked — retrying' : 'GitHub error — retrying'
  return new Error(`sync ${what} failed (${status || 'network'}): ${hint}`)
}

/** Pull the latest copy. Returns null if this user has never synced. */
export async function pull(cfg: SyncCfg, s: Session): Promise<{ remote: Remote | null; sha: string | null }> {
  let r: Response
  try { r = await gh(cfg, `/contents/users/${s.uid}.bin?ref=${cfg.branch}&t=${Date.now()}`) } catch { throw explain(0, 'pull') }
  if (r.status === 404) return { remote: null, sha: null }
  if (!r.ok) throw explain(r.status, 'pull')
  const j = await r.json()
  // Always read the exact bytes via the blob API: the contents API sometimes "detects" binary files as UTF-16 text and
  // returns a transcoded body (that is what produced "Not a user file"), and it omits bodies over 1 MB.
  let content: string
  {
    const bl = await gh(cfg, `/git/blobs/${j.sha}`)
    if (!bl.ok) throw explain(bl.status, 'pull')
    content = (await bl.json()).content
  }
  return { remote: await openUser<Remote>(s, unb64(content)), sha: j.sha }
}

export async function push(cfg: SyncCfg, s: Session, pf: Pf, sha: string | null): Promise<{ sha: string | null; conflict: boolean }> {
  const body = await sealUser(s, { pf, updated_at: new Date().toISOString(), device: navigator.userAgent.slice(0, 60) } satisfies Remote)
  const put = () => gh(cfg, `/contents/users/${s.uid}.bin`, { method: 'PUT', body: JSON.stringify({ message: 'sync', content: b64(body), branch: cfg.branch, ...(sha ? { sha } : {}) }) })
  let r: Response
  try {
    r = await put()
    if (r.status === 404 || (r.status === 422 && !sha)) { await ensureBranch(cfg); r = await put() }
  } catch (e) { if (e instanceof Error && e.message.startsWith('sync')) throw e; throw explain(0, 'save') }
  if (r.status === 409 || r.status === 422) return { sha, conflict: true }
  if (!r.ok) throw explain(r.status, 'save')
  return { sha: (await r.json()).content?.sha ?? null, conflict: false }
}

/** Union merge: nothing entered on either device is lost. `prefer` wins when the same item exists on both. */
export function merge(prefer: Pf, other: Pf): Pf {
  const by = <T extends { company_id: string }>(a: T[], b: T[]) => [...a, ...b.filter(x => !a.some(y => y.company_id === x.company_id))]
  const deleted = new Set([...(prefer.deleted ?? []), ...(other.deleted ?? [])])
  const keep = <T extends { company_id: string }>(k: string) => (x: T) => !deleted.has(`${k}:${x.company_id}`)
  return {
    holdings: by(prefer.holdings, other.holdings).filter(keep('h')),
    tracking: by(prefer.tracking, other.tracking).filter(keep('t')),
    privates: by(prefer.privates, other.privates).filter(keep('p')),
    listed: by(prefer.listed ?? [], other.listed ?? []).filter(keep('l')),
    watchlist: [], deleted: [...deleted].slice(-500),
  }
}

// ───────── accounts (users/<uid>.key — the master key wrapped under the user's password; useless without it) ─────────
const LOCAL_ACCT = (uid: string) => `ipo-terminal:acct:${uid}`

/** Look up an account file: public read of the userdata branch (no token needed), then this device. */
export async function fetchAccount(repo: string | null, uid: string): Promise<AccountFile | null> {
  if (repo) {
    try {
      const r = await fetch(`${API}/repos/${repo}/contents/users/${uid}.key?ref=userdata&t=${Date.now()}`, { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw+json' } })
      if (r.ok) return await r.json()
      if (r.status === 403 || r.status === 429) {             // unauthenticated API rate limit → CDN copy
        const r2 = await fetch(`https://raw.githubusercontent.com/${repo}/userdata/users/${uid}.key?t=${Date.now()}`, { cache: 'no-store' })
        if (r2.ok) return await r2.json()
      }
    } catch { /* offline: fall through to the device copy */ }
  }
  try { const s = localStorage.getItem(LOCAL_ACCT(uid)); return s ? JSON.parse(s) : null } catch { return null }
}

/** Save an account file to the repo (so it works on every device) and to this device. Returns where it was saved. */
export async function saveAccount(cfg: SyncCfg | null, uid: string, file: AccountFile): Promise<'everywhere' | 'device'> {
  try { localStorage.setItem(LOCAL_ACCT(uid), JSON.stringify(file)) } catch { /* noop */ }
  if (!cfg) return 'device'
  const path = `/contents/users/${uid}.key`
  const cur = await gh(cfg, `${path}?ref=${cfg.branch}`)
  const sha = cur.ok ? (await cur.json()).sha : undefined
  const body = () => JSON.stringify({ message: 'account', content: btoa(unescape(encodeURIComponent(JSON.stringify(file)))), branch: cfg.branch, ...(sha ? { sha } : {}) })
  let r = await gh(cfg, path, { method: 'PUT', body: body() })
  if (r.status === 404 || r.status === 422) { await ensureBranch(cfg); r = await gh(cfg, path, { method: 'PUT', body: body() }) }
  if (!r.ok) throw new Error(`Could not save the account (${r.status})`)
  return 'everywhere'
}

// ───────── web-news requests + on-demand refresh ─────────
export async function putRequests(cfg: SyncCfg, uid: string, blob: Uint8Array) {
  const path = `/contents/requests/${uid}.bin`
  const cur = await gh(cfg, `${path}?ref=${cfg.branch}`)
  const sha = cur.ok ? (await cur.json()).sha : undefined
  const body = () => JSON.stringify({ message: 'requests', content: b64(blob), branch: cfg.branch, ...(sha ? { sha } : {}) })
  let r = await gh(cfg, path, { method: 'PUT', body: body() })
  if (r.status === 404 || r.status === 422) { await ensureBranch(cfg); r = await gh(cfg, path, { method: 'PUT', body: body() }) }
  return r.ok
}

/** Start a terminal refresh now (needs the token's "Actions: read and write" permission; silently skipped otherwise). */
export async function refreshNow(cfg: SyncCfg): Promise<boolean> {
  try {
    const r = await gh(cfg, '/actions/workflows/refresh.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) })
    return r.status === 204
  } catch { return false }
}
