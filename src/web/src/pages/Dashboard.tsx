import { useVault, go } from '../App'
import { SinceLastVisit } from '../components/Insights'
import { Card, Delta, Kpi, Pill, Stage, Table } from '../components/ui'
import { isLiveDrhp, allLockins, cmp, eventDate, ipo, issuePrice, issueSize, listedOn, listingGainPct, priceBand, returnVsIssuePct, upcomingEvents, inScope, isHeld } from '../lib/derive'
import { crore, daysUntil, fmtDate, fmtDateTime, inr, pct, urgency } from '../lib/format'
import { HoldingsTable, ReturnsStrip, TrackingTable } from './Portfolio'
import { brlms, dealSize, filedOn } from './AnchorDesk'

export default function Dashboard() {
  const v = useVault()
  const live = v.companies.filter(r => ['ISSUE_OPEN', 'ISSUE_ANNOUNCED'].includes(r.company.lifecycle))
  const opens14 = upcomingEvents(v, 14, ['ISSUE_OPEN', 'LISTING', 'ANCHOR_BIDDING', 'BASIS_OF_ALLOTMENT'])
  const listed90 = v.companies.filter(r => { const d = listedOn(r); return d && daysUntil(d) <= 0 && daysUntil(d) >= -90 })
  const unlocks = allLockins(v).filter(x => x.d >= 0 && x.d <= 30)
  const unlockPct = unlocks.reduce((s, x) => s + (Number(x.l.pct_post_issue?.value) || 0), 0)
  const gains = listed90.map(listingGainPct).filter((g): g is number => g != null)
  const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : null
  const pipeline = v.companies.filter(r => ['DRHP_FILED', 'SEBI_OBSERVED', 'RHP_FILED'].includes(r.company.lifecycle))

  const has = v.portfolio.holdings.length > 0
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow">{fmtDate(new Date().toISOString())}</div>
          <h1 className="display text-[34px] font-bold leading-tight">Good {greeting()}</h1>
        </div>
        <div className="flex gap-2 flex-wrap"><a className="btn btn-primary" href="#/executive">🖨 The Executive Print</a><a className="btn" href="#/new-private/">+ Private company</a><a className="btn btn-primary" href="#/portfolio">Portfolio →</a></div>
      </div>

      <SinceLastVisit />
      {has ? (
        <section className="space-y-4">
          <ReturnsStrip />
          <Card title="My investments" action={<a className="btn" href="#/portfolio">Details →</a>}><HoldingsTable /></Card>
        </section>
      ) : (
        <div className="glass panel p-6 flex flex-wrap items-center justify-between gap-4">
          <div><div className="display text-[22px] font-semibold">Your portfolio lives here</div>
            <p className="muted text-sm mt-1">Add a pre-IPO, anchor or listed position from any company page, or add any private company in the world.</p></div>
          <div className="flex gap-2"><a className="btn btn-primary" href="#/new-private/">+ Private company</a><a className="btn" href="#/ipos/pipeline">Browse pipeline</a></div>
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-5">
        <NewFilings />
        <IpoNews />
      </div>

      {!!v.portfolio.tracking.length && <Card title="Tracking" action={<a className="btn" href="#/portfolio">All →</a>} solid><TrackingTable limit={8} /></Card>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Live & announced issues" value={live.length} sub={`${opens14.filter(x => x.e.event_type === 'ISSUE_OPEN').length} opening in 14 days`} />
        <Kpi label="Live DRHP pipeline" value={pipeline.length} sub="filed / approved / RHP" />
        <Kpi label="Listed · last 90 days" value={listed90.length} sub={avgGain != null ? <>avg listing gain <Delta v={avgGain} /></> : 'Mainboard + SME'} />
        <Kpi label="Unlocks · next 30 days" value={unlocks.length} tone={unlocks.some(x => x.d < 7) ? 'neg' : ''}
          sub={unlocks.length ? (unlockPct > 0 ? `${pct(unlockPct)} of shares outstanding, combined` : `${new Set(unlocks.map(x => x.r.company.company_id)).size} companies`) : 'None'} />
      </div>

      <OpenNow />
      <RecentListings />

      <div className="grid xl:grid-cols-2 gap-5">
        <Card title="Next 14 days" solid>
          <Table rows={opens14.slice(0, 10)} empty="No scheduled IPO milestones in the next 14 days"
            onRow={x => go(`/company/${x.r.company.company_id}`)}
            cols={[
              { key: 'd', label: 'Date', m: 'key', render: x => <b>{fmtDate(x.e.date, false)}</b>, sort: x => x.e.date },
              { key: 'c', label: 'Company', primary: true, render: x => x.r.company.name },
              { key: 'e', label: 'Milestone', render: x => v.event_types[x.e.event_type]?.label ?? x.e.event_type },
              { key: 'in', label: 'In', hideMobile: true, right: true, render: x => x.d === 0 ? <Pill tone="green">Today</Pill> : `${x.d}d` },
            ]} />
        </Card>
        <Card title="Lock-ins ending soon" action={<a className="btn" href="#/lockins">Calendar →</a>} solid>
          <Table rows={allLockins(v).filter(x => x.d >= 0).slice(0, 6)} empty="No upcoming lock-in expiries"
            onRow={x => go(`/company/${x.r.company.company_id}`)}
            cols={[
              { key: 'd', label: 'Expiry', m: 'key', render: x => <b>{fmtDate(x.l.expiry_date, false)}</b> },
              { key: 'c', label: 'Company', primary: true, render: x => x.r.company.name },
              { key: 'h', label: 'Holder', hideMobile: true, render: x => holder(x.l.holder_category) },
              { key: 'p', label: '% equity', right: true, render: x => pct(Number(x.l.pct_post_issue?.value)) },
              { key: 'u', label: '', right: true, render: x => { const u = urgency(x.d); return <Pill tone={u.tone}>{x.d}d</Pill> } },
            ]} />
        </Card>
      </div>

    </div>
  )
}

export const holder = (c: string) => ({
  ANCHOR: 'Anchor investors', PROMOTER_MIN_CONTRIBUTION: 'Promoters (min. contribution)', PROMOTER_EXCESS: 'Promoters (excess)',
  PRE_IPO_NON_PROMOTER: 'Pre-IPO shareholders', OTHER: 'Other',
} as Record<string, string>)[c] ?? c

function greeting() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening' }

function OpenNow() {
  const v = useVault()
  const rows = v.companies.filter(r => ['ISSUE_OPEN', 'ISSUE_ANNOUNCED', 'ISSUE_CLOSED'].includes(r.company.lifecycle)
    && !/withdrawn|postponed/i.test(r.company.name) && (eventDate(r, 'ISSUE_CLOSE') ?? '9999') >= new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10))
    .sort((a, b) => (eventDate(a, 'ISSUE_OPEN') ?? '').localeCompare(eventDate(b, 'ISSUE_OPEN') ?? ''))
  if (!rows.length) return null
  return (
    <Card title="Open, upcoming and awaiting listing" action={<a className="btn" href="#/ipos/upcoming">All upcoming →</a>} solid>
      <Table rows={rows} onRow={r => go(`/company/${r.company.company_id}`)} cols={[
        { key: 'c', label: 'Company', render: r => <div><b>{r.company.name}</b><div className="muted text-xs">{r.company.segment === 'SME' ? 'SME' : 'Mainboard'}{r.company.identifiers.nse_symbol ? ` · ${r.company.identifiers.nse_symbol}` : ''}</div></div> },
        { key: 's', label: 'Stage', hideMobile: true, render: r => <Stage s={r.company.lifecycle} /> },
        { key: 'pb', label: 'Price band', hideMobile: true, right: true, render: r => priceBand(r) },
        { key: 'sz', label: 'Issue size', hideMobile: true, right: true, render: r => crore(issueSize(r)) },
        { key: 'o', label: 'Open → close', right: true, render: r => `${fmtDate(eventDate(r, 'ISSUE_OPEN'), false)} → ${fmtDate(eventDate(r, 'ISSUE_CLOSE'), false)}` },
        { key: 'sub', label: 'Subscribed', hideMobile: true, right: true, render: r => { const x = ipo(r)?.subscription?.total_times; return x == null ? '—' : <b>{x.toFixed(1)}x</b> } },
        { key: 'l', label: 'Listing', right: true, render: r => fmtDate(r.events.find(e => e.event_type === 'LISTING')?.date, false) },
      ]} />
    </Card>
  )
}

function IpoNews() {
  const v = useVault()
  const items = v.companies.filter(r => inScope(r) || isHeld(v, r.company.company_id)).flatMap(r => r.news.map(n => ({ n, r })))
    .sort((a, b) => b.n.published_at.localeCompare(a.n.published_at)).slice(0, 9)
  return (
    <Card title="Latest IPO news" action={<a className="btn" href="#/activity/news">All →</a>} solid>
      <ul className="space-y-3">
        {items.map(({ n, r }) => (
          <li key={n.news_id} className="min-w-0">
            <div className="flex gap-2 items-center text-xs muted mb-0.5 flex-wrap">
              <Pill tone={n.tier === 'official' ? 'blue' : 'slate'}>{n.tier === 'official' ? n.publisher ?? 'Exchange' : n.publisher ?? 'Media'}</Pill>
              <a href={`#/company/${r.company.company_id}`} className="font-semibold no-underline" style={{ color: 'var(--ink-2)' }}>{r.company.name}</a> · {fmtDateTime(n.published_at)}
            </div>
            <a href={n.url.startsWith('http') ? n.url : `#/company/${r.company.company_id}`} target={n.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="font-medium no-underline line-clamp-2" style={{ color: 'var(--ink)' }}>{n.title}</a>
          </li>
        ))}
        {!items.length && <li className="muted">No announcements yet</li>}
      </ul>
    </Card>
  )
}

function NewFilings() {
  const v = useVault()
  const rows = v.companies.filter(r => { const d = filedOn(r); return d && -daysUntil(d) <= 14 && isLiveDrhp(r) }).sort((a, b) => filedOn(b)!.localeCompare(filedOn(a)!)).slice(0, 8)
  return (
    <Card title="New filings · last 14 days" action={<a className="btn btn-primary" href="#/anchor">Anchor Desk →</a>} solid>
      <Table rows={rows} onRow={r => go(`/company/${r.company.company_id}`)} empty="No new DRHPs in the last 14 days" cols={[
        { key: 'f', label: 'Filed', m: 'key', render: r => { const n = -daysUntil(filedOn(r)!); return n === 0 ? <Pill tone="green">Today</Pill> : `${n}d ago` } },
        { key: 'c', label: 'Company', primary: true, render: r => <div><b>{r.company.name}</b><div className="muted text-xs">{r.company.segment === 'SME' ? 'SME' : 'Mainboard'}</div></div> },
        { key: 's', label: 'Size', right: true, render: r => dealSize(r).text },
        { key: 'b', label: 'Lead managers', hideMobile: true, render: r => brlms(r).map(b => b.name.replace(/ (Private )?Limited$/i, '')).join(', ') || <span className="muted">reading cover…</span> },
      ]} />
    </Card>
  )
}

function RecentListings() {
  const v = useVault()
  const rows = v.companies.filter(r => { const d = listedOn(r); return d && daysUntil(d) <= 0 && daysUntil(d) >= -30 })
    .sort((a, b) => (listedOn(b) ?? '').localeCompare(listedOn(a) ?? '')).slice(0, 8)
  if (!rows.length) return null
  return (
    <Card title="Latest listings" action={<a className="btn" href="#/listed">All listings →</a>} solid>
      <Table rows={rows} onRow={r => go(`/company/${r.company.company_id}`)} cols={[
        { key: 'c', label: 'Company', render: r => <div><b>{r.company.name}</b><div className="muted text-xs">{r.company.segment === 'SME' ? 'SME' : 'Mainboard'} · {fmtDate(listedOn(r), false)}</div></div> },
        { key: 'ip', label: 'Issue', hideMobile: true, right: true, render: r => inr(issuePrice(r)) },
        { key: 'lg', label: 'Listing gain', right: true, render: r => <Delta v={listingGainPct(r)} /> },
        { key: 'p', label: 'Price', right: true, render: r => inr(cmp(r), 2) },
        { key: 'ret', label: 'vs issue', right: true, render: r => <Delta v={returnVsIssuePct(r)} /> },
      ]} />
    </Card>
  )
}
