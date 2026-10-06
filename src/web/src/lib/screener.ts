// Screener.in "Export to Excel" (Pro) → this terminal's financial facts. The export's "Data Sheet" has sections
// (PROFIT & LOSS, Quarters, BALANCE SHEET, CASH FLOW) each starting with a "Report Date" row; amounts are in ₹ crore.
import { readXlsx, type Cell, type Sheet } from './xlsx'
import type { Fact } from './types'

export interface ScreenerImport {
  company_id: string; imported_at: string; name?: string
  facts: Fact[]
  quarters: { period_end: string; income: number | null; pat: number | null; eps: number | null }[]
}

const SECTIONS = ['PROFIT & LOSS', 'QUARTERS', 'BALANCE SHEET', 'CASH FLOW', 'DERIVED', 'PRICE', 'META']
const num = (c: Cell | undefined) => (typeof c === 'number' && isFinite(c) ? c : null)
const iso = (c: Cell | undefined): string | null => {
  if (typeof c === 'number' && c > 20000 && c < 90000) return new Date(Date.UTC(1899, 11, 30) + c * 86_400_000).toISOString().slice(0, 10)   // Excel serial date
  if (typeof c === 'string') { const t = Date.parse(c); if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10) }
  return null
}
const fyLabel = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return `FY${m <= 3 ? y : y + 1}` }

interface Block { dates: (string | null)[]; rows: Map<string, (number | null)[]> }

function blocks(sheet: Sheet): { name?: string; byName: Map<string, Block> } {
  const byName = new Map<string, Block>()
  let cur: Block | null = null, name: string | undefined
  for (const r of sheet) {
    const label = typeof r[0] === 'string' ? r[0].trim() : ''
    if (!label) continue
    if (/^company name$/i.test(label) && typeof r[1] === 'string') name = r[1]
    const sec = SECTIONS.find(s => label.toUpperCase().replace(/:$/, '') === s)
    if (sec) { cur = { dates: [], rows: new Map() }; byName.set(sec, cur); continue }
    if (!cur) continue
    if (/^report date$/i.test(label)) { cur.dates = r.slice(1).map(iso); continue }
    const key = cur.rows.has(label) ? `${label}#2` : label        // "Total" appears twice on the balance sheet (liabilities, assets)
    cur.rows.set(key, r.slice(1).map(num))
  }
  return { name, byName }
}

export function parseScreener(buf: ArrayBuffer, company_id: string, now = new Date().toISOString()): ScreenerImport {
  const book = readXlsx(buf)
  const sheet = book['Data Sheet'] ?? Object.values(book).find(s => s.some(r => typeof r[0] === 'string' && /^report date$/i.test(r[0].trim())))
  if (!sheet) throw new Error('This is not a Screener export (no "Data Sheet"). On Screener, open the company and choose Export to Excel.')
  const { name, byName } = blocks(sheet)
  const pl = byName.get('PROFIT & LOSS'), bs = byName.get('BALANCE SHEET'), cf = byName.get('CASH FLOW'), q = byName.get('QUARTERS')
  if (!pl || !pl.dates.some(Boolean)) throw new Error('No profit & loss table found: this does not look like a Screener export. On Screener, open the company and choose Export to Excel.')
  const facts: Fact[] = []
  const add = (metric: string, label: string, period: string, value: number | null, unit = 'INR crore') => {
    if (value == null) return
    facts.push({ fact_id: `${company_id}:${metric}:${period}:screener`, metric, label, value: Math.round(value * 100) / 100, unit, period, basis: 'Screener export (user upload)', kind: 'reported',
      source: { source_type: 'THIRD_PARTY', url: `https://www.screener.in/`, table: 'Screener.in — Export to Excel', tier: 'secondary' }, status: 'ok' })
  }
  const at = (b: Block | undefined, label: string, i: number) => b?.rows.get(label)?.[i] ?? null
  const bsIdx = new Map((bs?.dates ?? []).map((d, i) => [d, i] as const)), cfIdx = new Map((cf?.dates ?? []).map((d, i) => [d, i] as const))
  pl.dates.forEach((d, i) => {
    if (!d) return
    const p = fyLabel(d)
    const sales = at(pl, 'Sales', i), pbt = at(pl, 'Profit before tax', i), interest = at(pl, 'Interest', i), dep = at(pl, 'Depreciation', i), other = at(pl, 'Other Income', i)
    const pat = at(pl, 'Net profit', i)
    add('revenue_from_operations', 'Revenue from operations', p, sales)
    add('pbt', 'Profit before tax', p, pbt)
    add('pat', 'Profit after tax', p, pat)
    add('finance_cost', 'Finance costs', p, interest)
    if (pbt != null && interest != null && dep != null) add('ebitda', 'EBITDA', p, pbt + interest + dep - (other ?? 0))
    const b = bsIdx.get(d), c = cfIdx.get(d)
    if (b != null) {
      const eq = at(bs, 'Equity Share Capital', b), res = at(bs, 'Reserves', b), shares = at(bs, 'No. of Equity Shares', b)
      if (eq != null && res != null) add('net_worth', 'Net worth', p, eq + res)
      add('equity_share_capital', 'Equity share capital', p, eq)
      add('total_borrowings', 'Total borrowings', p, at(bs, 'Borrowings', b))
      add('cash_and_equivalents', 'Cash & equivalents', p, at(bs, 'Cash & Bank', b))
      add('total_assets', 'Total assets', p, at(bs, 'Total#2', b) ?? at(bs, 'Total', b))
      if (pat != null && shares) add('eps_basic', 'EPS (basic)', p, (pat * 1e7) / shares, 'INR')
    }
    if (c != null) {
      add('cfo', 'Cash flow from operations', p, at(cf, 'Cash from Operating Activity', c))
      add('cfi', 'Cash flow from investing', p, at(cf, 'Cash from Investing Activity', c))
      add('cff', 'Cash flow from financing', p, at(cf, 'Cash from Financing Activity', c))
    }
  })
  const quarters: ScreenerImport['quarters'] = []
  ;(q?.dates ?? []).forEach((d, i) => { if (d) quarters.push({ period_end: d, income: at(q, 'Sales', i), pat: at(q, 'Net profit', i), eps: null }) })
  quarters.sort((a, b) => b.period_end.localeCompare(a.period_end))
  quarters.length = Math.min(quarters.length, 12)
  if (!facts.length) throw new Error('The file was read but no financial rows were recognised.')
  return { company_id, imported_at: now, name, facts, quarters }
}
