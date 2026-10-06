import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePf, useVault, go } from '../App'
import { Card, Delta, Kpi, PageHead, Pill, Seg, Stage, Table } from '../components/ui'
import { byId, cmp, holdingMarks, issuePrice, nextEvent, nextLockin } from '../lib/derive'
import { money, crore, daysUntil, fmtDate, fmtDateTime, inr, urgency } from '../lib/format'
import { TRACK, exportPf, importPf, xirr } from '../lib/portfolio'
import type { CompanyRecord, Holding } from '../lib/types'

const ROUTE: Record<string, string> = { PRE_IPO: 'Pre-IPO', ANCHOR: 'Anchor', ALLOTMENT: 'IPO allotment', MARKET: 'Market' }

export function positionValue(r: CompanyRecord, h: Holding) {
  const { cost_cr, marks } = holdingMarks(r, h)
  const best = marks.length ? marks[marks.length - 1] : null           // most recent mark (CMP > issue > round)
  const value_cr = best?.multiple != null && cost_cr != null ? cost_cr * best.multiple : null
  return { cost_cr, value_cr, best, marks }
}

/** Whole-book returns: invested, marked value, gain, MOIC and money-weighted XIRR. */
export function summary(v: ReturnType<typeof useVault>) {
  const pos = v.portfolio.holdings.map(h => ({ h, r: byId(v, h.company_id) })).filter(x => x.r).map(x => ({ ...x, r: x.r!, ...positionValue(x.r!, x.h) }))
  const priced = pos.filter(p => p.cost_cr != null)
  const cost = priced.reduce((s, p) => s + p.cost_cr!, 0)
  const value = priced.reduce((s, p) => s + (p.value_cr ?? p.cost_cr!), 0)
  const today = new Date().toISOString().slice(0, 10)
  const yrs = cost ? priced.reduce((s, p) => s + p.cost_cr! * (Date.now() - Date.parse(p.h.acquired_on)) / (365.25 * 864e5), 0) / cost : 0
  const irr = yrs >= 0.5 ? xirr([...priced.map(p => ({ date: p.h.acquired_on, amount: -p.cost_cr! })), { date: today, amount: value }]) : null
  const unmarked = priced.filter(p => p.value_cr == null).length
  return { pos, cost, value, gain: value - cost, moic: cost ? value / cost : null, irr, yrs, unmarked, missingCost: pos.length - priced.length }
}

export function ReturnsStrip() {
  const v = useVault()
  const S = summary(v)
  return (
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
      <Kpi label="Invested" value={money(S.cost)} sub={`${S.pos.length} position${S.pos.length === 1 ? '' : 's'}`} />
      <Kpi label="Current value" value={money(S.value)} sub={S.unmarked ? `${S.unmarked} held at cost (no newer mark)` : 'marked to latest price / round'} />
      <Kpi label="Gain / loss" value={<span className={S.gain >= 0 ? 'pos' : 'neg'}>{S.gain >= 0 ? '+' : ''}{money(S.gain)}</span>} sub={<Delta v={S.cost ? (S.value / S.cost - 1) * 100 : null} />} />
      <Kpi label="Multiple (MOIC)" value={S.moic != null ? `${S.moic.toFixed(2)}x` : '—'} sub="value ÷ invested" />
      <Kpi label="XIRR" value={S.irr != null ? <Delta v={S.irr} /> : '—'} sub={S.irr != null ? 'money-weighted, annualised' : 'shown once the book is ~6 months old (annualising weeks overstates)'} />
    </div>
  )
}

export function ReturnsChart() {
  const v = useVault()
  const S = summary(v)
  const data = S.pos.filter(p => p.cost_cr != null).map(p => ({ n: p.r.company.name.replace(/ (Private )?Limited$/i, '').slice(0, 22), Cost: p.cost_cr!, Value: p.value_cr ?? p.cost_cr! }))
    .sort((a, b) => b.Value - a.Value).slice(0, 12)
  if (!data.length) return null
  return (
    <Card title="Cost vs current value" solid>
      <div style={{ height: Math.max(160, data.length * 42) }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }} barGap={2}>
            <CartesianGrid stroke="var(--hairline)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={x => money(Number(x))} />
            <YAxis type="category" dataKey="n" width={140} tick={{ fill: 'var(--ink-2)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(x, n) => [money(Number(x)), n]} cursor={{ fill: 'var(--hairline)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Cost" fill="#8a93a6" radius={[0, 4, 4, 0]} maxBarSize={14} />
            <Bar dataKey="Value" fill="#3987e5" radius={[0, 4, 4, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

export function TrackingTable({ limit }: { limit?: number }) {
  const v = useVault()
  const rows = v.portfolio.tracking.map(t => ({ t, r: byId(v, t.company_id) })).filter(x => x.r).map(x => ({ ...x, r: x.r! }))
    .sort((a, b) => (b.t.updated_on ?? b.t.added_on).localeCompare(a.t.updated_on ?? a.t.added_on)).slice(0, limit ?? 999)
  return <Table rows={rows} empty="Nothing tracked yet — press ◎ Track on any company (IPO, DRHP, listed or your own private company)."
    onRow={x => go(`/company/${x.r.company.company_id}`)} cols={[
      { key: 'c', label: 'Company', render: x => <div><b>{x.r.company.name}</b>{x.t.note && <div className="muted text-xs line-clamp-1">{x.t.note}</div>}</div>, sort: x => x.r.company.name },
      { key: 's', label: 'Status', render: x => <Pill tone={TRACK[x.t.status].tone}>{TRACK[x.t.status].label}</Pill>, sort: x => x.t.status },
      { key: 'st', label: 'Stage', render: x => x.r.custom ? <Pill tone="violet">Private</Pill> : <Stage s={x.r.company.lifecycle} /> },
      { key: 'ne', label: 'Next / latest', render: x => { const e = nextEvent(x.r); const n = x.r.news[0]
        return e ? <span className="text-sm">{v.event_types[e.event_type]?.label ?? e.event_type} · <b>{fmtDate(e.date, false)}</b></span> : n ? <span className="text-sm ink2 line-clamp-1">{n.title}</span> : <span className="muted">—</span> } },
      { key: 'p', label: 'Price', right: true, hideMobile: true, render: x => cmp(x.r) ? inr(cmp(x.r), 2) : issuePrice(x.r) ? `${inr(issuePrice(x.r))} issue` : '—' },
    ]} />
}

export function HoldingsTable() {
  const v = useVault()
  const rows = v.portfolio.holdings.map(h => ({ h, r: byId(v, h.company_id)! })).filter(x => x.r).map(x => ({ ...x, ...positionValue(x.r, x.h) }))
  return <Table rows={rows} empty="No investments yet — open any company and press ★ Add to portfolio (pre-IPO, anchor, allotment or market)."
    onRow={x => go(`/company/${x.r.company.company_id}`)} initialSort={{ key: 'val', dir: -1 }}
    cols={[
      { key: 'c', label: 'Company', sort: x => x.r.company.name, render: x => <div><b>{x.r.company.name}</b><div className="muted text-xs">{ROUTE[x.h.route] ?? x.h.route} · since {fmtDate(x.h.acquired_on)}</div></div> },
      { key: 's', label: 'Stage', render: x => x.r.custom ? <Pill tone="violet">Private · {x.r.custom.country}</Pill> : <Stage s={x.r.company.lifecycle} /> },
      { key: 'cost', label: 'Cost', right: true, render: x => money(x.cost_cr), sort: x => x.cost_cr },
      { key: 'mark', label: 'Latest mark', right: true, render: x => x.best ? <span>{x.best.text ?? (x.best.perShare != null ? inr(x.best.perShare, 2) : crore(x.best.value_cr))}<div className="muted text-xs">{x.best.label}</div></span> : <span className="muted">held at cost</span> },
      { key: 'val', label: 'Value', right: true, render: x => money(x.value_cr ?? x.cost_cr), sort: x => x.value_cr },
      { key: 'mult', label: 'Multiple', right: true, render: x => x.best?.multiple != null ? <b className={x.best.multiple >= 1 ? 'pos' : 'neg'}>{x.best.multiple.toFixed(2)}x</b> : '—', sort: x => x.best?.multiple ?? null },
      { key: 'cagr', label: 'CAGR', right: true, render: x => <Delta v={x.best?.cagr} />, sort: x => x.best?.cagr ?? null, hideMobile: true },
      { key: 'ne', label: 'Next event', hideMobile: true, render: x => { const e = nextEvent(x.r); return e ? <span className="text-sm">{v.event_types[e.event_type]?.label ?? e.event_type} · <b>{fmtDate(e.date, false)}</b></span> : <span className="muted">—</span> } },
      { key: 'nl', label: 'Next unlock', right: true, hideMobile: true, render: x => { const l = nextLockin(x.r); if (!l) return <span className="muted">—</span>; const d = daysUntil(l.expiry_date); return <Pill tone={urgency(d).tone}>{d}d</Pill> } },
    ]} />
}

function MarksTable() {
  const v = useVault()
  const rows = v.portfolio.holdings.map(h => ({ h, r: byId(v, h.company_id)! })).filter(x => x.r)
    .flatMap(x => { const { marks, cost_cr } = holdingMarks(x.r, x.h); return marks.map(m => ({ ...x, m, cost_cr })) })
  if (!rows.length) return null
  return (
    <Card title="Marks: entry vs latest round vs IPO vs market" solid>
      <Table rows={rows} onRow={x => go(`/company/${x.r.company.company_id}`)} cols={[
        { key: 'c', label: 'Company', render: x => <b>{x.r.company.name}</b> },
        { key: 'm', label: 'Mark', render: x => <span>{x.m.label}{x.m.date && <span className="muted text-xs"> · {fmtDate(x.m.date)}</span>}</span> },
        { key: 'e', label: 'Entry', right: true, render: x => x.m.perShare != null ? inr(x.h.avg_cost, 2) : x.h.entry_valuation_cr ? `${crore(x.h.entry_valuation_cr)} val.` : '—' },
        { key: 'v', label: 'Mark value', right: true, render: x => x.m.perShare != null ? inr(x.m.perShare, 2) : x.m.value_cr != null ? `${crore(x.m.value_cr)} val.` : '—' },
        { key: 'x', label: 'Multiple', right: true, render: x => x.m.multiple != null ? <b className={x.m.multiple >= 1 ? 'pos' : 'neg'}>{x.m.multiple.toFixed(2)}x</b> : '—' },
        { key: 'g', label: 'CAGR', right: true, render: x => <Delta v={x.m.cagr} /> },
      ]} />
      <p className="muted text-xs mt-2">Per-share marks compare your price with the issue price / market price. Valuation marks compare your entry post-money valuation with the latest round, the IPO market cap (issue price × shares) and today's market cap. Splits and bonus issues after your entry are not adjusted.</p>
    </Card>
  )
}

function PortfolioIO() {
  const { pf, setPf } = usePf()
  const [msg, setMsg] = useState('')
  return (
    <div className="glass panel p-4 flex flex-wrap items-center gap-3 text-sm">
      <span className="ink2">Your portfolio, tracking list and private companies sync to your login (encrypted) and are cached in this browser.</span>
      <button className="btn" onClick={() => exportPf(pf)}>Export</button>
      <label className="btn cursor-pointer">Import<input type="file" accept="application/json" className="hidden"
        onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { setPf(await importPf(f)); setMsg('Imported') } catch (x) { setMsg((x as Error).message) } }} /></label>
      {msg && <span className="muted">{msg}</span>}
    </div>
  )
}

export default function Portfolio() {
  const v = useVault()
  const [tier, setTier] = useState<'all' | 'official' | 'media'>('all')
  const held = new Set(v.portfolio.holdings.map(h => h.company_id))
  const news = v.companies.filter(r => held.has(r.company.company_id))
    .flatMap(r => r.news.map(n => ({ n, r })))
    .filter(x => tier === 'all' || x.n.tier === tier)
    .sort((a, b) => b.n.published_at.localeCompare(a.n.published_at))
  return (
    <div className="space-y-5">
      <PageHead title="Portfolio" sub="Pre-IPO, anchor, listed and private positions — marked to the latest round, the IPO price and the market."
        action={<div className="flex gap-2 flex-wrap"><a className="btn btn-primary" href="#/new-private/">+ Private company</a><a className="btn" href="#/ipos/pipeline">+ From IPO pipeline</a></div>} />
      <ReturnsStrip />
      <Card title="Holdings"><HoldingsTable /></Card>
      <ReturnsChart />
      <MarksTable />
      <Card title="Tracking" solid><TrackingTable /></Card>
      <Card title="Every announcement on my holdings" action={<Seg value={tier} onChange={setTier} options={[{ v: 'all', label: 'All' }, { v: 'official', label: 'Exchange' }, { v: 'media', label: 'Media' }]} />} solid>
        <Table rows={news} empty="No announcements yet" search={x => `${x.r.company.name} ${x.n.title}`} cols={[
          { key: 't', label: 'Time', m: 'key', render: x => fmtDateTime(x.n.published_at), sort: x => x.n.published_at },
          { key: 'h', label: 'Headline', primary: true, render: x => <span><b>{x.r.company.name}</b> — {x.n.url.startsWith('http') ? <a href={x.n.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{x.n.title}</a> : x.n.title}</span> },
          { key: 'cat', label: 'Type', render: x => <Pill tone={x.n.tier === 'official' ? 'blue' : 'slate'}>{x.n.category.replace(/_/g, ' ')}</Pill> },
        ]} />
      </Card>
      <PortfolioIO />
      <p className="muted text-xs">Multiples use the most recent mark. XIRR treats each position's cost as invested on its date and today's marked value as the exit; positions without a later mark are held at cost. Foreign-currency private companies convert at the rate you entered.</p>
    </div>
  )
}
