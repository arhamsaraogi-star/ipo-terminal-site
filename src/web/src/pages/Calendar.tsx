import { useEffect, useState } from 'react'
import { useVault } from '../App'
import { PageHead, Seg } from '../components/ui'
import { isMine } from '../lib/derive'
import { isoToday } from '../lib/format'

const GROUP_COLOR: Record<string, string> = { pipeline: '#7d5cff', issue: '#0a84ff', lockin: '#ff9f0a', post_listing: '#34c77b', corporate: '#ff375f' }

export default function Calendar() {
  const v = useVault()
  const t = isoToday()
  const [ym, setYm] = useState(t.slice(0, 7))
  const [scope, setScope] = useState<'all' | 'tracked'>(() => { try { return (localStorage.getItem('cal-scope') as 'all' | 'tracked') || 'all' } catch { return 'all' } })
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [open])
  const pick = (x: 'all' | 'tracked') => { setScope(x); try { localStorage.setItem('cal-scope', x) } catch { /* noop */ } }
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7 // Monday-first
  const events = v.companies.filter(r => scope === 'all' || isMine(v, r.company.company_id))
    .flatMap(r => r.events.filter(e => e.date.startsWith(ym)).map(e => ({ r, e })))
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(d.toISOString().slice(0, 7)) }
  const label = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div>
      <PageHead title="IPO Calendar" sub="Every dated milestone: filings, issue dates, listings, lock-ins, results."
        action={<div className="flex gap-2 items-center flex-wrap"><Seg value={scope} onChange={pick} options={[{ v: 'all', label: 'All' }, { v: 'tracked', label: 'Tracked' }]} /><button className="btn" onClick={() => shift(-1)}>‹</button>
          <span className="display font-semibold text-lg w-44 text-center">{label}</span>
          <button className="btn" onClick={() => shift(1)}>›</button><button className="btn" onClick={() => setYm(t.slice(0, 7))}>Today</button></div>} />
      <div className="flex flex-wrap gap-4 mb-4 text-sm ink2">
        {Object.entries(GROUP_COLOR).map(([g, c]) => <span key={g}><b style={{ color: c }}>●</b> {g.replace('_', ' ')}</span>)}
      </div>
      <div className="md:hidden glass panel p-3 space-y-3">
        {Array.from({ length: days }).map((_, i) => {
          const iso = `${ym}-${String(i + 1).padStart(2, '0')}`
          const evs = events.filter(x => x.e.date === iso)
          if (!evs.length && iso !== t) return null
          return (
            <div key={iso}>
              <div className={`eyebrow mb-1 ${iso === t ? 'pos' : ''}`}>{new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}{iso === t ? ' · today' : ''}</div>
              {evs.length ? evs.map(({ r, e }, k) => (
                <a key={k} href={`#/company/${r.company.company_id}`} className="flex gap-2 items-center py-1 no-underline" style={{ color: 'var(--ink)' }}>
                  <b style={{ color: GROUP_COLOR[v.event_types[e.event_type]?.group ?? 'pipeline'] ?? 'var(--accent)' }}>●</b>
                  <span className="font-medium">{r.company.name.replace(/ (Private )?Limited$/i, '')}</span>
                  <span className="muted text-sm">· {v.event_types[e.event_type]?.label ?? e.event_type}</span>
                </a>)) : <div className="muted text-sm">Nothing scheduled</div>}
            </div>)
        })}
        {!events.length && <div className="muted">No milestones this month.</div>}
      </div>
      <div className="hidden md:block glass panel p-3 overflow-x-auto">
        <div className="grid grid-cols-7 gap-2 min-w-[760px]">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="eyebrow px-2">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={'l' + i} />)}
          {Array.from({ length: days }).map((_, i) => {
            const iso = `${ym}-${String(i + 1).padStart(2, '0')}`
            const evs = events.filter(x => x.e.date === iso)
            return (
              <div key={iso} className="rounded-2xl p-2 min-h-[110px]" style={{ background: iso === t ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--hairline)', outline: iso === t ? '2px solid var(--accent)' : 'none' }}>
                <button className={`text-sm font-semibold mb-1 ${iso === t ? '' : 'muted'} hover:underline`} onClick={() => evs.length && setOpen(iso)}>{i + 1}</button>
                <div className="space-y-1">
                  {evs.slice(0, 4).map(({ r, e }) => (
                    <a key={e.event_id} href={`#/company/${r.company.company_id}`} className="block text-[12px] leading-tight rounded-lg px-1.5 py-1 no-underline truncate"
                      style={{ background: 'var(--glass-solid)', color: 'var(--ink)', borderLeft: `3px solid ${GROUP_COLOR[v.event_types[e.event_type]?.group] ?? '#999'}` }}
                      title={`${r.company.name} — ${v.event_types[e.event_type]?.label}`}>
                      <b>{r.company.name.replace(/ (Private )?Limited$/i, '').split(' ').slice(0, r.company.name.split(' ')[0].length <= 3 ? 3 : 2).join(' ')}</b> {v.event_types[e.event_type]?.label}
                    </a>
                  ))}
                  {evs.length > 4 && <button className="text-xs muted hover:underline" onClick={() => setOpen(iso)}>+{evs.length - 4} more</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {open && (() => {
        const evs = events.filter(x => x.e.date === open)
          .sort((a, b) => (v.event_types[a.e.event_type]?.order ?? 99) - (v.event_types[b.e.event_type]?.order ?? 99) || a.r.company.name.localeCompare(b.r.company.name))
        const groups = [...new Set(evs.map(x => v.event_types[x.e.event_type]?.label ?? x.e.event_type))]
        return (
          <div className="fixed inset-0 z-[60] grid place-items-center p-4" style={{ background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)' }} onClick={() => setOpen(null)}>
            <div className="glass glass-strong w-full max-w-[640px] max-h-[85vh] overflow-y-auto p-5 fade-in" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="eyebrow">{scope === 'tracked' ? 'Tracked companies' : 'All IPO milestones'}</div>
                  <h2 className="display text-[26px] font-bold leading-tight">{new Date(open + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
                  <div className="muted text-sm">{evs.length} event{evs.length === 1 ? '' : 's'}</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn" aria-label="Previous day" onClick={() => { const d = new Date(open + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); setOpen(d.toISOString().slice(0, 10)) }}>‹</button>
                  <button className="btn" aria-label="Next day" onClick={() => { const d = new Date(open + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); setOpen(d.toISOString().slice(0, 10)) }}>›</button>
                  <button className="btn" onClick={() => setOpen(null)} aria-label="Close">✕</button>
                </div>
              </div>
              {!evs.length && <p className="muted">Nothing scheduled{open.slice(0, 7) !== ym ? ' (or this day is in another month — use ‹ › on the calendar)' : ''}.</p>}
              {groups.map(g => (
                <div key={g} className="mb-4">
                  <div className="eyebrow mb-1.5">{g}</div>
                  <div className="space-y-1.5">
                    {evs.filter(x => (v.event_types[x.e.event_type]?.label ?? x.e.event_type) === g).map(({ r, e }) => (
                      <a key={e.event_id} href={`#/company/${r.company.company_id}`} onClick={() => setOpen(null)} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 no-underline"
                        style={{ background: 'var(--glass-solid)', color: 'var(--ink)', borderLeft: `3px solid ${GROUP_COLOR[v.event_types[e.event_type]?.group] ?? '#999'}` }}>
                        <span className="min-w-0"><b className="block truncate">{r.company.name}</b>
                          <span className="muted text-xs">{r.company.segment === 'SME' ? 'SME' : r.company.segment === 'MAINBOARD' ? 'Mainboard' : ''}{e.detail ? ` · ${e.detail}` : ''}{e.date_kind === 'derived' ? ' · estimated' : e.date_kind === 'scheduled' ? ' · scheduled' : ''}</span></span>
                        <span className="muted text-sm shrink-0">→</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
