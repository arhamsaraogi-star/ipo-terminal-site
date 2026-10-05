import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { STAGE, fmtDate, fmtFact, humanize } from '../lib/format'
import type { Fact, Lifecycle, Source } from '../lib/types'

export function Card({ title, action, children, className = '', solid = false }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; solid?: boolean
}) {
  return (
    <section className={`glass ${solid ? 'panel' : ''} p-5 fade-in ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 mb-3">
          {title && <h2 className="display text-[19px] font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="glass p-5 fade-in">
      <div className="eyebrow">{label}</div>
      <div className={`display text-[38px] font-semibold leading-tight mt-1 ${tone ?? ''}`}>{value}</div>
      {sub && <div className="muted text-sm mt-1">{sub}</div>}
    </div>
  )
}

export const Pill = ({ tone = 'slate', children }: { tone?: string; children: ReactNode }) =>
  <span className={`pill tone-${tone}`}>{children}</span>

export const Stage = ({ s }: { s: Lifecycle }) => <Pill tone={STAGE[s].tone}>{STAGE[s].label}</Pill>

export function SourceLine({ s }: { s?: Source | null }) {
  if (!s) return <span className="muted">No source</span>
  const where = [s.source_type, s.page ? `p.${s.page}` : null, s.table].filter(Boolean).join(' · ')
  return s.url.startsWith('http')
    ? <a href={s.url} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted">{where}</a>
    : <span>{where}</span>
}

/** Any number in the terminal: click to see where it came from. */
export function FactValue({ f, children }: { f?: Fact | null; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (!f) return <span className="muted">—</span>
  const review = f.status === 'requires_review'
  return (
    <span ref={ref} className="relative inline-block">
      <span className={`fact ${f.kind === 'calculated' ? 'calc' : ''} ${review ? 'warn' : ''}`} onClick={() => setOpen(o => !o)}
        role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}>
        {children ?? fmtFact(f)}{review && ' ⚠'}
      </span>
      {open && (
        <span className="pop glass glass-strong left-0 top-7 block text-left font-normal" style={{ color: 'var(--ink)' }}>
          <span className="eyebrow block mb-1">{f.label ?? humanize(f.metric)}{f.period ? ` · ${f.period}` : ''}</span>
          <span className="block"><b>{f.kind === 'calculated' ? 'Calculated' : 'Reported'}</b>{f.basis ? ` · ${humanize(f.basis)}` : ''}</span>
          {f.formula && <span className="block muted">= {f.formula}</span>}
          {f.source && <span className="block mt-1">Source: <SourceLine s={f.source} /></span>}
          {f.extraction && <span className="block muted">Extracted {fmtDate(f.extraction.extracted_at)} · {f.extraction.method}</span>}
          {f.note && <span className="block mt-1">{f.note}</span>}
          {review && <span className="block warn mt-1">Requires review — failed a validation check</span>}
        </span>
      )}
    </span>
  )
}

export interface Col<T> { key: string; label: ReactNode; render: (r: T) => ReactNode; sort?: (r: T) => number | string | null; right?: boolean }

export function Table<T>({ rows, cols, onRow, empty = 'Nothing here yet', initialSort }: {
  rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; empty?: string; initialSort?: { key: string; dir: 1 | -1 }
}) {
  const [sort, setSort] = useState(initialSort)
  const sorted = useMemo(() => {
    const c = cols.find(c => c.key === sort?.key)
    if (!c?.sort || !sort) return rows
    return [...rows].sort((a, b) => {
      const x = c.sort!(a), y = c.sort!(b)
      if (x == null) return 1
      if (y == null) return -1
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [rows, cols, sort])
  if (!rows.length) return <div className="muted py-6 text-center">{empty}</div>
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="tbl">
        <thead><tr>{cols.map(c => (
          <th key={c.key} className={c.right ? 'r' : ''} data-sort={c.sort ? '' : undefined}
            onClick={() => c.sort && setSort(s => ({ key: c.key, dir: s?.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
            {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
          </th>))}</tr></thead>
        <tbody>{sorted.map((r, i) => (
          <tr key={i} className={onRow ? 'row-link' : ''} onClick={() => onRow?.(r)}>
            {cols.map(c => <td key={c.key} className={c.right ? 'r' : ''}>{c.render(r)}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(o =>
    <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>
}

export function PageHead({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="display text-[34px] font-bold leading-tight">{title}</h1>
        {sub && <p className="muted mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  )
}
