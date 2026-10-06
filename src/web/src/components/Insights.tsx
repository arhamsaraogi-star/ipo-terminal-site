import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { go, useVault } from '../App'
import { anchorOutcome, timelineStats } from '../lib/derive'
import { fmtDate } from '../lib/format'
import { brlms } from '../pages/AnchorDesk'
import { Card, Delta, Seg, Table } from './ui'

const short = (n: string) => n.replace(/\s*\(formerly[^)]*\)/i, '').replace(/ (Private )?Limited$/i, '').replace(/ Capital Markets| Securities| Investment Advisors/i, m => m)

/** What anchors actually earned, by lead manager — issue price → day-30 and day-90 unlocks (blended 50/50 exit). */
export function AnchorScorecard() {
  const v = useVault()
  const [seg, setSeg] = useState<'MAINBOARD' | 'SME' | 'ALL'>('MAINBOARD')
  const deals = useMemo(() => v.companies.filter(r => seg === 'ALL' || r.company.segment === seg)
    .map(r => ({ r, o: anchorOutcome(r) })).filter(x => x.o && x.o.blended != null) as { r: typeof v.companies[number]; o: NonNullable<ReturnType<typeof anchorOutcome>> }[], [v, seg])
  const banks = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const d of deals) for (const b of brlms(d.r)) { const k = short(b.name); m.set(k, [...(m.get(k) ?? []), d.o.blended!]) }
    return [...m.entries()].filter(([, a]) => a.length >= 2).map(([name, a]) => {
      const s = [...a].sort((x, y) => x - y)
      return { name, n: a.length, median: s[Math.floor(s.length / 2)], hit: a.filter(x => x > 0).length / a.length * 100, avg: a.reduce((p, x) => p + x, 0) / a.length }
    }).sort((a, b) => b.median - a.median)
  }, [deals])
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
  const all = deals.map(d => d.o.blended!)
  return (
    <Card title="Anchor scorecard — what anchors actually made" action={<Seg value={seg} onChange={setSeg} options={[{ v: 'MAINBOARD', label: 'Mainboard' }, { v: 'SME', label: 'SME' }, { v: 'ALL', label: 'All' }]} />} solid>
      <p className="muted text-sm mb-3">For every listed IPO: buy at the issue price, sell half at the day-30 unlock and half at day-90 (or today, if not reached). {deals.length} deals · median <b className="ink2"><Delta v={med(all)} /></b> · {all.length ? Math.round(all.filter(x => x > 0).length / all.length * 100) : 0}% made money.</p>
      {!!banks.length && (
        <div style={{ height: Math.max(160, Math.min(banks.length, 12) * 30) }} className="mb-4">
          <ResponsiveContainer>
            <BarChart data={banks.slice(0, 12)} layout="vertical" margin={{ left: 4, right: 30 }}>
              <CartesianGrid stroke="var(--hairline)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: 'var(--ink-2)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(x, _n, p) => [`${Number(x).toFixed(1)}% median · ${p.payload.n} deals · ${p.payload.hit.toFixed(0)}% positive`, 'Anchor return']} cursor={{ fill: 'var(--hairline)' }} />
              <Bar dataKey="median" radius={[0, 4, 4, 0]} maxBarSize={16}>{banks.slice(0, 12).map((b, i) => <Cell key={i} fill={b.median >= 0 ? '#199e70' : '#d95926'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <Table rows={deals} onRow={x => go(`/company/${x.r.company.company_id}`)} initialSort={{ key: 'l', dir: -1 }} pageSize={15} cols={[
        { key: 'c', label: 'Company', render: x => <div><b>{x.r.company.name}</b><div className="muted text-xs">{brlms(x.r).map(b => short(b.name)).join(', ') || '—'}</div></div> },
        { key: 'l', label: 'Listed', right: true, render: x => fmtDate(x.o.listed, false), sort: x => x.o.listed },
        { key: 'o', label: 'Listing', right: true, render: x => <Delta v={x.o.rOpen} />, sort: x => x.o.rOpen },
        { key: 'a', label: 'Day 30', right: true, render: x => <Delta v={x.o.r30} />, sort: x => x.o.r30 },
        { key: 'b', label: 'Day 90', right: true, render: x => <Delta v={x.o.r90} />, sort: x => x.o.r90 },
        { key: 'x', label: 'Anchor return', right: true, m: 'key', render: x => <b><Delta v={x.o.blended} /></b>, sort: x => x.o.blended },
      ]} />
    </Card>
  )
}

export function TimelineCard() {
  const v = useVault()
  const rows = (['MAINBOARD', 'SME'] as const).map(s => ({ s, st: timelineStats(v, s) }))
  return (
    <Card title="How long from DRHP to launch?" solid>
      <div className="grid grid-cols-2 gap-4">
        {rows.map(({ s, st }) => (
          <div key={s} className="glass p-4">
            <div className="eyebrow">{s === 'SME' ? 'SME' : 'Mainboard'}</div>
            <div className="display text-[28px] font-semibold mt-1">{st.toOpen.p50 != null ? `${Math.round(st.toOpen.p50 / 30)} mo` : '—'}</div>
            <div className="muted text-xs">median DRHP → issue open{st.toOpen.p25 != null ? ` · middle half ${Math.round(st.toOpen.p25 / 30)}–${Math.round(st.toOpen.p75! / 30)} mo` : ''} · {st.toOpen.n} issues</div>
          </div>
        ))}
      </div>
      <p className="muted text-xs mt-3">Measured on the issues in this terminal. Each pipeline company shows its own expected window on its page.</p>
    </Card>
  )
}

/** "Since your last visit": what changed for you since you last opened the terminal on this device. */
export function SinceLastVisit() {
  const v = useVault()
  const KEY = 'ipo-terminal:last-visit'
  const [since] = useState<string | null>(() => { try { return localStorage.getItem(KEY) } catch { return null } })
  useMemo(() => { const t = setTimeout(() => { try { localStorage.setItem(KEY, new Date().toISOString()) } catch { /* noop */ } }, 4000); return () => clearTimeout(t) }, [])
  if (!since) return null
  const sinceDay = since.slice(0, 10)
  const mine = new Set([...v.portfolio.holdings.map(h => h.company_id), ...v.portfolio.tracking.map(t => t.company_id)])
  const filings = v.companies.filter(r => r.events.some(e => ['DRHP_FILED', 'UDRHP_FILED', 'RHP_FILED'].includes(e.event_type) && e.date >= sinceDay && e.date_kind === 'actual'))
  const listings = v.companies.filter(r => r.events.some(e => e.event_type === 'LISTING' && e.date_kind === 'actual' && e.date >= sinceDay && e.date <= new Date().toISOString().slice(0, 10)))
  const news = v.companies.filter(r => mine.has(r.company.company_id)).flatMap(r => r.news.filter(n => n.published_at >= since).map(n => ({ r, n })))
  const changes = v.changes.filter(c => c.detected_at >= since && mine.has(c.company_id))
  const items = [
    { n: filings.length, l: 'new offer documents', href: '#/anchor' },
    { n: listings.length, l: 'listings', href: '#/listed' },
    { n: news.length, l: 'headlines on your names', href: '#/tracked' },
    { n: changes.length, l: 'changes on your names', href: '#/tracked' },
  ]
  if (!items.some(i => i.n)) return null
  const ago = Math.max(1, Math.round((Date.now() - Date.parse(since)) / 36e5))
  return (
    <div className="glass panel p-4 fade-in">
      <div className="eyebrow mb-2">Since your last visit · {ago < 48 ? `${ago}h ago` : `${Math.round(ago / 24)}d ago`}</div>
      <div className="flex flex-wrap gap-2">
        {items.filter(i => i.n).map(i => <a key={i.l} href={i.href} className="btn no-underline"><b className="display text-[17px]">{i.n}</b> {i.l}</a>)}
      </div>
    </div>
  )
}
