import { describe, expect, it } from 'vitest'
import { finModel, fmtFin, periodEnd } from './fin'
import { goodOverview } from './overview'
import type { CompanyRecord, Fact } from './types'

const f = (metric: string, period: string, value: number, unit = 'INR crore'): Fact => ({ fact_id: `${metric}:${period}`, metric, value, unit, period, kind: 'reported', status: 'ok' })
const rec = (facts: Fact[]): CompanyRecord => ({ company: { company_id: 'x', name: 'X', aliases: [], identifiers: {}, segment: 'MAINBOARD', lifecycle: 'DRHP_FILED', updated_at: '2026-01-01' },
  offerings: [], facts: { financials: facts, industry: [] }, documents: [], events: [], lockins: [], news: [] })

describe('financial model', () => {
  it('understands period ends', () => {
    expect(periodEnd('FY2026')).toBe('2026-03-31')
    expect(periodEnd('Sep-2025')).toBe('2025-09-30')
    expect(periodEnd('nonsense')).toBeNull()
  })

  it('never shows a year that has not ended', () => {
    const m = finModel(rec([f('revenue_from_operations', 'FY2025', 100), f('revenue_from_operations', 'FY2026', 120), f('revenue_growth', 'FY2099', 10, '%')]))
    expect(m.periods).toEqual(['FY2025', 'FY2026'])
  })

  it('calculates growth, margins, returns and free cash flow, and says so', () => {
    const m = finModel(rec([
      f('revenue_from_operations', 'FY2025', 100), f('revenue_from_operations', 'FY2026', 150), f('pat', 'FY2025', 10), f('pat', 'FY2026', 15), f('net_worth', 'FY2026', 100),
      f('pbt', 'FY2026', 20), f('finance_cost', 'FY2026', 5), f('total_assets', 'FY2026', 300), f('current_liabilities', 'FY2026', 100),
      f('cfo', 'FY2026', 40), f('capex', 'FY2026', -25),
    ]))
    const at = (k: string) => m.row(k)?.values[m.lastFy]
    expect(at('rev_g')).toBeCloseTo(50)
    expect(at('pat_m')).toBeCloseTo(10)
    expect(at('roe')).toBeCloseTo(15)
    expect(at('roce')).toBeCloseTo(12.5)              // (20 + 5) / (300 − 100)
    expect(at('fcf')).toBe(15)                         // 40 − |−25|
    expect(m.row('roe')?.calc).toBeTruthy()
    expect(m.row('rev')?.calc).toBeUndefined()
  })

  it('drops identical balance-sheet columns instead of showing a misread', () => {
    const bs = (p: string, a: number, b: number, c: number) => [f('net_worth', p, a), f('total_borrowings', p, b), f('total_assets', p, c)]
    const m = finModel(rec([...bs('FY2024', 30.9, 6.8, 41.9), ...bs('FY2025', 30.9, 6.8, 41.9), ...bs('FY2026', 42.4, 4.6, 77.6)]))
    expect(m.row('nw')?.values).toEqual([null, null, 42.4])
    expect(m.notes.length).toBe(1)
  })

  it('formats money with brackets for negatives', () => {
    expect(fmtFin(-3.84, 'cr')).toBe('(3.8)')
    expect(fmtFin(11, 'cr')).toBe('11.0')
    expect(fmtFin(null, 'pct')).toBe('—')
  })
})

describe('overview quality check', () => {
  it('rejects disclaimers and accepts a business description', () => {
    expect(goodOverview('We have included certain non-GAAP financial measures and other performance indicators relating to our financial performance in this Draft Red Herring Prospectus, each of which are supplemental measures.')).toBe(false)
    expect(goodOverview('Yash Highvoltage Limited is engaged in the manufacturing and distribution of a wide range of transformer bushings, including oil impregnated paper condenser bushings, and also provides repair services.')).toBe(true)
  })
})
