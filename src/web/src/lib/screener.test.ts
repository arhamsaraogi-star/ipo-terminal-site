import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { parseScreener } from './screener'
import { readXlsx } from './xlsx'

/** Build a minimal .xlsx (one sheet "Data Sheet") from rows, the way a spreadsheet app would store it. */
function xlsx(rows: (string | number | null)[][]): ArrayBuffer {
  const shared: string[] = []
  const si = (s: string) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1 } return i }
  const col = (i: number) => String.fromCharCode(65 + i)
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => c == null ? '' : typeof c === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${c}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(c)}</v></c>`).join('')}</row>`).join('')
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Data Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${shared.map(s => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
  }
  const z = zipSync(files)
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer
}
const serial = (iso: string) => Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000)

const SHEET = [
  ['COMPANY NAME', 'Yash Highvoltage Ltd'], [],
  ['PROFIT & LOSS'], ['Report Date', serial('2024-03-31'), serial('2025-03-31'), serial('2026-03-31')],
  ['Sales', 108, 150, 190], ['Other Income', 1, 2, 2], ['Depreciation', 3, 4, 5], ['Interest', 2, 2.5, 3], ['Profit before tax', 16, 24, 31], ['Tax', 4, 6, 8], ['Net profit', 12, 18, 23],
  [], ['Quarters'], ['Report Date', serial('2026-03-31'), serial('2026-06-30')], ['Sales', 55, 58], ['Net profit', 7, 8],
  [], ['BALANCE SHEET'], ['Report Date', serial('2024-03-31'), serial('2025-03-31'), serial('2026-03-31')],
  ['Equity Share Capital', 22, 22, 22], ['Reserves', 20, 36, 55], ['Borrowings', 6, 5, 4], ['Total', 60, 80, 100], ['Cash & Bank', 8, 12, 20], ['No. of Equity Shares', 22000000, 22000000, 22000000],
  [], ['CASH FLOW:'], ['Report Date', serial('2024-03-31'), serial('2025-03-31'), serial('2026-03-31')],
  ['Cash from Operating Activity', 10, 16, 22], ['Cash from Investing Activity', -9, -14, -18], ['Cash from Financing Activity', 1, -1, -2],
] as (string | number | null)[][]

describe('xlsx reader + Screener import', () => {
  it('reads sheets, strings and numbers', () => {
    const book = readXlsx(xlsx([['a', 1], [null, 'b & c']]))
    expect(book['Data Sheet'][0]).toEqual(['a', 1])
    expect(book['Data Sheet'][1][1]).toBe('b & c')
  })

  it('turns a Screener export into the terminal\'s financial facts', () => {
    const imp = parseScreener(xlsx(SHEET), 'yash', '2026-10-06T00:00:00Z')
    const v = (m: string, p: string) => imp.facts.find(f => f.metric === m && f.period === p)?.value
    expect(imp.name).toBe('Yash Highvoltage Ltd')
    expect(v('revenue_from_operations', 'FY2026')).toBe(190)
    expect(v('pat', 'FY2025')).toBe(18)
    expect(v('ebitda', 'FY2026')).toBe(31 + 3 + 5 - 2)          // PBT + interest + depreciation − other income
    expect(v('net_worth', 'FY2026')).toBe(77)
    expect(v('total_assets', 'FY2026')).toBe(100)
    expect(v('cfo', 'FY2026')).toBe(22)
    expect(v('cfi', 'FY2026')).toBe(-18)
    expect(v('eps_basic', 'FY2026')).toBeCloseTo(10.45, 1)      // 23 cr ÷ 2.2 cr shares
    expect(imp.quarters[0]).toMatchObject({ period_end: '2026-06-30', income: 58, pat: 8 })
  })

  it('refuses a file that is not a Screener export', () => {
    expect(() => parseScreener(xlsx([['hello', 1]]), 'x')).toThrow(/Screener export/)
  })
})
