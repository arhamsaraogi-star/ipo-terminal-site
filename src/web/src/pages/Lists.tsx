import { useState } from 'react'
import { useVault, go } from '../App'
import { Card, PageHead, Pill, Seg, Table } from '../components/ui'
import { eventDate, firstEvent, issuePrice, issueSize } from '../lib/derive'
import { crore, daysUntil, fmtDate, humanize, inr } from '../lib/format'

export function Listed() {
  const v = useVault()
  const [win, setWin] = useState('90')
  const rows = v.companies.map(r => ({ r, d: eventDate(r, 'LISTING') }))
    .filter(x => x.d && daysUntil(x.d) <= 0 && -daysUntil(x.d) <= Number(win))
  return (
    <div>
      <PageHead title="Recently Listed" sub="Listing outcomes. Market prices (delayed, labelled) arrive in Phase 8." />
      <Card solid title={`${rows.length} listings`} action={<Seg value={win} onChange={setWin} options={['7', '30', '90', '180'].map(x => ({ v: x, label: `${x}d` }))} />}>
        <Table rows={rows} onRow={x => go(`/company/${x.r.company.company_id}`)} cols={[
          { key: 'c', label: 'Company', render: x => <b>{x.r.company.name}</b> },
          { key: 'd', label: 'Listed', right: true, render: x => fmtDate(x.d), sort: x => x.d },
          { key: 'ago', label: 'Days since', right: true, render: x => -daysUntil(x.d!) },
          { key: 'ip', label: 'Issue price', right: true, render: x => inr(issuePrice(x.r)) },
          { key: 'ld', label: 'Listing detail', render: x => firstEvent(x.r, 'LISTING')?.detail ?? '—' },
          { key: 'sz', label: 'Issue size', right: true, render: x => crore(issueSize(x.r)), sort: x => issueSize(x.r) },
          { key: 'seg', label: 'Segment', render: x => x.r.company.segment },
        ]} />
      </Card>
    </div>
  )
}

export function PrivateTracker() {
  const v = useVault()
  const rows = v.companies.filter(r => r.company.lifecycle === 'PRIVATE' || r.company.private_tracker)
  const tone: Record<string, string> = { CONFIRMED_FILING: 'green', OFFICIAL_INDICATION: 'blue', CREDIBLE_REPORT: 'violet', UNCONFIRMED: 'slate' }
  return (
    <div>
      <PageHead title="Private → IPO" sub="Private companies with evidence of an IPO process. Confidence labels separate fact from reports." />
      <Card solid>
        <Table rows={rows} onRow={r => go(`/company/${r.company.company_id}`)} empty="No private companies tracked yet" cols={[
          { key: 'c', label: 'Company', render: r => <b>{r.company.name}</b> },
          { key: 'i', label: 'Industry', render: r => r.company.industry ?? '—' },
          { key: 'k', label: 'Confidence', render: r => r.company.private_tracker ? <Pill tone={tone[r.company.private_tracker.confidence]}>{humanize(r.company.private_tracker.confidence)}</Pill> : '—' },
          { key: 't', label: 'Expected timing', render: r => r.company.private_tracker?.expected_timing ?? '—' },
          { key: 'u', label: 'Last update', right: true, render: r => fmtDate(r.company.updated_at) },
        ]} />
      </Card>
    </div>
  )
}
