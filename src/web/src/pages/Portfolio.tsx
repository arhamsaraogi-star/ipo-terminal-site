import { useState } from 'react'
import { usePf, useVault, go } from '../App'
import { Card, Delta, Kpi, PageHead, Pill, Seg, Stage, Table } from '../components/ui'
import { byId, cmp, holdingMarks, issuePrice, nextEvent, nextLockin } from '../lib/derive'
import { crore, daysUntil, fmtDate, fmtDateTime, inr, urgency } from '../lib/format'
import { exportPf, importPf } from '../lib/portfolio'
import type { CompanyRecord, Holding } from '../lib/types'

const ROUTE: Record<string, string> = { PRE_IPO: 'Pre-IPO', ANCHOR: 'Anchor', ALLOTMENT: 'IPO allotment', MARKET: 'Market' }

export function positionValue(r: CompanyRecord, h: Holding) {
  const { cost_cr, marks } = holdingMarks(r, h)
  const best = marks.length ? marks[marks.length - 1] : null           // most recent mark (CMP > issue > round)
  const value_cr = best?.multiple != null && cost_cr != null ? cost_cr * best.multiple : null
  return { cost_cr, value_cr, best, marks }
}

export function HoldingsTable() {
  const v = useVault()
  const rows = v.portfolio.holdings.map(h => ({ h, r: byId(v, h.company_id)! })).filter(x => x.r).map(x => ({ ...x, ...positionValue(x.r, x.h) }))
  return <Table rows={rows} empty="No investments yet — open any company and press ★ Add to portfolio (pre-IPO, anchor, allotment or market)."
    onRow={x => go(`/company/${x.r.company.company_id}`)} initialSort={{ key: 'val', dir: -1 }}
    cols={[
      { key: 'c', label: 'Company', sort: x => x.r.company.name, render: x => <div><b>{x.r.company.name}</b><div className="muted text-xs">{ROUTE[x.h.route] ?? x.h.route} · since {fmtDate(x.h.acquired_on)}</div></div> },
      { key: 's', label: 'Stage', render: x => <Stage s={x.r.company.lifecycle} /> },
      { key: 'cost', label: 'Cost', right: true, render: x => crore(x.cost_cr, 2), sort: x => x.cost_cr },
      { key: 'mark', label: 'Latest mark', right: true, render: x => x.best ? <span>{x.best.perShare != null ? inr(x.best.perShare, 2) : crore(x.best.value_cr)}<div className="muted text-xs">{x.best.label}</div></span> : <span className="muted">no mark yet</span> },
      { key: 'val', label: 'Value', right: true, render: x => crore(x.value_cr, 2), sort: x => x.value_cr },
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
      <span className="ink2">Holdings and watchlist are stored privately in this browser — never on GitHub.</span>
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
  const pos = v.portfolio.holdings.map(h => ({ h, r: byId(v, h.company_id) })).filter(x => x.r).map(x => positionValue(x.r!, x.h))
  const cost = pos.reduce((s, p) => s + (p.cost_cr ?? 0), 0)
  const value = pos.reduce((s, p) => s + (p.value_cr ?? p.cost_cr ?? 0), 0)
  const news = v.companies.filter(r => held.has(r.company.company_id))
    .flatMap(r => r.news.map(n => ({ n, r })))
    .filter(x => tier === 'all' || x.n.tier === tier)
    .sort((a, b) => b.n.published_at.localeCompare(a.n.published_at))
  const watch = v.portfolio.watchlist.map(id => byId(v, id)).filter(Boolean) as CompanyRecord[]
  return (
    <div className="space-y-5">
      <PageHead title="Portfolio" sub="Pre-IPO, anchor and listed positions — marked to the latest private round, the IPO price and the market." action={<a className="btn btn-primary" href="#/pipeline">+ Add from pipeline</a>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Positions" value={pos.length} sub={`${v.portfolio.watchlist.length} on watchlist`} />
        <Kpi label="Cost" value={crore(cost, 1)} />
        <Kpi label="Marked value" value={crore(value, 1)} />
        <Kpi label="Gain" value={<Delta v={cost ? (value / cost - 1) * 100 : null} />} sub={cost ? `${crore(value - cost, 1)}` : undefined} />
      </div>
      <Card title="Holdings"><HoldingsTable /></Card>
      <MarksTable />
      <Card title="Every announcement on my holdings" action={<Seg value={tier} onChange={setTier} options={[{ v: 'all', label: 'All' }, { v: 'official', label: 'Exchange' }, { v: 'media', label: 'Media' }]} />} solid>
        <Table rows={news} empty="No announcements yet" search={x => `${x.r.company.name} ${x.n.title}`} cols={[
          { key: 't', label: 'Time', render: x => fmtDateTime(x.n.published_at), sort: x => x.n.published_at },
          { key: 'h', label: 'Headline', primary: true, render: x => <span><b>{x.r.company.name}</b> — {x.n.url.startsWith('http') ? <a href={x.n.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{x.n.title}</a> : x.n.title}</span> },
          { key: 'cat', label: 'Type', render: x => <Pill tone={x.n.tier === 'official' ? 'blue' : 'slate'}>{x.n.category.replace(/_/g, ' ')}</Pill> },
        ]} />
      </Card>
      <Card title="Watchlist" solid>
        <Table rows={watch} onRow={r => go(`/company/${r.company.company_id}`)} empty="Nothing on the watchlist" cols={[
          { key: 'c', label: 'Company', render: r => <b>{r.company.name}</b> },
          { key: 's', label: 'Stage', render: r => <Stage s={r.company.lifecycle} /> },
          { key: 'p', label: 'Price', right: true, render: r => cmp(r) ? inr(cmp(r), 2) : issuePrice(r) ? `${inr(issuePrice(r))} issue` : '—' },
          { key: 'e', label: 'Next event', render: r => { const e = nextEvent(r); return e ? `${v.event_types[e.event_type]?.label} · ${fmtDate(e.date, false)}` : '—' } },
        ]} />
      </Card>
      <PortfolioIO />
      <p className="muted text-xs">Multiples use the most recent available mark. CAGR is annualised from your investment date.</p>
    </div>
  )
}
