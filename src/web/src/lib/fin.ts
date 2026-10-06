// Plain-English financial model for a company: reported rows where the offer document gives them, calculated rows (marked)
// where it does not. Used by the Executive Print; every calculated number says how it was derived.
import { finTable, isStub } from './derive'
import { fv, isoToday } from './format'
import type { CompanyRecord } from './types'

export type FinUnit = 'cr' | 'pct' | 'x' | 'rs'
export interface FinRow { key: string; label: string; hint: string; unit: FinUnit; values: (number | null)[]; calc?: string; group: string }
export interface FinModel { periods: string[]; notes: string[]; rows: FinRow[]; row: (k: string) => FinRow | undefined; lastFy: number; prevFy: number }

const TAX = 0.2517   // new-regime corporate tax rate, used only for the estimated FCFF

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** Last day of a reporting period label: FY2026 → 2026-03-31, Sep-2026 → 2026-09-30. Null when the label is not understood. */
export function periodEnd(p: string): string | null {
  const fy = p.match(/^FY(\d{4})$/)
  if (fy) return `${fy[1]}-03-31`
  const m = p.match(/^([A-Za-z]{3})-(\d{4})$/)
  const mi = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  if (!m || mi < 0) return null
  return new Date(Date.UTC(+m[2], mi + 1, 0)).toISOString().slice(0, 10)
}

export function finModel(r: CompanyRecord): FinModel {
  const { periods: allPeriods, byMetric } = finTable(r)
  // a year that has not ended cannot have restated results: drop forecast / empty columns (FY2027 in October 2026)
  const today = isoToday()
  const periods = allPeriods.filter(p => { const e = periodEnd(p); return !e || e <= today })
  const get = (m: string) => periods.map(p => fv(byMetric.get(m)?.get(p)))
  const has = (a: (number | null)[]) => a.some(x => x != null)
  const div = (a: (number | null)[], b: (number | null)[], mult = 1) => a.map((x, i) => (x != null && b[i] ? (x / b[i]!) * mult : null))
  const rows: FinRow[] = []
  const add = (key: string, label: string, hint: string, unit: FinUnit, values: (number | null)[], group: string, calc?: string) => {
    if (has(values)) rows.push({ key, label, hint, unit, values, group, calc })
  }
  const fy = periods.map(p => !isStub(p))
  const rev = get('revenue_from_operations'), ebitda = get('ebitda'), pat = get('pat'), pbt = get('pbt'), nw = get('net_worth')
  const borrow = get('total_borrowings'), cash = get('cash_and_equivalents'), ta = get('total_assets'), cl = get('current_liabilities')
  // identical balance-sheet figures in two different periods mean the document's columns were mis-read: show neither
  const bs = [nw, borrow, cash, ta, cl]
  const notes: string[] = []
  for (let i = 1; i < periods.length; i++) {
    const same = bs.filter(a => a[i] != null && a[i] === a[i - 1]).length
    if (same >= 3) { for (const a of bs) { a[i] = null; a[i - 1] = null }; notes.push(`Balance-sheet figures for ${periods[i - 1]} and ${periods[i]} are left out: the document gave identical numbers for both, so one was misread.`) }
  }
  const fin = get('finance_cost'), cfo = get('cfo'), cfi = get('cfi'), cff = get('cff'), capex = get('capex').map(x => (x == null ? null : Math.abs(x)))

  // growth: only between consecutive full years
  const growth = (a: (number | null)[]) => a.map((x, i) => {
    if (!fy[i] || x == null) return null
    const j = [...periods.keys()].filter(k => k < i && fy[k]).pop()
    return j != null && a[j] ? ((x / a[j]!) - 1) * 100 : null
  })
  const rep = (m: string, calc: (number | null)[], how: string): [(number | null)[], string | undefined] => {
    const reported = get(m)
    if (has(reported)) return [reported.map((x, i) => x ?? calc[i]), undefined]
    return [calc, has(calc) ? how : undefined]
  }

  add('rev', 'Revenue from operations', 'Money earned from selling its products or services', 'cr', rev, 'Growth and profit')
  { const [v, c] = rep('revenue_growth', growth(rev), 'this year ÷ last year − 1'); add('rev_g', 'Revenue growth', 'How much sales grew over the year before', 'pct', v, 'Growth and profit', c) }
  add('ebitda', 'EBITDA', 'Operating profit, before interest, tax and wear-and-tear', 'cr', ebitda, 'Growth and profit')
  { const [v, c] = rep('ebitda_margin', div(ebitda, rev, 100), 'EBITDA ÷ revenue'); add('ebitda_m', 'EBITDA margin', 'Out of every ₹100 of sales, the operating profit', 'pct', v, 'Growth and profit', c) }
  add('pbt', 'Profit before tax', 'Profit after all costs, before income tax', 'cr', pbt, 'Growth and profit')
  add('pat', 'Profit after tax (PAT)', 'Final profit for the owners', 'cr', pat, 'Growth and profit')
  { const [v, c] = rep('pat_growth', growth(pat), 'this year ÷ last year − 1'); add('pat_g', 'PAT growth', 'How much final profit grew', 'pct', v, 'Growth and profit', c) }
  { const [v, c] = rep('pat_margin', div(pat, rev, 100), 'PAT ÷ revenue'); add('pat_m', 'PAT margin', 'Out of every ₹100 of sales, the final profit', 'pct', v, 'Growth and profit', c) }
  add('eps', 'Earnings per share (₹)', 'Profit per share', 'rs', get('eps_diluted').map((x, i) => x ?? get('eps_basic')[i]), 'Growth and profit')

  { const [v, c] = rep('roe', div(pat, nw, 100), 'PAT ÷ closing net worth'); add('roe', 'Return on equity (ROE)', 'Profit earned on the owners\' money', 'pct', has(get('roe')) ? v : get('ronw').map((x, i) => x ?? v[i]), 'Returns', c) }
  {
    const ebit = pbt.map((x, i) => (x != null && fin[i] != null ? x + fin[i]! : null))
    const capEmp = ta.map((x, i) => (x != null && cl[i] != null ? x - cl[i]! : null))
    const [v, c] = rep('roce', div(ebit, capEmp, 100), '(profit before tax + finance costs) ÷ (total assets − current liabilities)')
    add('roce', 'Return on capital employed (ROCE)', 'Profit earned on all the money used in the business', 'pct', v, 'Returns', c)
  }

  add('nw', 'Net worth', 'The owners\' stake: assets minus all debts', 'cr', nw, 'Balance sheet')
  add('debt', 'Borrowings', 'Money owed to banks and lenders', 'cr', borrow, 'Balance sheet')
  add('cash', 'Cash and equivalents', 'Cash in hand and in the bank', 'cr', cash, 'Balance sheet')
  { const [v, c] = rep('net_debt', borrow.map((x, i) => (x != null && cash[i] != null ? x - cash[i]! : null)), 'borrowings − cash'); add('nd', 'Net debt', 'Borrowings minus cash (negative = more cash than debt)', 'cr', v, 'Balance sheet', c) }
  { const [v, c] = rep('debt_equity', div(borrow, nw), 'borrowings ÷ net worth'); add('de', 'Debt to equity (times)', 'Rupees borrowed for every rupee of owners\' money', 'x', v, 'Balance sheet', c) }
  add('ta', 'Total assets', 'Everything the company owns', 'cr', ta, 'Balance sheet')

  add('cfo', 'Cash from operations (CFO)', 'Cash the business itself generated', 'cr', cfo, 'Cash flow')
  add('cfi', 'Cash from investing (CFI)', 'Cash spent on / received from investments and assets (usually negative)', 'cr', cfi, 'Cash flow')
  add('cff', 'Cash from financing (CFF)', 'Cash raised from / paid back to lenders and owners', 'cr', cff, 'Cash flow')
  add('capex', 'Capital expenditure', 'Spent on plant, equipment and other fixed assets', 'cr', capex, 'Cash flow')
  add('fcf', 'Free cash flow (CFO − capex)', 'Cash left after maintaining and growing the asset base', 'cr', cfo.map((x, i) => (x != null && capex[i] != null ? x - capex[i]! : null)), 'Cash flow', 'CFO − capital expenditure')
  add('fcff', 'Free cash flow to the firm (FCFF, estimated)', 'Cash available to all lenders and owners', 'cr',
    cfo.map((x, i) => (x != null && capex[i] != null && fin[i] != null ? x + fin[i]! * (1 - TAX) - capex[i]! : null)), 'Cash flow', `CFO + finance costs × (1 − ${(TAX * 100).toFixed(2)}% tax) − capex`)
  add('net', 'Net change in cash', 'CFO + CFI + CFF', 'cr', cfo.map((x, i) => (x != null && cfi[i] != null && cff[i] != null ? x + cfi[i]! + cff[i]! : null)), 'Cash flow', 'CFO + CFI + CFF')

  const idx = (k: number) => [...periods.keys()].filter(i => fy[i]).slice(-k)[0] ?? -1
  return { periods, notes, rows, row: k => rows.find(x => x.key === k), lastFy: idx(1), prevFy: idx(2) }
}

export const fmtFin = (v: number | null | undefined, u: FinUnit): string => {
  if (v == null || !isFinite(v)) return '—'
  const neg = v < 0, a = Math.abs(v)
  const body = u === 'pct' ? `${a.toFixed(1)}%` : u === 'x' ? `${a.toFixed(2)}x` : u === 'rs' ? `₹${a.toFixed(2)}`
    : a.toLocaleString('en-IN', { minimumFractionDigits: a < 100 ? 1 : 0, maximumFractionDigits: a < 100 ? 1 : 0 })
  return neg ? `(${body})` : body
}
