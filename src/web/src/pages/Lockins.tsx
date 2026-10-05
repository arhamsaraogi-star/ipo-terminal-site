import { useState } from 'react'
import { useVault, go } from '../App'
import { Card, FactValue, PageHead, Pill, Seg, Table } from '../components/ui'
import { allLockins, isHeld } from '../lib/derive'
import { fmtDate, urgency } from '../lib/format'
import { holder } from './Dashboard'

const BANDS = [{ v: 'upcoming', label: 'Upcoming' }, { v: 'lt7', label: '< 7d' }, { v: '7to30', label: '7–30d' },
  { v: '30to90', label: '30–90d' }, { v: 'gt90', label: '> 90d' }, { v: 'expired', label: 'Expired' }, { v: 'all', label: 'All' }]

export default function Lockins() {
  const v = useVault()
  const [band, setBand] = useState('upcoming')
  const all = allLockins(v)
  const rows = all.filter(x => band === 'all' || (band === 'upcoming' ? x.d >= 0 : urgency(x.d).key === band))
  const tally = (k: string) => all.filter(x => urgency(x.d).key === k).length
  return (
    <div className="space-y-5">
      <PageHead title="Lock-in Calendar" sub="Shares becoming eligible for sale. Eligibility is not a forecast of selling." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['lt7', '< 7 days', 'neg'], ['7to30', '7–30 days', 'warn'], ['30to90', '30–90 days', ''], ['gt90', '> 90 days', '']].map(([k, l, t]) => (
          <div key={k} className="glass p-5"><div className="eyebrow">{l}</div><div className={`display text-[36px] font-semibold ${t}`}>{tally(k)}</div></div>
        ))}
      </div>
      <Card solid title={`${rows.length} tranches`} action={<Seg value={band} onChange={setBand} options={BANDS} />}>
        <Table rows={rows} onRow={x => go(`/company/${x.r.company.company_id}`)} cols={[
          { key: 'd', label: 'Expiry', render: x => <b>{fmtDate(x.l.expiry_date)}</b>, sort: x => x.l.expiry_date },
          { key: 'r', label: 'Days', right: true, render: x => { const u = urgency(x.d); return <Pill tone={u.tone}>{x.d < 0 ? 'Expired' : `${x.d}d`}</Pill> }, sort: x => x.d },
          { key: 'c', label: 'Company', render: x => <span>{isHeld(v, x.r.company.company_id) && <span style={{ color: '#f5a623' }}>★ </span>}{x.r.company.name}</span>, sort: x => x.r.company.name },
          { key: 'h', label: 'Holder', render: x => holder(x.l.holder_category) },
          { key: 's', label: 'Shares', right: true, render: x => <FactValue f={x.l.shares} /> },
          { key: 'p', label: '% equity', right: true, render: x => <FactValue f={x.l.pct_post_issue} />, sort: x => Number(x.l.pct_post_issue?.value ?? 0) },
          { key: 'src', label: 'Rule', render: x => <span className="text-sm">{x.l.rule_id}{!x.l.rule_verified && <> <Pill tone="amber">unverified</Pill></>}</span> },
        ]} />
      </Card>
    </div>
  )
}
