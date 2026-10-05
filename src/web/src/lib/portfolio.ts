// Holdings, tracked companies and your own private companies live in this browser (the public repo never sees them).
// Export / import moves them between devices.
import type { CompanyRecord, Holding, PrivateCo, Track, TrackStatus } from './types'

export interface Pf { holdings: Holding[]; watchlist: string[]; tracking: Track[]; privates: PrivateCo[]; deleted?: string[] }
const KEY = 'ipo-terminal:portfolio:v1'
const today = () => new Date().toISOString().slice(0, 10)

export const normalisePf = (p: Partial<Pf>) => normalise(p)
function normalise(p: Partial<Pf>): Pf {
  const holdings = Array.isArray(p.holdings) ? p.holdings.filter(h => h && h.company_id) : []
  const tracking: Track[] = Array.isArray(p.tracking) ? p.tracking.filter(t => t && t.company_id) : []
  // legacy watchlist → tracking (Interested)
  for (const id of Array.isArray(p.watchlist) ? p.watchlist : []) {
    if (typeof id === 'string' && !tracking.some(t => t.company_id === id)) tracking.push({ company_id: id, status: 'INTERESTED', added_on: today() })
  }
  const privates = Array.isArray(p.privates) ? p.privates.filter(x => x && x.company_id && x.name).map(x => ({ ...x, rounds: Array.isArray(x.rounds) ? x.rounds : [] })) : []
  return { holdings, watchlist: [], tracking, privates, deleted: Array.isArray(p.deleted) ? p.deleted.filter(x => typeof x === 'string') : [] }
}

/** Record deletions as tombstones (so a sync merge never resurrects them) and clear tombstones for re-added items. */
export function withTombstones(prev: Pf, next: Pf): Pf {
  const ids = (p: Pf) => new Set([...p.holdings.map(x => `h:${x.company_id}`), ...p.tracking.map(x => `t:${x.company_id}`), ...p.privates.map(x => `p:${x.company_id}`)])
  const a = ids(prev), b = ids(next)
  const del = new Set(next.deleted ?? prev.deleted ?? [])
  for (const k of a) if (!b.has(k)) del.add(k)
  for (const k of b) del.delete(k)
  return { ...next, deleted: [...del].slice(-500) }
}
export const isEmpty = (p: Pf) => !p.holdings.length && !p.tracking.length && !p.privates.length

const key = (uid?: string) => (uid ? `ipo-terminal:pf:${uid}` : KEY)
export function loadPf(uid?: string): Pf {
  try { return normalise(JSON.parse(localStorage.getItem(key(uid)) ?? '{}')) } catch { return normalise({}) }
}
export function savePf(p: Pf, uid?: string) { try { localStorage.setItem(key(uid), JSON.stringify(p)) } catch { /* storage blocked */ } }
/** One-time: data saved before logins existed is folded into the first account that signs in on this browser. */
export function takeLegacy(): Pf | null {
  try { const raw = localStorage.getItem(KEY); if (!raw) return null; localStorage.removeItem(KEY); const p = normalise(JSON.parse(raw)); return isEmpty(p) ? null : p } catch { return null }
}

export function exportPf(p: Pf) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }))
  a.download = `ipo-portfolio-${today()}.json`
  a.click()
}
export async function importPf(file: File): Promise<Pf> {
  const p = JSON.parse(await file.text())
  if (!p || typeof p !== 'object' || !Array.isArray(p.holdings)) throw new Error('Not a portfolio file')
  return normalise(p)
}

// ───────── tracking ─────────
export const TRACK: Record<TrackStatus, { label: string; tone: string }> = {
  INTERESTED: { label: 'Interested', tone: 'blue' },
  EVALUATING: { label: 'Evaluating', tone: 'indigo' },
  IN_TALKS: { label: 'In talks with BRLM', tone: 'violet' },
  COMMITTED: { label: 'Committed', tone: 'green' },
  PASSED: { label: 'Passed', tone: 'slate' },
}
export function setTrack(pf: Pf, id: string, status: TrackStatus | null, note?: string | null): Pf {
  const rest = pf.tracking.filter(t => t.company_id !== id)
  if (!status) return { ...pf, tracking: rest }
  const cur = pf.tracking.find(t => t.company_id === id)
  return { ...pf, tracking: [...rest, { company_id: id, status, note: note ?? cur?.note ?? null, added_on: cur?.added_on ?? today(), updated_on: today() }] }
}

// ───────── private companies (anywhere in the world) ─────────
export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
export const unitLabel = (cur: string) => (cur === 'INR' ? '₹ cr' : `${cur} mn`)
/** Amount in the company's unit (₹ crore for INR, millions otherwise) → ₹ crore. Null when no FX rate for a foreign currency. */
export function toCr(x: number | null | undefined, cur: string | null | undefined, fx: number | null | undefined) {
  if (x == null) return null
  if (!cur || cur === 'INR') return x
  return fx ? (x * fx) / 10 : null
}
export function fmtCur(x: number | null | undefined, cur: string) {
  if (x == null || !isFinite(x)) return '—'
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2
  return cur === 'INR' ? `₹${x.toLocaleString('en-IN', { maximumFractionDigits: d })} cr` : `${cur} ${x.toLocaleString('en-US', { maximumFractionDigits: d })} mn`
}

export function privateRecord(p: PrivateCo): CompanyRecord {
  const rounds = [...p.rounds].sort((a, b) => a.date.localeCompare(b.date))
  return {
    company: {
      company_id: p.company_id, name: p.name, aliases: [], identifiers: {}, sector: p.sector ?? null, segment: 'PRIVATE', lifecycle: 'PRIVATE',
      website: p.website ?? null, updated_at: p.created_on, overview: p.note ? { summary: p.note } : null, sources: ['manual'],
    },
    offerings: [], facts: null, documents: [], lockins: [], news: [], market: null,
    events: [], custom: { ...p, rounds },
  }
}

// ───────── returns ─────────
/** Money-weighted annual return. flows: negative = invested, positive = value / proceeds. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) return null
  const t0 = Math.min(...flows.map(f => Date.parse(f.date)))
  const yrs = flows.map(f => (Date.parse(f.date) - t0) / (365.25 * 864e5))
  if (Math.max(...yrs) < 1 / 365) return null
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, yrs[i]), 0)
  let lo = -0.99, hi = 100
  if (npv(lo) * npv(hi) > 0) return null
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid }
  return ((lo + hi) / 2) * 100
}

/** Same normalisation as pipeline/ingestion/private_intel.py norm_name. */
export const intelKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
