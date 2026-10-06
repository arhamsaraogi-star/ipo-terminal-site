import { useState } from 'react'
import { go, useVault } from '../App'
import { Card, Kpi, PageHead, Pill, Seg, Stage, Table } from '../components/ui'
import { byId, cmp, isMine, issuePrice, nextEvent } from '../lib/derive'
import { daysUntil, fmtDate, fmtDateTime, inr } from '../lib/format'
import { TRACK, intelKey } from '../lib/portfolio'
import type { CompanyRecord } from '../lib/types'

/** Everything you care about in one place: portfolio + tracking list — status, next milestones and every headline (no time limit). */
export default function Tracked() {
  const v = useVault()
  const [filter, setFilter] = useState<'all' | 'held' | 'tracking'>('all')
  const held = new Set(v.portfolio.holdings.map(h => h.company_id))
  const track = new Map(v.portfolio.tracking.map(t => [t.company_id, t]))
  const ids = [...new Set([...held, ...track.keys()])].filter(id => filter === 'all' || (filter === 'held' ? held.has(id) : track.has(id)))
  const rows = ids.map(id => byId(v, id)).filter(Boolean) as CompanyRecord[]
  const mine = rows.filter(r => isMine(v, r.company.company_id))
  const events = mine.flatMap(r => r.events.filter(e => { const d = daysUntil(e.date); return d >= 0 && d <= 90 }).map(e => ({ r, e })))
    .sort((a, b) => a.e.date.localeCompare(b.e.date))
  const news = mine.flatMap(r => [
    ...r.news.map(n => ({ r, t: n.published_at, title: n.title, url: n.url, src: n.tier === 'official' ? (n.publisher ?? 'Exchange') : (n.publisher ?? 'Media'), off: n.tier === 'official' })),
    ...(v.private_intel?.[intelKey(r.company.name)]?.news ?? []).map(n => ({ r, t: n.published_at ?? '', title: n.title, url: n.url, src: n.publisher ?? 'Web', off: false })),
  ]).sort((a, b) => (b.t ?? '').localeCompare(a.t ?? ''))
  const seen = new Set<string>()
  const newsU = news.filter(n => { const k = n.title.toLowerCase().slice(0, 70); if (seen.has(k)) return false; seen.add(k); return true })
  const counts = Object.fromEntries(Object.keys(TRACK).map(k => [k, v.portfolio.tracking.filter(t => t.status === k).length]))
  return (
    <div className="space-y-5">
      <PageHead title="Tracked" sub="Your portfolio and tracking list: status, what's next and every headline — no time limit."
        action={<Seg value={filter} onChange={setFilter} options={[{ v: 'all', label: 'All' }, { v: 'held', label: 'Portfolio' }, { v: 'tracking', label: 'Tracking' }]} />} />
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <Kpi label="In portfolio" value={held.size} />
        <Kpi label="Interested" value={counts.INTERESTED ?? 0} />
        <Kpi label="Evaluating" value={counts.EVALUATING ?? 0} />
        <Kpi label="In talks with BRLM" value={counts.IN_TALKS ?? 0} />
        <Kpi label="Committed" value={counts.COMMITTED ?? 0} sub={counts.PASSED ? `${counts.PASSED} passed` : undefined} />
      </div>
      <Card title={`${rows.length} companies`} solid>
        <Table rows={rows} empty="Nothing here yet — press ◎ Track or ★ Add to portfolio on any company, or add a private company."
          onRow={r => go(`/company/${r.company.company_id}`)} cols={[
            { key: 'c', label: 'Company', sort: r => r.company.name, render: r => { const t = track.get(r.company.company_id)
              return <div><b>{r.company.name}</b>{t?.note && <div className="muted text-xs line-clamp-1">{t.note}</div>}</div> } },
            { key: 's', label: 'Status', render: r => { const t = track.get(r.company.company_id)
              return <span className="flex gap-1 flex-wrap">{held.has(r.company.company_id) && <Pill tone="amber">★ Portfolio</Pill>}{t && <Pill tone={TRACK[t.status].tone}>{TRACK[t.status].label}</Pill>}</span> } },
            { key: 'st', label: 'Stage', render: r => r.custom ? <Pill tone="violet">Private</Pill> : <Stage s={r.company.lifecycle} /> },
            { key: 'n', label: 'Next', render: r => { const e = nextEvent(r); return e ? <span className="text-sm">{v.event_types[e.event_type]?.label ?? e.event_type} · <b>{fmtDate(e.date, false)}</b></span> : <span className="muted">—</span> }, sort: r => nextEvent(r)?.date ?? null },
            { key: 'p', label: 'Price', right: true, hideMobile: true, render: r => cmp(r) ? inr(cmp(r), 2) : issuePrice(r) ? `${inr(issuePrice(r))} issue` : '—' },
          ]} />
      </Card>
      <div className="grid xl:grid-cols-2 gap-5">
        <Card title="Next 90 days" action={<a className="btn" href="#/calendar">Calendar →</a>} solid>
          <Table rows={events} empty="No dated milestones in the next 90 days" onRow={x => go(`/company/${x.r.company.company_id}`)} pageSize={12} cols={[
            { key: 'd', label: 'Date', m: 'key', render: x => <b>{fmtDate(x.e.date, false)}</b> },
            { key: 'c', label: 'Company', primary: true, render: x => x.r.company.name },
            { key: 'e', label: 'Milestone', render: x => v.event_types[x.e.event_type]?.label ?? x.e.event_type },
            { key: 'in', label: 'In', right: true, render: x => { const d = daysUntil(x.e.date); return d === 0 ? <Pill tone="green">Today</Pill> : `${d}d` } },
          ]} />
        </Card>
        <Card title="Every headline" solid>
          {newsU.length ? <ul className="space-y-3">{newsU.slice(0, 40).map((n, i) => (
            <li key={i} className="min-w-0">
              <div className="flex gap-2 items-center text-xs muted mb-0.5 flex-wrap">
                <Pill tone={n.off ? 'blue' : 'slate'}>{n.src}</Pill>
                <a href={`#/company/${n.r.company.company_id}`} className="font-semibold no-underline" style={{ color: 'var(--ink-2)' }}>{n.r.company.name}</a>{n.t && <> · {fmtDateTime(n.t)}</>}
              </div>
              <a href={n.url?.startsWith('http') ? n.url : `#/company/${n.r.company.company_id}`} target={n.url?.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="font-medium no-underline line-clamp-2" style={{ color: 'var(--ink)' }}>{n.title}</a>
            </li>))}</ul> : <p className="muted">No headlines yet.</p>}
        </Card>
      </div>
    </div>
  )
}
