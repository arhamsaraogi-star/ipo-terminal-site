// Holdings & watchlist live in this browser (the public repo never sees them).
// Export / import moves them between devices.
import type { Holding } from './types'

export interface Pf { holdings: Holding[]; watchlist: string[] }
const KEY = 'ipo-terminal:portfolio:v1'

export function loadPf(): Pf {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '')
    if (Array.isArray(p.holdings) && Array.isArray(p.watchlist)) return p
  } catch { /* empty or blocked storage */ }
  return { holdings: [], watchlist: [] }
}
export function savePf(p: Pf) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* noop */ } }

export function exportPf(p: Pf) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }))
  a.download = `ipo-portfolio-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
}
export async function importPf(file: File): Promise<Pf> {
  const p = JSON.parse(await file.text())
  if (!Array.isArray(p.holdings) || !Array.isArray(p.watchlist)) throw new Error('Not a portfolio file')
  return { holdings: p.holdings.filter((h: Holding) => h.company_id && h.quantity >= 0), watchlist: p.watchlist.filter((x: unknown) => typeof x === 'string') }
}
