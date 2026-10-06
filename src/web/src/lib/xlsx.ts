// Minimal .xlsx reader (zip + XML), enough for export files: sheet name → rows of strings / numbers. No dependency on a spreadsheet library.
import { unzipSync, strFromU8 } from 'fflate'

export type Cell = string | number | null
export type Sheet = Cell[][]

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]

export function readXlsx(buf: ArrayBuffer): Record<string, Sheet> {
  const files = unzipSync(new Uint8Array(buf))
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : '')
  const shared: string[] = []
  for (const si of text('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) ?? [])
    shared.push(unesc([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')))
  const rels = new Map<string, string>()
  for (const r of text('xl/_rels/workbook.xml.rels').match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(r, 'Id'), target = attr(r, 'Target')
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const out: Record<string, Sheet> = {}
  for (const s of text('xl/workbook.xml').match(/<sheet\b[^>]*>/g) ?? []) {
    const name = unesc(attr(s, 'name') ?? ''), path = rels.get(attr(s, 'r:id') ?? '')
    if (!name || !path || !files[path]) continue
    const rows: Sheet = []
    for (const row of text(path).match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const rIdx = Number(attr(row.slice(0, row.indexOf('>') + 1), 'r') ?? rows.length + 1) - 1
      const cells: Cell[] = []
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const head = c.slice(0, c.indexOf('>') + 1)
        const ref = attr(head, 'r'), t = attr(head, 't')
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        const inline = c.match(/<is>[\s\S]*?<\/is>/)?.[0]
        let val: Cell = null
        if (t === 's' && v != null) val = shared[Number(v)] ?? null
        else if (t === 'inlineStr' && inline) val = unesc([...inline.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
        else if (t === 'str' && v != null) val = unesc(v)
        else if (v != null && v !== '') { const n = Number(v); val = Number.isFinite(n) ? n : unesc(v) }
        if (ref) cells[colIndex(ref)] = val
      }
      rows[rIdx] = Array.from(cells, x => x ?? null)
    }
    out[name] = Array.from(rows, r => r ?? [])
  }
  return out
}
