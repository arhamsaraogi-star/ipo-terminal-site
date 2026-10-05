import { useMemo, useState } from 'react'
import { useVault, go } from '../App'
import { Card, PageHead, Seg, Stage, Table } from '../components/ui'
import { eventDate, isHeld, isWatched, issueSize, priceBand } from '../lib/derive'
import { STAGE, crore, daysUntil, fmtDate } from '../lib/format'

type Seg_ = 'ALL' | 'MAINBOARD' | 'SME'

export default function Pipeline({ mode }: { mode: 'all' | 'upcoming' }) {
  const v = useVault()
  const [seg, setSeg] = useState<Seg_>('ALL')
  const [stage, setStage] = useState('ALL')
  const [sector, setSector] = useState('ALL')
  const sectors = [...new Set(v.companies.map(r => r.company.sector).filter(Boolean))] as string[]
  const rows = useMemo(() => v.companies.filter(r => {
    const c = r.company
    if (c.lifecycle === 'PRIVATE') return false
    if (mode === 'upcoming') {
      const open = eventDate(r, 'ISSUE_OPEN') ?? eventDate(r, 'LISTING')
      if (!open || daysUntil(open) < -3 || c.lifecycle === 'LISTED') return false
    }
    return (seg === 'ALL' || c.segment === seg) && (stage === 'ALL' || c.lifecycle === stage) && (sector === 'ALL' || c.sector === sector)
  }), [v, mode, seg, stage, sector])

  return (
    <div>
      <PageHead title={mode === 'all' ? 'IPO Pipeline' : 'Upcoming IPOs'}
        sub={mode === 'all' ? 'Every company from DRHP filing through listing.' : 'Issues with announced or scheduled dates.'} />
      <Card solid action={
        <div className="flex flex-wrap gap-2 items-center">
          <Seg value={seg} onChange={setSeg} options={[{ v: 'ALL', label: 'All' }, { v: 'MAINBOARD', label: 'Mainboard' }, { v: 'SME', label: 'SME' }]} />
          <select className="input !h-9 !w-auto" value={stage} onChange={e => setStage(e.target.value)} aria-label="Stage">
            <option value="ALL">All stages</option>
            {Object.entries(STAGE).filter(([k]) => k !== 'PRIVATE').map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <select className="input !h-9 !w-auto" value={sector} onChange={e => setSector(e.target.value)} aria-label="Sector">
            <option value="ALL">All sectors</option>{sectors.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>} title={`${rows.length} companies`}>
        <Table rows={rows} onRow={r => go(`/company/${r.company.company_id}`)} initialSort={{ key: 'stage', dir: -1 }} cols={[
          { key: 'c', label: 'Company', sort: r => r.company.name, render: r => <div className="flex items-center gap-2">
            {isHeld(v, r.company.company_id) && <span title="In portfolio" style={{ color: '#f5a623' }}>★</span>}
            {!isHeld(v, r.company.company_id) && isWatched(v, r.company.company_id) && <span title="Watching" className="muted">☆</span>}
            <div><b>{r.company.name}</b><div className="muted text-xs">{r.company.segment === 'SME' ? 'SME · ' : ''}{r.company.industry}</div></div></div> },
          { key: 'stage', label: 'Stage', sort: r => STAGE[r.company.lifecycle].rank, render: r => <Stage s={r.company.lifecycle} /> },
          { key: 'sec', label: 'Sector', sort: r => r.company.sector ?? '', render: r => r.company.sector ?? '—' },
          { key: 'sz', label: 'Issue size', right: true, sort: r => issueSize(r), render: r => crore(issueSize(r)) },
          { key: 'pb', label: 'Price band', right: true, render: r => priceBand(r) },
          ...(['DRHP_FILED', 'RHP_FILED', 'ANCHOR_BIDDING', 'ISSUE_OPEN', 'LISTING'] as const).map(t => ({
            key: t, label: { DRHP_FILED: 'DRHP', RHP_FILED: 'RHP', ANCHOR_BIDDING: 'Anchor', ISSUE_OPEN: 'Opens', LISTING: 'Listing' }[t],
            right: true, sort: (r: typeof rows[number]) => eventDate(r, t), render: (r: typeof rows[number]) => fmtDate(eventDate(r, t), false),
          })),
        ]} />
      </Card>
    </div>
  )
}
