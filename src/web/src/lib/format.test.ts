import { describe, expect, it } from 'vitest'
import { cagr, crore, fmtFact, shares, urgency } from './format'

describe('format', () => {
  it('computes CAGR', () => { expect(cagr(100, 200, 5)!).toBeCloseTo(14.87, 2); expect(cagr(0, 10, 3)).toBeNull() })
  it('formats Indian units', () => { expect(crore(1500)).toBe('₹1,500 cr'); expect(shares(200_000_000)).toBe('20.00 cr sh') })
  it('never shows a number for unavailable facts', () => {
    expect(fmtFact({ fact_id: 'x', metric: 'ofs', value: null, unit: 'INR crore', kind: 'reported', status: 'not_available' })).toBe('Not available')
  })
  it('urgency bands', () => {
    expect(urgency(-1).key).toBe('expired'); expect(urgency(3).key).toBe('lt7'); expect(urgency(30).key).toBe('7to30')
    expect(urgency(60).key).toBe('30to90'); expect(urgency(91).key).toBe('gt90')
  })
})
