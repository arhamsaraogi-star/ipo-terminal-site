import { useMemo, useState } from 'react'
import { useVault, go } from '../App'
import { Card, FactValue, Kpi, PageHead, Pill, Seg, Stage, Table } from '../components/ui'
import { eventDate, ipo } from '../lib/derive'
import { crore, daysUntil, fmtDate, fv, shares } from '../lib/format'
import type { CompanyRecord } from '../lib/types'

/* Anchor Desk — built for an investor that wants to get into the anchor book.
   The earliest public signal is the offer-document filing (SEBI for Mainboard, NSE Emerge for SME).
   The BRLM named on the cover runs the anchor book, so the deal-team contact is surfaced next to every filing. */

export const filedOn = (r: CompanyRecord) => {
  const ds = r.events.filter(e => ['DRHP_FILED', 'UDRHP_FILED'].includes(e.event_type)).map(e => e.date).sort()
  return ds[0] ?? null
}
export const brlms = (r: CompanyRecord) => (ipo(r)?.intermediaries?.contacts ?? []).filter(c => c.role === 'BRLM')

export function dealSize(r: CompanyRecord): { text: string; f?: ReturnType<typeof pick> } {
  const f = pick(r)
  if (!f) return { text: '—' }
  return { text: f.unit === 'shares' ? shares(fv(f)) : crore(fv(f)), f }
}
function pick(r: CompanyRecord) {
  const F = ipo(r)?.facts ?? {}
  return [F.total_issue, F.drhp_total_issue, F.drhp_fresh_issue, F.fresh_issue, F.drhp_total_issue_shares, F.drhp_fresh_issue_shares]
    .find(f => f && f.status !== 'not_available' && typeof f.value === 'number')
}

function Contacts({ r }: { r: CompanyRecord }) {
  const c = brlms(r)
  const names = ipo(r)?.intermediaries?.brlms ?? []
  if (!c.length && !names.length) return <span className="muted text-sm">Cover not yet read</span>
  return (
    <div className="text-sm space-y-0.5">
      {(c.length ? c : names.map(n => ({ name: n, email: null, contact_person: null }))).slice(0, 4).map(x => (
        <div key={x.name}>
          <b>{x.name.replace(/ (Private )?Limited$/i, '')}</b>
          {x.email && <> · <a href={`mailto:${x.email}?subject=${encodeURIComponent(`Anchor interest — ${r.company.name} IPO`)}`} onClick={e => e.stopPropagation()}>{x.email}</a></>}
          {x.contact_person && <span className="muted"> · {x.contact_person}</span>}
        </div>
      ))}
    </div>
  )
}

const flag = (r: CompanyRecord, k: string) => ipo(r)?.facts[k]?.value === true

export default function AnchorDesk() {
  const v = useVault()
  const [seg, setSeg] = useState<'ALL' | 'MAINBOARD' | 'SME'>('MAINBOARD')
  const [win, setWin] = useState('14')
  const [bank, setBank] = useState<string | null>(null)
  const pool = useMemo(() => v.companies.filter(r => (seg === 'ALL' || r.company.segment === seg)
    && (!bank || brlms(r).some(b => b.name === bank) || (ipo(r)?.intermediaries?.brlms ?? []).includes(bank))), [v, seg, bank])

  const fresh = pool.filter(r => { const d = filedOn(r); return d && -daysUntil(d) <= Number(win) && r.company.lifecycle !== 'WITHDRAWN' })
    .sort((a, b) => filedOn(b)!.localeCompare(filedOn(a)!))
  const today = fresh.filter(r => daysUntil(filedOn(r)!) === 0)
  const approved = pool.filter(r => (r.company.drhp_status ?? '').toLowerCase() === 'approved' && ['DRHP_FILED', 'SEBI_OBSERVED'].includes(r.company.lifecycle))
    .sort((a, b) => (filedOn(a) ?? '').localeCompare(filedOn(b) ?? ''))
  const imminent = pool.filter(r => ['RHP_FILED', 'ISSUE_ANNOUNCED'].includes(r.company.lifecycle)
    || (eventDate(r, 'ANCHOR_BIDDING') && daysUntil(eventDate(r, 'ANCHOR_BIDDING')!) >= 0 && daysUntil(eventDate(r, 'ANCHOR_BIDDING')!) <= 21))
    .sort((a, b) => (eventDate(a, 'ANCHOR_BIDDING') ?? '9').localeCompare(eventDate(b, 'ANCHOR_BIDDING') ?? '9'))

  // BRLM league table over the live pipeline (filed, not yet listed)
  const league = useMemo(() => {
    const m = new Map<string, { name: string; live: number; filed90: number; sme: number; email?: string | null }>()
    for (const r of v.companies) {
      if (['LISTED', 'WITHDRAWN'].includes(r.company.lifecycle) || (seg !== 'ALL' && r.company.segment !== seg)) continue
      const d = filedOn(r)
      for (const b of brlms(r)) {
        const x = m.get(b.name) ?? { name: b.name, live: 0, filed90: 0, sme: 0, email: b.email }
        x.live++; if (d && -daysUntil(d) <= 90) x.filed90++; if (r.company.segment === 'SME') x.sme++
        x.email = x.email ?? b.email
        m.set(b.name, x)
      }
    }
    return [...m.values()].sort((a, b) => b.live - a.live).slice(0, 25)
  }, [v, seg])

  const cols = [
    { key: 'f', label: 'Filed', sort: (r: CompanyRecord) => filedOn(r), render: (r: CompanyRecord) => { const d = filedOn(r)!; const n = -daysUntil(d); return <div><b>{fmtDate(d, false)}</b><div className="text-xs">{n === 0 ? <Pill tone="green">Today</Pill> : <span className="muted">{n}d ago</span>}</div></div> } },
    { key: 'c', label: 'Company', sort: (r: CompanyRecord) => r.company.name, render: (r: CompanyRecord) => <div><b>{r.company.name}</b>
      <div className="muted text-xs">{r.company.segment === 'SME' ? 'SME' : 'Mainboard'}{ipo(r)?.facts.eligibility_regulation ? ` · Reg ${ipo(r)!.facts.eligibility_regulation.value}` : ''}{r.company.drhp_status ? ` · ${r.company.drhp_status}` : ''}</div></div> },
    { key: 's', label: 'Size (cover)', right: true, sort: (r: CompanyRecord) => fv(pick(r)), render: (r: CompanyRecord) => { const s = dealSize(r); return s.f ? <FactValue f={s.f}>{s.text}</FactValue> : '—' } },
    { key: 't', label: 'Structure', render: (r: CompanyRecord) => <div className="text-sm">{String(ipo(r)?.facts.offer_type?.value ?? '—')}
      <div className="flex gap-1 mt-0.5">{flag(r, 'pre_ipo_placement_contemplated') && <Pill tone="violet">Pre-IPO placement</Pill>}{ipo(r)?.facts.eligibility_regulation?.value === '6(2)' && <Pill tone="amber">≥75% QIB</Pill>}</div></div> },
    { key: 'b', label: 'Lead managers (anchor book) · deal-team contact', render: (r: CompanyRecord) => <Contacts r={r} /> },
    { key: 'd', label: 'Doc', render: (r: CompanyRecord) => { const d = r.documents.find(x => ['DRHP', 'UDRHP'].includes(x.doc_type) && /\.(pdf|zip)$/i.test(x.url)) ?? r.documents.find(x => x.doc_type === 'DRHP'); return d ? <a href={d.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>DRHP ↗</a> : '—' } },
  ]

  return (
    <div className="space-y-5">
      <PageHead title="Anchor Desk" sub="Offer documents the day they are filed, with the lead managers who run the anchor book. Get in line early."
        action={<div className="flex flex-wrap gap-2"><Seg value={seg} onChange={setSeg} options={[{ v: 'MAINBOARD', label: 'Mainboard' }, { v: 'SME', label: 'SME' }, { v: 'ALL', label: 'All' }]} />
          <Seg value={win} onChange={setWin} options={[{ v: '1', label: 'Today' }, { v: '7', label: '7d' }, { v: '14', label: '14d' }, { v: '30', label: '30d' }, { v: '90', label: '90d' }]} /></div>} />
      {bank && <div className="glass panel px-4 py-2 text-sm flex items-center gap-3">Filtered to <b>{bank}</b><button className="btn !h-7" onClick={() => setBank(null)}>Clear</button></div>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Filed today" value={today.length} tone={today.length ? 'pos' : ''} sub="DRHP / updated DRHP" />
        <Kpi label={`Filed · last ${win}d`} value={fresh.length} sub="earliest anchor signal" />
        <Kpi label="Approved, not launched" value={approved.length} sub="observation / in-principle received" />
        <Kpi label="Anchor books imminent" value={imminent.length} sub="RHP filed or anchor date ≤ 21d" />
      </div>
      <Card title={`New filings · last ${win} days`} solid>
        <Table rows={fresh} cols={cols} onRow={r => go(`/company/${r.company.company_id}`)} empty="No new offer documents in this window" />
      </Card>
      <Card title="Anchor books coming up" solid>
        <Table rows={imminent} onRow={r => go(`/company/${r.company.company_id}`)} empty="Nothing imminent" cols={[
          { key: 'a', label: 'Anchor bid', render: r => { const d = eventDate(r, 'ANCHOR_BIDDING'); return d ? <b>{fmtDate(d, false)}</b> : <span className="muted">TBA</span> }, sort: r => eventDate(r, 'ANCHOR_BIDDING') },
          { key: 'c', label: 'Company', render: r => <div><b>{r.company.name}</b><div className="muted text-xs">{r.company.segment === 'SME' ? 'SME' : 'Mainboard'}</div></div> },
          { key: 's', label: 'Stage', render: r => <Stage s={r.company.lifecycle} /> },
          { key: 'z', label: 'Size', right: true, render: r => dealSize(r).text },
          { key: 'b', label: 'Lead managers · contact', render: r => <Contacts r={r} /> },
        ]} />
      </Card>
      <div className="grid xl:grid-cols-[1.3fr_1fr] gap-5">
        <Card title="Approved — likely to launch next" solid>
          <Table rows={approved.slice(0, 40)} onRow={r => go(`/company/${r.company.company_id}`)} empty="None" cols={[
            { key: 'f', label: 'DRHP', render: r => fmtDate(filedOn(r), false), sort: r => filedOn(r) },
            { key: 'c', label: 'Company', render: r => <b>{r.company.name}</b> },
            { key: 'z', label: 'Size', right: true, render: r => dealSize(r).text },
            { key: 'b', label: 'Lead managers', render: r => <Contacts r={r} /> },
          ]} />
          <p className="muted text-xs mt-2">SEBI observations are valid for 12 months; issuers typically launch within that window.</p>
        </Card>
        <Card title="Lead-manager league table (live pipeline)" solid>
          <Table rows={league} onRow={x => setBank(x.name)} empty="Covers not yet read" cols={[
            { key: 'n', label: 'Lead manager', render: x => <div><b>{x.name.replace(/ (Private )?Limited$/i, '')}</b>{x.email && <div className="text-xs"><a href={`mailto:${x.email}`} onClick={e => e.stopPropagation()}>{x.email}</a></div>}</div> },
            { key: 'l', label: 'Live', right: true, render: x => x.live, sort: x => x.live },
            { key: 'f', label: 'Filed 90d', right: true, render: x => x.filed90, sort: x => x.filed90 },
            { key: 's', label: 'SME', right: true, render: x => x.sme },
          ]} />
          <p className="muted text-xs mt-2">Click a bank to see only its mandates. Contacts are the deal-team addresses printed on the offer-document cover.</p>
        </Card>
      </div>
    </div>
  )
}
