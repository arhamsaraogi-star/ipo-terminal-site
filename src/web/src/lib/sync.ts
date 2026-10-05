// Cross-device memory: your portfolio, tracking list and private companies, encrypted with your personal key
// (derived from your password — the server never sees it) and stored as users/<uid>.bin on the repo's `userdata`
// branch through the GitHub API. The API token lives inside the encrypted vault, so only signed-in users have it.
import type { Pf } from './portfolio'
import { openUser, sealUser, type Session } from './vault'

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
  if (!c.ok && c.status !== 422) throw new Error(`sync: cannot create branch (${c.status})`)
}

/** Pull the latest copy. Returns null if this user has never synced. */
export async function pull(cfg: SyncCfg, s: Session): Promise<{ remote: Remote | null; sha: string | null }> {
  const r = await gh(cfg, `/contents/users/${s.uid}.bin?ref=${cfg.branch}`)
  if (r.status === 404) return { remote: null, sha: null }
  if (!r.ok) throw new Error(`sync: pull failed (${r.status})`)
  const j = await r.json()
  return { remote: await openUser<Remote>(s, unb64(j.content)), sha: j.sha }
}

export async function push(cfg: SyncCfg, s: Session, pf: Pf, sha: string | null): Promise<{ sha: string | null; conflict: boolean }> {
  const body = await sealUser(s, { pf, updated_at: new Date().toISOString(), device: navigator.userAgent.slice(0, 60) } satisfies Remote)
  const put = () => gh(cfg, `/contents/users/${s.uid}.bin`, { method: 'PUT', body: JSON.stringify({ message: 'sync', content: b64(body), branch: cfg.branch, ...(sha ? { sha } : {}) }) })
  let r = await put()
  if (r.status === 404 || (r.status === 422 && !sha)) { await ensureBranch(cfg); r = await put() }
  if (r.status === 409 || r.status === 422) return { sha, conflict: true }
  if (!r.ok) throw new Error(`sync: push failed (${r.status})`)
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
    watchlist: [], deleted: [...deleted].slice(-500),
  }
}
