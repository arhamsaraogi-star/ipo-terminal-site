import { useVault, go } from '../App'
import { Card, Kpi, Pill, Stage, Table } from '../components/ui'
import { allLockins, byId, eventDate, issueSize, priceBand, upcomingEvents } from '../lib/derive'
import { crore, daysUntil, fmtDate, fmtDateTime, pct, urgency } from '../lib/format'
import { HoldingsTable } from './Portfolio'
import type { CompanyRecord } from '../lib/types'

export default function Dashboard() {
  const v = useVault()
  const live = v.companies.filter(r => ['ISSUE_OPEN', 'ISSUE_ANNOUNCED'].includes(r.company.lifecycle))
  const opens14 = upcomingEvents(v, 14, ['ISSUE_OPEN', 'LISTING', 'ANCHOR_BIDDING', 'BASIS_OF_ALLOTMENT'])
  const listed90 = v.companies.filter(r => { const d = eventDate(r, 'LISTING'); return d && daysUntil(d) <= 0 && daysUntil(d) >= -90 })
  const unlocks = allLockins(v).filter(x => x.d >= 0 && x.d <= 30)
  const unlockPct = unlocks.reduce((s, x) => s + (Number(x.l.pct_post_issue?.value) || 0), 0)
  const pipeline = v.companies.filter(r => ['DRHP_FILED', 'SEBI_OBSERVED', 'RHP_FILED'].includes(r.company.lifecycle))
  const heldNews = v.companies.filter(r => v.portfolio.holdings.some(h => h.company_id === r.company.company_id))
    .flatMap(r => r.news.map(n => ({ n, r }))).sort((a, b) => b.n.published_at.localeCompare(a.n.published_at)).slice(0, 5)

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow">{fmtDate(new Date().toISOString())}</div>
          <h1 className="display text-[34px] font-bold leading-tight">Good {greeting()}</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Live & announced issues" value={live.length} sub={`${opens14.filter(x => x.e.event_type === 'ISSUE_OPEN').length} opening in 14 days`} />
        <Kpi label="In SEBI pipeline" value={pipeline.length} sub="DRHP / observed / RHP" />
        <Kpi label="Listed · last 90 days" value={listed90.length} sub="Mainboard + SME" />
        <Kpi label="Unlocks · next 30 days" value={unlocks.length} tone={unlocks.some(x => x.d < 7) ? 'neg' : ''}
          sub={unlocks.length ? `${pct(unlockPct)} of post-issue equity, combined` : 'None'} />
      </div>

      <Card title="My IPO investments" action={<a className="btn" href="#/portfolio">Open portfolio →</a>}>
        <HoldingsTable />
      </Card>

      <div className="grid xl:grid-cols-2 gap-5">
        <Card title="Next 14 days" solid>
          <Table rows={opens14} empty="No scheduled IPO milestones in the next 14 days"
            onRow={x => go(`/company/${x.r.company.company_id}`)}
            cols={[
              { key: 'd', label: 'Date', render: x => <b>{fmtDate(x.e.date, false)}</b>, sort: x => x.e.date },
              { key: 'c', label: 'Company', render: x => x.r.company.name },
              { key: 'e', label: 'Milestone', render: x => v.event_types[x.e.event_type]?.label ?? x.e.event_type },
              { key: 'in', label: 'In', right: true, render: x => x.d === 0 ? <Pill tone="green">Today</Pill> : `${x.d}d` },
            ]} />
        </Card>
        <Card title="Lock-ins ending soon" action={<a className="btn" href="#/lockins">Calendar →</a>} solid>
          <Table rows={allLockins(v).filter(x => x.d >= 0).slice(0, 6)} empty="No upcoming lock-in expiries"
            onRow={x => go(`/company/${x.r.company.company_id}`)}
            cols={[
              { key: 'd', label: 'Expiry', render: x => <b>{fmtDate(x.l.expiry_date, false)}</b> },
              { key: 'c', label: 'Company', render: x => x.r.company.name },
              { key: 'h', label: 'Holder', render: x => holder(x.l.holder_category) },
              { key: 'p', label: '% equity', right: true, render: x => pct(Number(x.l.pct_post_issue?.value)) },
              { key: 'u', label: '', right: true, render: x => { const u = urgency(x.d); return <Pill tone={u.tone}>{x.d}d</Pill> } },
            ]} />
        </Card>
      </div>

      <div className="grid xl:grid-cols-2 gap-5">
        <Card title="Recent changes" action={<a className="btn" href="#/changes">All →</a>} solid>
          <ul className="space-y-3">
            {v.changes.slice(0, 6).map(c => (
              <li key={c.change_id} className="flex gap-3 items-start">
                <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
                <div className="min-w-0">
                  <a href={`#/company/${c.company_id}`} className="font-semibold no-underline" style={{ color: 'var(--ink)' }}>{byId(v, c.company_id)?.company.name ?? c.company_id}</a>
                  <div className="ink2 text-[15px]">{c.label ?? c.field}{c.old != null && <>: <s className="muted">{String(c.old)}</s> → <b>{String(c.new)}</b></>}</div>
                  <div className="muted text-xs">{fmtDateTime(c.detected_at)}</div>
                </div>
              </li>
            ))}
            {!v.changes.length && <li className="muted">No changes detected yet</li>}
          </ul>
        </Card>
        <Card title="News on my holdings" action={<a className="btn" href="#/news">All news →</a>} solid>
          <ul className="space-y-3">
            {heldNews.map(({ n, r }) => (
              <li key={n.news_id}>
                <div className="flex gap-2 items-center text-xs muted mb-0.5">
                  <Pill tone={n.tier === 'official' ? 'blue' : 'slate'}>{n.tier === 'official' ? n.publisher ?? 'Exchange' : n.publisher ?? 'Media'}</Pill>
                  {r.company.name} · {fmtDateTime(n.published_at)}
                </div>
                <a href={n.url.startsWith('http') ? n.url : undefined} target="_blank" rel="noreferrer" className="font-medium no-underline" style={{ color: 'var(--ink)' }}>{n.title}</a>
              </li>
            ))}
            {!heldNews.length && <li className="muted">No news on holdings yet</li>}
          </ul>
        </Card>
      </div>

      <Card title="Pipeline snapshot" action={<a className="btn" href="#/pipeline">Full pipeline →</a>} solid>
        <PipelineMini rows={v.companies.filter(r => r.company.lifecycle !== 'LISTED' && r.company.lifecycle !== 'PRIVATE')} />
      </Card>
    </div>
  )
}

function PipelineMini({ rows }: { rows: CompanyRecord[] }) {
  return <Table rows={rows} onRow={r => go(`/company/${r.company.company_id}`)} cols={[
    { key: 'c', label: 'Company', render: r => <b>{r.company.name}</b>, sort: r => r.company.name },
    { key: 's', label: 'Stage', render: r => <Stage s={r.company.lifecycle} /> },
    { key: 'sz', label: 'Issue size', right: true, render: r => crore(issueSize(r)), sort: r => issueSize(r) },
    { key: 'pb', label: 'Price band', right: true, render: r => priceBand(r) },
    { key: 'o', label: 'Opens', right: true, render: r => fmtDate(eventDate(r, 'ISSUE_OPEN'), false), sort: r => eventDate(r, 'ISSUE_OPEN') },
  ]} />
}

export const holder = (c: string) => ({
  ANCHOR: 'Anchor investors', PROMOTER_MIN_CONTRIBUTION: 'Promoters (min. contribution)', PROMOTER_EXCESS: 'Promoters (excess)',
  PRE_IPO_NON_PROMOTER: 'Pre-IPO shareholders', OTHER: 'Other',
} as Record<string, string>)[c] ?? c

function greeting() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening' }
