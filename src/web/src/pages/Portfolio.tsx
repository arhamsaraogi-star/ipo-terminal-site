import { useState } from 'react'
import { useVault, go } from '../App'
import { Card, PageHead, Pill, Seg, Stage, Table } from '../components/ui'
import { byId, issuePrice, nextEvent, nextLockin } from '../lib/derive'
import { daysUntil, fmtDate, fmtDateTime, inr, num, urgency } from '../lib/format'

export function HoldingsTable() {
  const v = useVault()
  const rows = v.portfolio.holdings.map(h => ({ h, r: byId(v, h.company_id)! })).filter(x => x.r)
  return <Table rows={rows} empty="No investments marked yet — open a company and press ★ Add to portfolio"
    onRow={x => go(`/company/${x.r.company.company_id}`)}
    cols={[
      { key: 'c', label: 'Company', render: x => <div><b>{x.r.company.name}</b><div className="muted text-xs">{x.r.company.identifiers.nse_symbol ?? x.r.company.industry}</div></div>, sort: x => x.r.company.name },
      { key: 's', label: 'Stage', render: x => <Stage s={x.r.company.lifecycle} /> },
      { key: 'q', label: 'Qty', right: true, render: x => num(x.h.quantity), sort: x => x.h.quantity },
      { key: 'ac', label: 'Avg cost', right: true, render: x => inr(x.h.avg_cost, 2) },
      { key: 'ip', label: 'Issue price', right: true, render: x => inr(issuePrice(x.r)) },
      { key: 'iv', label: 'Invested', right: true, render: x => inr(x.h.quantity * x.h.avg_cost), sort: x => x.h.quantity * x.h.avg_cost },
      { key: 'lp', label: 'Last price', right: true, render: () => <span className="muted" title="Delayed market prices arrive in Phase 8">—</span> },
      { key: 'ne', label: 'Next event', render: x => { const e = nextEvent(x.r); return e ? <span>{v.event_types[e.event_type]?.label ?? e.event_type} · <b>{fmtDate(e.date, false)}</b></span> : <span className="muted">—</span> } },
      { key: 'nl', label: 'Next unlock', right: true, render: x => { const l = nextLockin(x.r); if (!l) return <span className="muted">—</span>; const d = daysUntil(l.expiry_date); return <Pill tone={urgency(d).tone}>{d}d · {l.pct_post_issue?.value ?? '?'}%</Pill> } },
      { key: 'n', label: 'News', right: true, render: x => x.r.news.length || <span className="muted">0</span>, sort: x => x.r.news.length },
    ]} />
}

export default function Portfolio() {
  const v = useVault()
  const [tier, setTier] = useState<'all' | 'official' | 'media'>('all')
  const held = new Set(v.portfolio.holdings.map(h => h.company_id))
  const news = v.companies.filter(r => held.has(r.company.company_id))
    .flatMap(r => r.news.map(n => ({ n, r })))
    .filter(x => tier === 'all' || x.n.tier === tier)
    .sort((a, b) => b.n.published_at.localeCompare(a.n.published_at))
  const watch = v.portfolio.watchlist.map(id => byId(v, id)).filter(Boolean)
  return (
    <div className="space-y-5">
      <PageHead title="Portfolio" sub="IPOs you have invested in. Every exchange announcement and news item on these companies is tracked." />
      <Card title="Holdings"><HoldingsTable /></Card>
      <Card title="Every news item on my holdings" action={<Seg value={tier} onChange={setTier} options={[{ v: 'all', label: 'All' }, { v: 'official', label: 'Exchange filings' }, { v: 'media', label: 'Media' }]} />} solid>
        <Table rows={news} empty="No news yet" cols={[
          { key: 't', label: 'Time', render: x => fmtDateTime(x.n.published_at), sort: x => x.n.published_at },
          { key: 'c', label: 'Company', render: x => x.r.company.name },
          { key: 'cat', label: 'Type', render: x => <Pill tone={x.n.tier === 'official' ? 'blue' : 'slate'}>{x.n.category.replace(/_/g, ' ')}</Pill> },
          { key: 'h', label: 'Headline', render: x => x.n.url.startsWith('http') ? <a href={x.n.url} target="_blank" rel="noreferrer">{x.n.title}</a> : x.n.title },
          { key: 'p', label: 'Source', render: x => x.n.publisher ?? '—' },
        ]} />
      </Card>
      <Card title="Watchlist" solid>
        <Table rows={watch} onRow={r => go(`/company/${r!.company.company_id}`)} empty="Nothing on the watchlist" cols={[
          { key: 'c', label: 'Company', render: r => <b>{r!.company.name}</b> },
          { key: 's', label: 'Stage', render: r => <Stage s={r!.company.lifecycle} /> },
          { key: 'e', label: 'Next event', render: r => { const e = nextEvent(r!); return e ? `${v.event_types[e.event_type]?.label} · ${fmtDate(e.date, false)}` : '—' } },
        ]} />
      </Card>
      {v.meta.repo
        ? <p className="muted text-sm">Holdings are edited through GitHub issues on {v.meta.repo} (button on each company page) so the news pipeline knows what to track.</p>
        : <p className="muted text-sm">Set <code>repo</code> in config/vault.json (or deploy via GitHub Actions) to enable the ★ Add to portfolio buttons.</p>}
    </div>
  )
}
