// Pure selectors over the vault. No research content lives in components — only here and in data/.
import { daysUntil, fv, fyYear, isoToday } from './format'
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

/** Financial facts pivoted: metric -> period -> Fact (restated consolidated preferred). */
export function finTable(r: CompanyRecord) {
  const facts = r.facts?.financials ?? []
  const periods = [...new Set(facts.map(f => f.period).filter(Boolean) as string[])].sort()
  const byMetric = new Map<string, Map<string, Fact>>()
  for (const f of facts) {
    if (!f.period) continue
    if (!byMetric.has(f.metric)) byMetric.set(f.metric, new Map())
    byMetric.get(f.metric)!.set(f.period, f)
  }
  return { periods, byMetric }
}

export function latest(r: CompanyRecord, metric: string): Fact | undefined {
  return (r.facts?.financials ?? []).filter(f => f.metric === metric && f.period)
    .sort((a, b) => (fyYear(b.period) ?? 0) - (fyYear(a.period) ?? 0))[0]
}

/** Implied valuation inputs at the upper band / issue price. All results are CALCULATED, with the formula shown. */
export function valuationInputs(r: CompanyRecord) {
  const f = ipo(r)?.facts ?? {}
  const price = issuePrice(r)
  const post = fv(f.post_issue_shares)
  const mcap = price != null && post != null ? (price * post) / 1e7 : null
  const pat = fv(latest(r, 'pat')), ebitda = fv(latest(r, 'ebitda')), rev = fv(latest(r, 'revenue_from_operations'))
  const debt = fv(latest(r, 'total_debt')), cash = fv(latest(r, 'cash')), fresh = fv(f.fresh_issue)
  const ev = mcap != null && debt != null && cash != null ? mcap + debt - cash - (fresh ?? 0) : null
  const period = latest(r, 'pat')?.period ?? null
  return [
    { label: 'Market cap at issue price', value: mcap, unit: 'INR crore', formula: 'issue price × post-issue shares ÷ 10⁷', meaningful: mcap != null },
    { label: `P/E (${period ?? 'latest FY'} PAT)`, value: mcap != null && pat ? mcap / pat : null, unit: 'x', formula: 'market cap ÷ PAT', meaningful: pat != null && pat > 0, why: pat != null && pat <= 0 ? 'Loss-making: P/E not meaningful' : undefined },
    { label: 'Price / Sales', value: mcap != null && rev ? mcap / rev : null, unit: 'x', formula: 'market cap ÷ revenue from operations', meaningful: !!rev },
    { label: 'Enterprise value (pre-issue net debt)', value: ev, unit: 'INR crore', formula: 'market cap + debt − cash − fresh-issue proceeds', meaningful: ev != null },
    { label: 'EV / EBITDA', value: ev != null && ebitda ? ev / ebitda : null, unit: 'x', formula: 'EV ÷ EBITDA', meaningful: ebitda != null && ebitda > 0, why: ebitda != null && ebitda <= 0 ? 'Negative EBITDA: not meaningful' : undefined },
  ]
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
