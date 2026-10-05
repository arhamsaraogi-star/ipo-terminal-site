import { useState } from 'react'
import { useVault, go } from '../App'
import { Card, PageHead, Pill, Seg, SourceLine, Stage, Table } from '../components/ui'
import { byId, isHeld } from '../lib/derive'
import { daysUntil, fmtDate, fmtDateTime } from '../lib/format'

export function Changes() {
  const v = useVault()
  return (
    <div>
      <PageHead title="Recent Changes" sub="Every revision to previously known information, detected run-by-run." />
      <Card solid>
        <Table rows={v.changes} onRow={c => go(`/company/${c.company_id}`)} cols={[
          { key: 'd', label: 'Detected', render: c => fmtDateTime(c.detected_at), sort: c => c.detected_at },
          { key: 'c', label: 'Company', render: c => <b>{byId(v, c.company_id)?.company.name ?? c.company_id}</b> },
          { key: 'l', label: 'Change', render: c => c.label ?? c.field },
          { key: 'o', label: 'From', render: c => <s className="muted">{c.old == null ? '—' : String(c.old)}</s> },
          { key: 'n', label: 'To', render: c => <b>{String(c.new)}</b> },
          { key: 's', label: 'Source', render: c => <SourceLine s={c.source} /> },
        ]} />
      </Card>
    </div>
  )
}

export function Filings() {
  const v = useVault()
  const rows = v.companies.flatMap(r => r.events.filter(e => ['DRHP_FILED', 'UDRHP_FILED', 'RHP_FILED', 'SEBI_OBSERVATION'].includes(e.event_type) && daysUntil(e.date) >= -120).map(e => ({ r, e })))
    .sort((a, b) => b.e.date.localeCompare(a.e.date))
  return (
    <div>
      <PageHead title="New Filings" sub="Offer documents and SEBI actions in the last 120 days." />
      <Card solid>
        <Table rows={rows} onRow={x => go(`/company/${x.r.company.company_id}`)} cols={[
          { key: 'd', label: 'Date', render: x => <b>{fmtDate(x.e.date)}</b>, sort: x => x.e.date },
          { key: 't', label: 'Filing', render: x => <Pill tone="violet">{v.event_types[x.e.event_type]?.label}</Pill> },
          { key: 'c', label: 'Company', render: x => x.r.company.name },
          { key: 's', label: 'Current stage', render: x => <Stage s={x.r.company.lifecycle} /> },
          { key: 'seg', label: 'Segment', render: x => x.r.company.segment },
          { key: 'src', label: 'Source', render: x => <SourceLine s={x.e.source} /> },
        ]} />
      </Card>
    </div>
  )
}

export function NewsPage() {
  const v = useVault()
  const [scope, setScope] = useState<'holdings' | 'watch' | 'all'>('holdings')
  const rows = v.companies.filter(r => scope === 'all' || (scope === 'holdings' ? isHeld(v, r.company.company_id) : v.portfolio.watchlist.includes(r.company.company_id)))
    .flatMap(r => r.news.map(n => ({ r, n }))).sort((a, b) => b.n.published_at.localeCompare(a.n.published_at))
  return (
    <div>
      <PageHead title="News" sub="Exchange announcements (official) and media coverage, de-duplicated." />
      <Card solid action={<Seg value={scope} onChange={setScope} options={[{ v: 'holdings', label: 'My holdings' }, { v: 'watch', label: 'Watchlist' }, { v: 'all', label: 'All companies' }]} />} title={`${rows.length} items`}>
        <Table rows={rows} cols={[
          { key: 't', label: 'Time', render: x => fmtDateTime(x.n.published_at), sort: x => x.n.published_at },
          { key: 'c', label: 'Company', render: x => <a href={`#/company/${x.r.company.company_id}`}>{x.r.company.name}</a> },
          { key: 'k', label: 'Type', render: x => <Pill tone={x.n.tier === 'official' ? 'blue' : 'slate'}>{x.n.category.replace(/_/g, ' ')}</Pill> },
          { key: 'h', label: 'Headline', render: x => x.n.url.startsWith('http') ? <a href={x.n.url} target="_blank" rel="noreferrer">{x.n.title}</a> : x.n.title },
          { key: 'p', label: 'Source', render: x => x.n.publisher ?? '—' },
        ]} />
      </Card>
    </div>
  )
}

export function Review() {
  const v = useVault()
  return (
    <div>
      <PageHead title="Needs Review" sub="Validation warnings. Nothing here is silently corrected." />
      <Card solid>
        {!!v.meta.ingest?.failures.length && <div className="mb-4"><div className="eyebrow mb-1">Source issues in the last pull</div>
          <ul className="space-y-1">{v.meta.ingest.failures.map((f, i) => <li key={i}><code className="text-sm warn">{f}</code></li>)}</ul></div>}
        {v.meta.ingest && <div className="mb-4"><div className="eyebrow mb-1">Last pull · {fmtDateTime(v.meta.ingest.ran_at)}</div>
          <ul className="space-y-1">{v.meta.ingest.log.map((f, i) => <li key={i} className="text-sm ink2">{f}</li>)}</ul></div>}
        {v.review.length ? <ul className="space-y-2">{v.review.map((w, i) => <li key={i} className="flex gap-2"><span className="warn">⚠</span><code className="text-sm">{w}</code></li>)}</ul>
          : <p className="muted">All checks passed in the latest build.</p>}
      </Card>
    </div>
  )
}
