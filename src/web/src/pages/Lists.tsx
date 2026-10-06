import { useState } from 'react'
import { useVault, go } from '../App'
import { Card, Delta, Kpi, PageHead, Pill, Seg, Table } from '../components/ui'
import { cmp, holdingMarks, ipo, issuePrice, issueSize, listedOn, listingGainPct, listingOpen, mcapNow, returnVsIssuePct } from '../lib/derive'
import { crore, daysUntil, fmtDate, fv, humanize, inr } from '../lib/format'
import { dealSize, filedOn } from './AnchorDesk'

export function Listed() {
  const v = useVault()
  const [win, setWin] = useState('90')
  const [seg, setSeg] = useState<'ALL' | 'MAINBOARD' | 'SME'>('ALL')
  const rows = v.companies.map(r => ({ r, d: listedOn(r) }))
    .filter(x => x.d && daysUntil(x.d) <= 0 && -daysUntil(x.d) <= Number(win) && (seg === 'ALL' || x.r.company.segment === seg))
  const gains = rows.map(x => listingGainPct(x.r)).filter((g): g is number => g != null)
  const rets = rows.map(x => returnVsIssuePct(x.r)).filter((g): g is number => g != null)
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
  const median = (a: number[]) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }
  return (
    <div className="space-y-5">
      <PageHead title="Recently Listed" sub="Listing-day performance and returns since issue. Prices are NSE end-of-day (delayed)."
        action={<div className="flex flex-wrap gap-2"><Seg value={seg} onChange={setSeg} options={[{ v: 'ALL', label: 'All' }, { v: 'MAINBOARD', label: 'Mainboard' }, { v: 'SME', label: 'SME' }]} />
          <Seg value={win} onChange={setWin} options={['7', '30', '90', '180', '365'].map(x => ({ v: x, label: `${x}d` }))} /></div>} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Listings" value={rows.length} sub={`last ${win} days`} />
        <Kpi label="Avg listing gain" value={<Delta v={avg(gains)} />} sub={`median ${median(gains)?.toFixed(1) ?? '—'}%`} />
        <Kpi label="Avg return vs issue" value={<Delta v={avg(rets)} />} sub={`median ${median(rets)?.toFixed(1) ?? '—'}%`} />
        <Kpi label="Trading above issue" value={rets.length ? `${Math.round((rets.filter(x => x > 0).length / rets.length) * 100)}%` : '—'} sub={`${rets.filter(x => x > 0).length} of ${rets.length}`} />
      </div>
      <Card solid>
        <Table rows={rows} onRow={x => go(`/company/${x.r.company.company_id}`)} initialSort={{ key: 'd', dir: -1 }} search={x => `${x.r.company.name} ${x.r.company.identifiers.nse_symbol ?? ''}`} cols={[
          { key: 'c', label: 'Company', sort: x => x.r.company.name, render: x => <div><b>{x.r.company.name}</b><div className="muted text-xs">{x.r.company.segment === 'SME' ? 'SME' : 'Mainboard'}{x.r.company.identifiers.nse_symbol ? ` · ${x.r.company.identifiers.nse_symbol}` : ''}</div></div> },
          { key: 'd', label: 'Listed', right: true, render: x => fmtDate(x.d), sort: x => x.d },
          { key: 'ip', label: 'Issue ₹', right: true, render: x => inr(issuePrice(x.r)), sort: x => issuePrice(x.r) },
          { key: 'lo', label: 'Listing open ₹', right: true, render: x => inr(listingOpen(x.r), 2), hideMobile: true },
          { key: 'lg', label: 'Listing gain', right: true, render: x => <Delta v={listingGainPct(x.r)} />, sort: x => listingGainPct(x.r) },
          { key: 'cmp', label: 'Price ₹', right: true, render: x => inr(cmp(x.r), 2), sort: x => cmp(x.r) },
          { key: 'ret', label: 'vs issue', right: true, render: x => <Delta v={returnVsIssuePct(x.r)} />, sort: x => returnVsIssuePct(x.r) },
          { key: 'mc', label: 'Mcap', right: true, render: x => crore(mcapNow(x.r)), sort: x => mcapNow(x.r) },
          { key: 'sz', label: 'Issue size', right: true, render: x => crore(issueSize(x.r)), sort: x => issueSize(x.r), hideMobile: true },
          { key: 'sub', label: 'Subs.', right: true, render: x => { const s = ipo(x.r)?.subscription?.total_times; return s == null ? '—' : `${s.toFixed(1)}x` }, sort: x => ipo(x.r)?.subscription?.total_times ?? null, hideMobile: true },
        ]} />
      </Card>
    </div>
  )
}

export function PrivateTracker() {
  const v = useVault()
  const [seg, setSeg] = useState<'ALL' | 'MAINBOARD' | 'SME'>('ALL')
  const rows = v.companies.filter(r => ['PRIVATE', 'DRHP_FILED', 'SEBI_OBSERVED', 'RHP_FILED', 'ISSUE_ANNOUNCED'].includes(r.company.lifecycle) && (seg === 'ALL' || r.company.segment === seg))
  const held = new Map(v.portfolio.holdings.map(h => [h.company_id, h]))
  return (
    <div className="space-y-5">
      <PageHead title="Private → IPO" sub="Unlisted companies with an offer document on file. Your pre-IPO positions are marked against the latest round and, once priced, the IPO."
        action={<Seg value={seg} onChange={setSeg} options={[{ v: 'ALL', label: 'All' }, { v: 'MAINBOARD', label: 'Mainboard' }, { v: 'SME', label: 'SME' }]} />} />
      <Card solid title={`${rows.length} companies`}>
        <Table rows={rows} onRow={r => go(`/company/${r.company.company_id}`)} initialSort={{ key: 'f', dir: -1 }}
          search={r => `${r.company.name} ${(ipo(r)?.intermediaries?.brlms ?? []).join(' ')}`} cols={[
          { key: 'c', label: 'Company', sort: r => r.company.name, render: r => <div><b>{held.has(r.company.company_id) && <span style={{ color: '#f5a623' }}>★ </span>}{r.company.name}</b>
            <div className="muted text-xs">{r.company.segment === 'SME' ? 'SME' : 'Mainboard'}{r.company.drhp_status ? ` · ${r.company.drhp_status}` : ''}</div></div> },
          { key: 's', label: 'Stage', render: r => <Pill tone={r.company.lifecycle === 'RHP_FILED' || r.company.lifecycle === 'ISSUE_ANNOUNCED' ? 'blue' : r.company.lifecycle === 'SEBI_OBSERVED' ? 'indigo' : 'violet'}>{humanize(r.company.lifecycle)}</Pill> },
          { key: 'f', label: 'Filed', m: 'key', right: true, sort: r => filedOn(r), render: r => fmtDate(filedOn(r)) },
          { key: 'z', label: 'Size (as filed)', right: true, sort: r => fv(issueSizeFact(r)), render: r => dealSize(r).text },
          { key: 'b', label: 'Lead managers', hideMobile: true, render: r => <span className="text-sm">{(ipo(r)?.intermediaries?.brlms ?? []).map(b => b.replace(/ (Private )?Limited$/i, '')).join(', ') || '—'}</span> },
          { key: 'p', label: 'Our position', right: true, render: r => { const h = held.get(r.company.company_id); if (!h) return <span className="muted">—</span>
            const { marks } = holdingMarks(r, h); const m = marks[marks.length - 1]; return m?.multiple != null ? <b className={m.multiple >= 1 ? 'pos' : 'neg'}>{m.multiple.toFixed(2)}x <span className="muted text-xs font-normal">{m.label}</span></b> : <Pill tone="amber">held</Pill> } },
        ]} />
      </Card>
    </div>
  )
}

function issueSizeFact(r: Parameters<typeof dealSize>[0]) { return dealSize(r).f }
