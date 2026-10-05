import type { Fact, Lifecycle } from './types'

export const TODAY = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
export const isoToday = () => { const d = TODAY(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const [ty, tm, td] = isoToday().split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
}

export const fmtDate = (iso?: string | null, withYear = true) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}
export const fmtDateTime = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  : '—'

const nf = (d = 0) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })
export const num = (v: number, d = 0) => nf(d).format(v)
export const crore = (v?: number | null, d = 0) => (v == null ? '—' : `₹${nf(d).format(v)} cr`)
export const inr = (v?: number | null, d = 0) => (v == null ? '—' : `₹${nf(d).format(v)}`)
export const pct = (v?: number | null, d = 1) => (v == null || !isFinite(v) ? '—' : `${nf(d).format(v)}%`)
export const shares = (v?: number | null) => {
  if (v == null) return '—'
  if (v >= 1e7) return `${nf(2).format(v / 1e7)} cr sh`
  if (v >= 1e5) return `${nf(2).format(v / 1e5)} lakh sh`
  return `${nf(0).format(v)} sh`
}

export function fv(f?: Fact | null): number | null {
  return f && f.status === 'ok' && typeof f.value === 'number' ? f.value : null
}

export function fmtFact(f?: Fact | null): string {
  if (!f) return '—'
  if (f.status === 'not_available') return 'Not available'
  if (f.status === 'not_meaningful') return 'Not meaningful'
  if (typeof f.value !== 'number') return f.value == null ? '—' : String(f.value)
  switch (f.unit) {
    case 'INR crore': return crore(f.value, Math.abs(f.value) < 100 ? 1 : 0)
    case 'INR': return inr(f.value)
    case '%': return pct(f.value)
    case 'shares': return shares(f.value)
    case 'INR trillion': return `₹${nf(2).format(f.value)} tn`
    case 'x': return `${nf(1).format(f.value)}x`
    default: return `${nf(2).format(f.value)} ${f.unit}`
  }
}

export const cagr = (start: number, end: number, years: number) =>
  start > 0 && end > 0 && years > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : null

export const fyYear = (p?: string | null) => { const m = p?.match(/FY(\d{4})/); return m ? Number(m[1]) : null }

export const STAGE: Record<Lifecycle, { label: string; tone: string; rank: number }> = {
  PRIVATE: { label: 'Private', tone: 'slate', rank: 0 },
  DRHP_FILED: { label: 'DRHP filed', tone: 'violet', rank: 1 },
  SEBI_OBSERVED: { label: 'SEBI observed', tone: 'indigo', rank: 2 },
  RHP_FILED: { label: 'RHP filed', tone: 'blue', rank: 3 },
  ISSUE_ANNOUNCED: { label: 'Announced', tone: 'cyan', rank: 4 },
  ISSUE_OPEN: { label: 'Open now', tone: 'green', rank: 5 },
  ISSUE_CLOSED: { label: 'Closed', tone: 'amber', rank: 6 },
  LISTED: { label: 'Listed', tone: 'emerald', rank: 7 },
  WITHDRAWN: { label: 'Withdrawn', tone: 'rose', rank: 8 },
  LAPSED: { label: 'Lapsed', tone: 'rose', rank: 9 },
}

export function urgency(days: number): { key: string; label: string; tone: string } {
  if (days < 0) return { key: 'expired', label: 'Expired', tone: 'slate' }
  if (days < 7) return { key: 'lt7', label: '< 7 days', tone: 'rose' }
  if (days <= 30) return { key: '7to30', label: '7–30 days', tone: 'amber' }
  if (days <= 90) return { key: '30to90', label: '30–90 days', tone: 'blue' }
  return { key: 'gt90', label: '> 90 days', tone: 'slate' }
}

export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
