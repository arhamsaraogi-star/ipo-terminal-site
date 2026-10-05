import { fmtCur, toCr } from './portfolio'
// Pure selectors over the vault. No research content lives in components — only here and in data/.
import { daysUntil, fv, isoToday } from './format'
import type { CompanyRecord, Event, Fact, Lockin, Vault } from './types'

export const ipo = (r: CompanyRecord) => r.offerings.find(o => o.type === 'IPO')
/** Earliest event of a type; confirmed (actual/scheduled) dates win over derived T+N estimates. */
export const firstEvent = (r: CompanyRecord, t: string) => {
  const all = r.events.filter(e => e.event_type === t).sort((a, b) => a.date.localeCompare(b.date))
  return all.find(e => e.date_kind !== 'derived') ?? all[0]
}
export const eventDate = (r: CompanyRecord, t: string) => firstEvent(r, t)?.date ?? null

export function priceBand(r: CompanyRecord): string {
  const f = ipo(r)?.facts ?? {}
  const lo = fv(f.price_band_low), hi = fv(f.price_band_high)
  return lo != null && hi != null ? `₹${lo}–${hi}` : '—'
}
export const issueSize = (r: CompanyRecord) => fv(ipo(r)?.facts.total_issue) ?? fv(ipo(r)?.facts.fresh_issue)
export const issuePrice = (r: CompanyRecord) => fv(ipo(r)?.facts.issue_price) ?? fv(ipo(r)?.facts.price_band_high)

export function nextEvent(r: CompanyRecord, from = isoToday()): Event | undefined {
  return r.events.filter(e => e.date >= from).sort((a, b) => a.date.localeCompare(b.date))[0]
}
export function nextLockin(r: CompanyRecord, from = isoToday()): Lockin | undefined {
  return r.lockins.filter(l => l.expiry_date >= from).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))[0]
}

export function upcomingEvents(v: Vault, days: number, types?: string[]) {
  const out: { r: CompanyRecord; e: Event; d: number }[] = []
  for (const r of v.companies) for (const e of r.events) {
    const d = daysUntil(e.date)
    if (d >= 0 && d <= days && (!types || types.includes(e.event_type))) out.push({ r, e, d })
  }
  return out.sort((a, b) => a.e.date.localeCompare(b.e.date))
}

export function allLockins(v: Vault) {
  return v.companies.flatMap(r => r.lockins.map(l => ({ r, l, d: daysUntil(l.expiry_date) })))
    .sort((a, b) => a.l.expiry_date.localeCompare(b.l.expiry_date))
}

/** Chronological period order: FY2024 < FY2025 < Sep-2025 (stub) < FY2026 ... */
const MON: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
export function periodKey(p: string): number {
  const fy = p.match(/^FY(\d{4})$/)
  if (fy) return Number(fy[1]) * 100 + 3
  const m = p.match(/^([A-Z][a-z]{2})-(\d{4})$/)
  if (m) return Number(m[2]) * 100 + (MON[m[1]] ?? 0)
  return 0
}
export const isStub = (p: string) => !/^FY\d{4}$/.test(p)

/** Financial facts pivoted: metric -> period -> Fact. Periods oldest → newest. */
export function finTable(r: CompanyRecord) {
  const facts = r.facts?.financials ?? []
  const periods = [...new Set(facts.map(f => f.period).filter(Boolean) as string[])].sort((a, b) => periodKey(a) - periodKey(b))
  const byMetric = new Map<string, Map<string, Fact>>()
  for (const f of facts) {
    if (!f.period) continue
    if (!byMetric.has(f.metric)) byMetric.set(f.metric, new Map())
    byMetric.get(f.metric)!.set(f.period, f)
  }
  return { periods, byMetric }
}

/** Latest FULL financial year value (stub periods are not annual, so they are skipped). */
export function latest(r: CompanyRecord, metric: string): Fact | undefined {
  return (r.facts?.financials ?? []).filter(f => f.metric === metric && f.period && !isStub(f.period) && f.status === 'ok')
    .sort((a, b) => periodKey(b.period!) - periodKey(a.period!))[0]
}

// ───────── market ─────────
export const quote = (r: CompanyRecord) => r.market?.quote ?? null
export const cmp = (r: CompanyRecord) => quote(r)?.close ?? null
export const dayChangePct = (r: CompanyRecord) => { const q = quote(r); return q?.close && q.prev_close ? (q.close / q.prev_close - 1) * 100 : null }
export const listingOpen = (r: CompanyRecord) => r.market?.listing?.open ?? null
export function listingGainPct(r: CompanyRecord) {
  const ip = issuePrice(r), lo = listingOpen(r)
  return ip && lo ? (lo / ip - 1) * 100 : null
}
export function returnVsIssuePct(r: CompanyRecord) {
  const ip = issuePrice(r), c = cmp(r)
  return ip && c ? (c / ip - 1) * 100 : null
}
/** Share count: exchange shares outstanding (listed) > post-issue (doc) > pre-issue + fresh shares at the upper band. */
export function shareCount(r: CompanyRecord): { value: number | null; basis: string } {
  const f = ipo(r)?.facts ?? {}
  const so = fv(f.shares_outstanding); if (so) return { value: so, basis: 'shares outstanding (NSE)' }
  const post = fv(f.post_issue_shares); if (post) return { value: post, basis: 'post-issue shares (offer document)' }
  const pre = fv(f.pre_issue_shares), price = issuePrice(r)
  const freshSh = fv(f.fresh_issue_shares) ?? fv(f.drhp_fresh_issue_shares) ?? ((fv(f.fresh_issue) ?? fv(f.drhp_fresh_issue)) && price ? ((fv(f.fresh_issue) ?? fv(f.drhp_fresh_issue))! * 1e7) / price : null)
  if (pre && freshSh != null) return { value: pre + freshSh, basis: 'pre-issue shares + fresh-issue shares at issue price' }
  return { value: null, basis: '' }
}
export const mcapAtIssue = (r: CompanyRecord) => { const n = shareCount(r).value, p = issuePrice(r); return n && p ? (n * p) / 1e7 : null }
export const mcapNow = (r: CompanyRecord) => quote(r)?.mcap_cr ?? (shareCount(r).value && cmp(r) ? (shareCount(r).value! * cmp(r)!) / 1e7 : null)

/** Last real activity date (filing, issue, listing) — default sort key for every list. */
export function lastActivity(r: CompanyRecord, today = isoToday()): string {
  return r.events.filter(e => e.date_kind !== 'derived' && e.date <= today).reduce((m, e) => (e.date > m ? e.date : m), '0000')
}
export const listedOn = (r: CompanyRecord) => r.events.filter(e => e.event_type === 'LISTING' && e.date_kind === 'actual').map(e => e.date).sort()[0] ?? null

/** Valuation inputs at two price points: issue price and current market price. Every value is CALCULATED. */
export function valuationInputs(r: CompanyRecord) {
  const sc = shareCount(r)
  const pat = latest(r, 'pat'), ebitda = latest(r, 'ebitda'), rev = latest(r, 'revenue_from_operations')
  const nw = latest(r, 'net_worth'), debt = latest(r, 'total_borrowings'), cash = latest(r, 'cash_and_equivalents')
  const f = ipo(r)?.facts ?? {}
  const fresh = fv(f.fresh_issue) ?? fv(f.drhp_fresh_issue)
  const points = [{ key: 'issue', label: 'At issue price', price: issuePrice(r) }, { key: 'cmp', label: 'At market price', price: cmp(r) }]
  const per = (price: number | null) => {
    const mcap = price && sc.value ? (price * sc.value) / 1e7 : null
    const netDebt = fv(debt) != null && fv(cash) != null ? fv(debt)! - fv(cash)! - (fresh ?? 0) : null
    const ev = mcap != null && netDebt != null ? mcap + netDebt : null
    return {
      mcap, ev,
      pe: mcap != null && fv(pat) ? (fv(pat)! > 0 ? mcap / fv(pat)! : null) : null,
      pb: mcap != null && fv(nw) ? mcap / fv(nw)! : null,
      ps: mcap != null && fv(rev) ? mcap / fv(rev)! : null,
      evEbitda: ev != null && fv(ebitda) ? (fv(ebitda)! > 0 ? ev / fv(ebitda)! : null) : null,
    }
  }
  return {
    points: points.map(p => ({ ...p, ...per(p.price) })), shares: sc,
    inputs: { pat, ebitda, rev, nw, debt, cash, fresh },
    lossMaking: fv(pat) != null && fv(pat)! <= 0,
  }
}

// ───────── portfolio marks (listed and pre-IPO) ─────────
export interface Mark { label: string; date: string | null; value_cr: number | null; perShare: number | null; multiple: number | null; cagr: number | null; text?: string }
export function holdingMarks(r: CompanyRecord, h: import('./types').Holding): { cost_cr: number | null; marks: Mark[] } {
  const qty = h.quantity || 0
  if (r.custom) return customMarks(r.custom, h)
  const cost_cr = h.invested_cr ?? (qty && h.avg_cost ? (qty * h.avg_cost) / 1e7 : null)
  const entryVal = h.entry_valuation_cr ?? null
  const marks: Mark[] = []
  const years = (d: string | null) => d ? Math.max((Date.parse(d) - Date.parse(h.acquired_on)) / (365.25 * 864e5), 1 / 365) : null
  const add = (label: string, date: string | null, valuation_cr: number | null, perShare: number | null) => {
    let multiple: number | null = null
    if (perShare != null && h.avg_cost) multiple = perShare / h.avg_cost
    else if (valuation_cr != null && entryVal) multiple = valuation_cr / entryVal
    const y = years(date)
    marks.push({ label, date, value_cr: valuation_cr, perShare, multiple, cagr: multiple != null && y ? (Math.pow(multiple, 1 / y) - 1) * 100 : null })
  }
  if (h.latest_round_cr) add('Latest private round', h.latest_round_on ?? null, h.latest_round_cr, null)
  const ip = issuePrice(r)
  if (ip) add('IPO issue price', eventDate(r, 'BASIS_OF_ALLOTMENT') ?? eventDate(r, 'ISSUE_CLOSE'), mcapAtIssue(r), ip)
  const c = cmp(r)
  if (c) add('Market price', quote(r)?.date ?? null, mcapNow(r), c)
  return { cost_cr, marks }
}

/** Your own private company: marks come from the rounds you entered (same currency as your entry valuation). */
function customMarks(p: import('./types').PrivateCo, h: import('./types').Holding): { cost_cr: number | null; marks: Mark[] } {
  const cur = p.currency || 'INR'
  const qty = h.quantity || 0
  const invested = h.invested_cr ?? (qty && h.avg_cost ? (cur === 'INR' ? (qty * h.avg_cost) / 1e7 : (qty * h.avg_cost) / 1e6) : null)
  const cost_cr = toCr(invested, cur, p.fx_inr)
  const years = (d: string | null) => d ? Math.max((Date.parse(d) - Date.parse(h.acquired_on)) / (365.25 * 864e5), 1 / 365) : null
  const marks: Mark[] = []
  for (const rd of [...p.rounds].sort((a, b) => a.date.localeCompare(b.date))) {
    if (rd.date < h.acquired_on) continue
    let multiple: number | null = null
    if (rd.price_per_share && h.avg_cost) multiple = rd.price_per_share / h.avg_cost
    else if (rd.post_money && h.entry_valuation_cr) multiple = rd.post_money / h.entry_valuation_cr
    const y = years(rd.date)
    marks.push({ label: rd.label || 'Round', date: rd.date, value_cr: toCr(rd.post_money, cur, p.fx_inr), perShare: rd.price_per_share ?? null, multiple,
      cagr: multiple != null && y && y >= 0.25 ? (Math.pow(multiple, 1 / y) - 1) * 100 : null, text: rd.post_money != null ? `${fmtCur(rd.post_money, cur)} val.` : undefined })
  }
  return { cost_cr, marks }
}

export const isHeld = (v: Vault, id: string) => v.portfolio.holdings.some(h => h.company_id === id)
export const isWatched = (v: Vault, id: string) => v.portfolio.watchlist.includes(id)
export const byId = (v: Vault, id: string) => v.companies.find(c => c.company.company_id === id)

/** Pre-filled GitHub issue: the portfolio workflow parses it and commits data/portfolio/holdings.json. */
export function portfolioIssueUrl(repo: string | null | undefined, action: 'add' | 'remove' | 'watch' | 'unwatch', companyId: string) {
  if (!repo) return null
  const body = action === 'add'
    ? `company_id: ${companyId}\nquantity: \navg_cost: \nacquired_on: ${isoToday()}\nroute: ALLOTMENT  # ALLOTMENT | MARKET | PRE_IPO\n`
    : `company_id: ${companyId}\n`
  const q = new URLSearchParams({ title: `portfolio: ${action} ${companyId}`, labels: 'portfolio', body })
  return `https://github.com/${repo}/issues/new?${q}`
}
