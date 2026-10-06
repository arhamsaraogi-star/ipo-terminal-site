import { useId, useMemo, useState } from 'react'
import { useVault } from '../App'
import { Seg } from '../components/ui'
import { chrono, forecastCagr, seriesCagr } from '../components/IndustryCharts'
import { finTable, ipo, isStub } from '../lib/derive'
import { daysUntil, fmtDate, fmtFact, fv, pct } from '../lib/format'
import { FIN_ORDER } from './Company'
import { brlms, dealSize, filedOn } from './AnchorDesk'
import type { CompanyRecord, Fact } from '../lib/types'

/* The Executive Print — a plain black-and-white morning report. Big type, no colour, page breaks between sections,
   built entirely from the data already in the terminal. Windows count calendar days in IST (filings carry a date, not a time). */

const cell = (f?: Fact | null) => (f && f.status === 'ok' && typeof f.value === 'number' && f.unit === 'INR crore' ? f.value.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(f.value) < 100 ? 1 : 0 }) : fmtFact(f))
const clean = (n: string) => n.replace(/^.*?\b(?:name of the )?(?:brlms?|book running lead managers?)( and logo)?\s*/i, m => (/brlm|lead manager/i.test(m) ? '' : m)).replace(/\s*\(formerly[^)]*\)/i, '').replace(/ (Private )?Limited$/i, '').trim()
const short = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2))
const segLabel = (r: CompanyRecord) => (r.company.segment === 'SME' ? 'SME' : 'Mainboard')

function Bars({ periods, series, projected = [] }: { periods: string[]; series: { name: string; values: (number | null)[] }[]; projected?: boolean[] }) {
  const id = useId().replace(/:/g, '')
  const W = 700, H = 290, L = 8, R = 8, T = 28, B = 66
  const all = series.flatMap(s => s.values).filter((x): x is number => x != null)
  if (!all.length) return null
  const hi = Math.max(0, ...all), lo = Math.min(0, ...all)
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1))
  const slot = (W - L - R) / periods.length, bw = Math.min(54, (slot * 0.8) / series.length)
  const fills = ['#000', `url(#h${id})`, '#bdbdbd']
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={series.map(s => s.name).join(', ')} style={{ maxHeight: 290 }}>
      <defs><pattern id={`h${id}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#fff" /><line x1="0" y1="0" x2="0" y2="7" stroke="#000" strokeWidth="3" /></pattern></defs>
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#000" strokeWidth="1.5" />
      {periods.map((p, i) => {
        const cx = L + slot * i + slot / 2
        return (
          <g key={p + i}>
            {series.map((s, k) => {
              const v = s.values[i]
              if (v == null) return null
              const x = cx - (bw * series.length) / 2 + bw * k
              const top = Math.min(y(v), y(0)), h = Math.max(1.5, Math.abs(y(v) - y(0)))
              return (
                <g key={s.name}>
                  <rect x={x} y={top} width={bw - 3} height={h} fill={projected[i] ? '#fff' : fills[k % 3]} stroke="#000" strokeWidth="2" strokeDasharray={projected[i] ? '5 3' : undefined} />
                  <text x={x + (bw - 3) / 2} y={v >= 0 ? top - 6 : top + h + 15} textAnchor="middle" fontSize="15" fontWeight="700" fill="#000">{short(v)}</text>
                </g>
              )
            })}
            <text x={cx} y={H - 10} textAnchor="middle" fontSize="15" fill="#000">{p}</text>
          </g>
        )
      })}
    </svg>
  )
}

const Legend = ({ names }: { names: string[] }) => (
  <div className="ex-legend">{names.map((n, i) => <span key={n}><i style={{ background: i === 0 ? '#000' : i === 1 ? 'repeating-linear-gradient(45deg,#000 0 3px,#fff 3px 6px)' : '#bdbdbd' }} />{n}</span>)}</div>
)

function Section({ title, children, first, big }: { title: string; children: React.ReactNode; first?: boolean; big?: boolean }) {
  return <section className={first ? 'ex-sec' : 'ex-sec ex-break'}>{big ? <div className="ex-dossier-title">{title}</div> : <h2>{title}</h2>}{children}</section>
}

function Dossier({ r, n }: { r: CompanyRecord; n: number }) {
  const o = ipo(r)
  const F = o?.facts ?? {}
  const { periods, byMetric } = finTable(r)
  const val = (m: string, p: string) => fv(byMetric.get(m)?.get(p))
  const fy = periods.filter(p => !isStub(p))
  const rev = fy.map(p => val('revenue_from_operations', p)), pat = fy.map(p => val('pat', p))
  const revCagr = fy.length >= 2 ? seriesCagr(fy, rev, fy.map(() => false)) : null
  const patCagr = fy.length >= 2 ? seriesCagr(fy, pat, fy.map(() => false)) : null
  const lastP = fy[fy.length - 1]
  const margin = lastP && val('pat', lastP) != null && val('revenue_from_operations', lastP) ? (val('pat', lastP)! / val('revenue_from_operations', lastP)!) * 100 : null
  const offerKeys = ['offer_type', 'total_issue', 'fresh_issue', 'ofs', 'drhp_total_issue', 'drhp_fresh_issue', 'drhp_ofs', 'drhp_total_issue_shares', 'drhp_fresh_issue_shares', 'drhp_ofs_shares',
    'pre_issue_shares', 'face_value', 'lot_size', 'eligibility_regulation', 'anchor_portion_contemplated', 'pre_ipo_placement_contemplated']
  const offer = offerKeys.filter(k => F[k] && F[k].status !== 'not_available').map(k => F[k])
  const contacts = brlms(r)
  const bankNames = contacts.length ? contacts.map(c => c.name) : o?.intermediaries?.brlms ?? []
  const industry = (r.facts?.industry_series ?? []).filter(s => !s.macro).map(s => {
    const c = chrono(s); const main = c.rows.find(x => /^total$/i.test(x.name.trim())) ?? c.rows[0]
    const g = main ? forecastCagr(c.periods, main.values, c.projected) : null
    const h = main ? seriesCagr(c.periods, main.values, c.projected, true) : null
    const score = (g ? 4 : 0) + (h ? 1 : 0) + (/share|%|growth|y-o-y|yoy/i.test(`${s.unit ?? ''} ${s.title}`) ? -3 : 0) + Math.min(c.periods.length, 8) * 0.1 + (s.kind !== 'text' ? 1 : 0)
    return { s, c, main, g, h, score }
  }).filter(x => x.main && x.c.periods.length >= 3).sort((a, b) => b.score - a.score).slice(0, 3)
  const claims = (r.facts?.industry_claims ?? []).slice(0, 3)
  const peers = (r.facts?.peers ?? []).slice(0, 6)
  return (
    <>
      <Section big title={`${n}. ${r.company.name}`}>
        <p className="ex-sub">{segLabel(r)} · {r.company.sector ?? 'sector n/a'} · DRHP filed {fmtDate(filedOn(r))}{r.company.drhp_status ? ` · SEBI status: ${r.company.drhp_status}` : ''}</p>
        <h3>What the company does</h3>
        <p>{r.company.overview?.summary ? (r.company.overview.summary.length > 1500 ? r.company.overview.summary.slice(0, 1500).replace(/\s\S*$/, '') + ' …' : r.company.overview.summary) : 'Business summary not yet read from the offer document.'}</p>
        <h3>The offer</h3>
        <table className="ex-table"><tbody>
          <tr><th>Size</th><td>{dealSize(r).text}</td></tr>
          {offer.map(f => <tr key={f.metric}><th>{f.label ?? f.metric.replace(/_/g, ' ')}</th><td>{typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : fmtFact(f)}</td></tr>)}
          <tr><th>Lead managers (BRLM)</th><td>{bankNames.length ? bankNames.map(clean).join(', ') : 'Not yet read'}</td></tr>
          {o?.intermediaries?.registrar && <tr><th>Registrar</th><td>{clean(o.intermediaries.registrar)}</td></tr>}
          {!!r.company.promoters?.length && <tr><th>Promoters</th><td>{r.company.promoters.join(', ')}</td></tr>}
        </tbody></table>
        {!!contacts.filter(c => c.email).length && <p className="ex-small">Deal-team contacts: {contacts.filter(c => c.email).slice(0, 4).map(c => `${clean(c.name)} — ${c.email}`).join(' · ')}</p>}
      </Section>
      <section className="ex-sec">
        <h3>Financials (₹ crore unless stated)</h3>
        {periods.length ? (
          <>
            <table className="ex-table ex-fin"><thead><tr><th>Item</th>{periods.map(p => <th key={p} className="r">{p}{isStub(p) ? '*' : ''}</th>)}</tr></thead>
              <tbody>{FIN_ORDER.filter(([m]) => byMetric.has(m)).map(([m, l]) => <tr key={m}><th>{l}</th>{periods.map(p => <td key={p} className="r">{cell(byMetric.get(m)?.get(p))}</td>)}</tr>)}</tbody></table>
            <p className="ex-small">* part-year period. Restated figures from the offer document.</p>
            {fy.length >= 2 && <>
              <h3>Revenue and profit</h3>
              <Bars periods={fy} series={[{ name: 'Revenue from operations', values: rev }, { name: 'Profit after tax', values: pat }]} />
              <Legend names={['Revenue from operations', 'Profit after tax']} />
              <p>{[revCagr && `Revenue has grown ${revCagr.pct.toFixed(1)}% a year (${revCagr.a.y}–${revCagr.b.y}).`, patCagr && `Profit has grown ${patCagr.pct.toFixed(1)}% a year.`,
                margin != null && `Latest profit margin is ${pct(margin)} (${lastP}).`].filter(Boolean).join(' ')} <span className="ex-small">(calculated here from the table above)</span></p>
            </>}
          </>
        ) : <p>The offer document is still being read — restated financials will appear in the next edition.</p>}
      </section>
      <section className="ex-sec">
        <h3>The industry</h3>
        {industry.length ? industry.map(({ s, c, g, h }, i) => (
          <figure key={i} className="ex-fig">
            <figcaption><b>{s.title}</b> <span className="ex-small">({[s.unit, `p.${s.page} of the offer document`].filter(Boolean).join(' · ')})</span></figcaption>
            <Bars periods={c.periods} projected={c.projected} series={(c.rows.length === 1 ? c.rows : c.rows.filter(x => !/^total$/i.test(x.name.trim())).slice(0, 3))} />
            {c.rows.length > 1 && <Legend names={c.rows.filter(x => !/^total$/i.test(x.name.trim())).slice(0, 3).map(x => x.name)} />}
            <p className="ex-small">{c.projected.some(Boolean) ? 'Dashed bars are estimates / projections. ' : ''}{g ? `Forecast growth ${g.pct.toFixed(1)}% a year (${g.a.p}–${g.b.p}).` : h ? `Historical growth ${h.pct.toFixed(1)}% a year.` : ''}</p>
          </figure>
        )) : claims.length ? null : <p>Industry data not yet read from the offer document.</p>}
        {!!claims.length && <ul>{claims.map((c, i) => <li key={i}>{c.text}{c.cagr_pct != null ? ` (growth ${c.cagr_pct}% a year)` : ''} <span className="ex-small">p.{c.page}</span></li>)}</ul>}
        {!!peers.length && <>
          <h3>Listed peers named in the document</h3>
          <table className="ex-table"><thead><tr><th>Company</th><th className="r">P/E</th><th className="r">P/B</th><th className="r">RoNW %</th></tr></thead>
            <tbody>{peers.map(p => <tr key={p.name}><th>{p.name}</th><td className="r">{(p.live?.pe ?? p.pe) != null ? (p.live?.pe ?? p.pe)!.toFixed(1) : '—'}</td><td className="r">{(p.live?.pb ?? p.pb) != null ? (p.live?.pb ?? p.pb)!.toFixed(2) : '—'}</td><td className="r">{p.ronw != null ? p.ronw.toFixed(1) : '—'}</td></tr>)}</tbody></table>
        </>}
      </section>
    </>
  )
}

export default function ExecutivePrint() {
  const v = useVault()
  const [win, setWin] = useState('1')
  const days = Number(win)
  const filed = useMemo(() => v.companies
    .filter(r => r.company.lifecycle !== 'WITHDRAWN' && !r.company.is_sample && !r.custom)
    .filter(r => { const f = filedOn(r); return !!f && daysUntil(f) <= 0 && daysUntil(f) >= -days })
    .sort((a, b) => filedOn(b)!.localeCompare(filedOn(a)!) || (fv(dealSize(b).f) ?? 0) - (fv(dealSize(a).f) ?? 0)),
  [v, days])
  const when = days === 1 ? 'the last 24 hours' : `the last ${days} days`
  const stamp = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const crore = (r: CompanyRecord) => { const f = dealSize(r).f; return f && /crore/i.test(f.unit ?? '') ? fv(f) ?? 0 : 0 }
  const total = filed.reduce((s, r) => s + crore(r), 0)
  const sized = filed.filter(r => crore(r) > 0).length
  const main = filed.filter(r => r.company.segment !== 'SME').length
  const banks = new Map<string, number>()
  filed.forEach(r => (brlms(r).length ? brlms(r).map(b => b.name) : ipo(r)?.intermediaries?.brlms ?? []).forEach(b => banks.set(clean(b), (banks.get(clean(b)) ?? 0) + 1)))
  const topBanks = [...banks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const leads = (r: CompanyRecord) => (brlms(r).length ? brlms(r).map(b => b.name) : ipo(r)?.intermediaries?.brlms ?? []).map(clean)

  return (
    <div className="exec-wrap">
      <div className="exec-noprint exec-bar">
        <a className="btn" href="#/">← Home</a>
        <Seg value={win} onChange={setWin} options={[{ v: '1', label: '24 hours' }, { v: '2', label: '2 days' }, { v: '7', label: '7 days' }]} />
        <button className="btn btn-primary" onClick={() => window.print()}>⎙ Print / Save as PDF</button>
      </div>
      <article className="exec">
        <header className="ex-mast">
          <div className="ex-eyebrow">Private &amp; confidential · {stamp}</div>
          <h1>The Executive Print</h1>
          <div className="ex-tag">New DRHP filings · {when}</div>
        </header>

        <div className="ex-stats">
          <div><b>{filed.length}</b><span>new DRHP{filed.length === 1 ? '' : 's'}</span></div>
          <div><b>{total ? `₹${Math.round(total).toLocaleString('en-IN')} cr` : '—'}</b><span>proposed · {sized} of {filed.length} disclosed</span></div>
          <div><b>{main} · {filed.length - main}</b><span>mainboard · SME</span></div>
        </div>
        {!!topBanks.length && <p className="ex-note">Most active lead managers: {topBanks.map(([b, n]) => `${b} (${n})`).join(', ')}.</p>}

        {filed.length ? (
          <section className="ex-sec">
            <h2>At a glance</h2>
            <table className="ex-table">
              <thead><tr><th>#</th><th>Company</th><th>Segment</th><th className="r">Size</th><th>Lead managers</th><th className="r">Filed</th></tr></thead>
              <tbody>{filed.map((r, i) => (
                <tr key={r.company.company_id}>
                  <td className="ex-num">{i + 1}</td>
                  <th>{clean(r.company.name)}{r.company.sector && <div className="ex-small">{r.company.sector}</div>}</th>
                  <td>{segLabel(r)}</td>
                  <td className="r">{dealSize(r).text}</td>
                  <td className="ex-small">{leads(r).join(', ') || '—'}</td>
                  <td className="r">{fmtDate(filedOn(r), false)}</td>
                </tr>))}</tbody>
            </table>
          </section>
        ) : <p className="ex-empty">No new DRHPs were filed in {when}. Try the 2-day or 7-day view.</p>}

        {filed.slice(0, 12).map((r, i) => <Dossier key={r.company.company_id} r={r} n={i + 1} />)}
        {filed.length > 12 && <p className="ex-note">{filed.length - 12} more filings are listed in the table above; open them in the terminal for full notes.</p>}

        <footer className="ex-foot">Sources: SEBI, NSE and BSE filings and the offer documents themselves. Growth rates are calculated by the terminal from the printed figures. For internal discussion; not investment advice.</footer>
      </article>
    </div>
  )
}
