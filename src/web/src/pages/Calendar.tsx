import { useState } from 'react'
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
                <div className={`text-sm font-semibold mb-1 ${iso === t ? '' : 'muted'}`}>{i + 1}</div>
                <div className="space-y-1">
                  {evs.slice(0, 4).map(({ r, e }) => (
                    <a key={e.event_id} href={`#/company/${r.company.company_id}`} className="block text-[12px] leading-tight rounded-lg px-1.5 py-1 no-underline truncate"
                      style={{ background: 'var(--glass-solid)', color: 'var(--ink)', borderLeft: `3px solid ${GROUP_COLOR[v.event_types[e.event_type]?.group] ?? '#999'}` }}
                      title={`${r.company.name} — ${v.event_types[e.event_type]?.label}`}>
                      <b>{r.company.name.replace(/ (Private )?Limited$/i, '').split(' ').slice(0, r.company.name.split(' ')[0].length <= 3 ? 3 : 2).join(' ')}</b> {v.event_types[e.event_type]?.label}
                    </a>
                  ))}
                  {evs.length > 4 && <div className="text-xs muted">+{evs.length - 4} more</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
