import { useId, useMemo, useState } from 'react'
import { useVault } from '../App'
import { Seg } from '../components/ui'
import { chrono, forecastCagr, seriesCagr } from '../components/IndustryCharts'
import { allLockins, byId, cmp, dayChangePct, finTable, ipo, isMine, isStub, listedOn, listingGainPct, nextEvent, returnVsIssuePct, upcomingEvents } from '../lib/derive'
import { daysUntil, fmtDate, fmtFact, fv, inr, isoToday, pct } from '../lib/format'
import { FIN_ORDER } from './Company'
import { brlms, dealSize, filedOn } from './AnchorDesk'
import type { CompanyRecord, Fact } from '../lib/types'

/* The Executive Print — a plain black-and-white morning report. Big type, no colour, page breaks between sections,
   built entirely from the data already in the terminal. Windows count calendar days in IST (filings carry a date, not a time). */

const SIGNIFICANT = new Set(['lifecycle', 'price_band', 'issue_price', 'total_issue', 'ISSUE_OPEN', 'ISSUE_CLOSE', 'LISTING', 'RHP_FILED', 'drhp_status'])
const cell = (f?: Fact | null) => (f && f.status === 'ok' && typeof f.value === 'number' && f.unit === 'INR crore' ? f.value.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(f.value) < 100 ? 1 : 0 }) : fmtFact(f))
const clean = (n: string) => n.replace(/ (Private )?Limited$/i, '')
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

function Section({ title, children, first }: { title: string; children: React.ReactNode; first?: boolean }) {
  return <section className={first ? 'ex-sec' : 'ex-sec ex-break'}><h2>{title}</h2>{children}</section>
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
      <Section title={`${n}. ${r.company.name}`}>
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
  const today = isoToday()
  const recent = (d?: string | null) => !!d && daysUntil(d) <= 0 && daysUntil(d) >= -days
  const since = Date.now() - (days === 1 ? 24 : days * 24) * 3_600_000

  const d = useMemo(() => {
    const live = v.companies.filter(r => r.company.lifecycle !== 'WITHDRAWN' && !r.company.is_sample)
    const filed = live.filter(r => recent(filedOn(r))).sort((a, b) => filedOn(b)!.localeCompare(filedOn(a)!) || a.company.name.localeCompare(b.company.name))
    const fallback = !filed.length ? live.filter(r => filedOn(r)).sort((a, b) => filedOn(b)!.localeCompare(filedOn(a)!)).slice(0, 3) : []
    const listings = live.filter(r => recent(listedOn(r)))
    const approvals = live.filter(r => r.events.some(e => e.event_type === 'SEBI_OBSERVATION' && recent(e.date)))
    const changes = v.changes.filter(c => new Date(c.detected_at).getTime() >= since && SIGNIFICANT.has(c.field))
    const news = v.companies.flatMap(r => r.news.filter(n => new Date(n.published_at).getTime() >= since).map(n => ({ r, n })))
      .sort((a, b) => b.n.published_at.localeCompare(a.n.published_at)).slice(0, 10)
    const cal = upcomingEvents(v, 7, ['ISSUE_OPEN', 'ISSUE_CLOSE', 'ANCHOR_BIDDING', 'BASIS_OF_ALLOTMENT', 'LISTING', 'RHP_FILED']).filter(x => !x.r.company.is_sample)
    const locks = allLockins(v).filter(x => x.d >= 0 && x.d <= 14)
    const recentListed = live.filter(r => { const l = listedOn(r); return l && daysUntil(l) <= 0 && daysUntil(l) >= -45 }).sort((a, b) => listedOn(b)!.localeCompare(listedOn(a)!))
    const mine = v.companies.filter(r => isMine(v, r.company.company_id))
    return { filed, fallback, listings, approvals, changes, news, cal, locks, recentListed, mine }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, win])
  const dossiers = (d.filed.length ? d.filed : d.fallback).slice(0, 6)
  const extra = (d.filed.length ? d.filed : []).slice(6)
  const when = days === 1 ? 'last 24 hours' : `last ${days} days`
  const stamp = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

  const hr = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }))
  const part = hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : 'Evening'
  const edition = part.toUpperCase()
  const issueNo = Math.floor((Date.parse(today) - Date.parse('2026-01-01')) / 86_400_000) + 1
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const bits = [d.filed.length && `${plural(d.filed.length, 'new DRHP filing')}`, d.approvals.length && `${plural(d.approvals.length, 'SEBI approval')}`,
    d.listings.length && `${plural(d.listings.length, 'new listing')}`, d.changes.length && `${plural(d.changes.length, 'significant update')}`].filter(Boolean) as string[]
  const lead = bits.length ? `Here are the top happenings from the IPO pipeline in the ${when}: ${bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0]}. Turn the page for the full story, the week ahead, and a complete note on every new filing.`
    : `It has been a quiet stretch in the IPO pipeline over the ${when}. Here is the week ahead, how recent listings are faring, and notes on the latest filings.`
  const big = [...d.filed].sort((a, b) => (fv(dealSize(b).f) ?? 0) - (fv(dealSize(a).f) ?? 0))[0]
  const headline = big ? { title: `${big.company.name} files its DRHP${dealSize(big).f ? ` for an issue of ${dealSize(big).text}` : ''}`, body: `${segLabel(big)} issue${big.company.sector ? ` in ${big.company.sector}` : ''}. Lead managers: ${(brlms(big).length ? brlms(big).map(b => b.name) : ipo(big)?.intermediaries?.brlms ?? ['to be announced']).map(clean).join(', ')}.${d.filed.length > 1 ? ` ${d.filed.length - 1} other filing${d.filed.length > 2 ? 's' : ''} also landed.` : ''}` }
    : d.listings[0] ? { title: `${d.listings[0].company.name} lists on the exchange`, body: `Listed ${fmtDate(listedOn(d.listings[0]))}${listingGainPct(d.listings[0]) != null ? `, opening ${listingGainPct(d.listings[0])! >= 0 ? '+' : ''}${listingGainPct(d.listings[0])!.toFixed(1)}% against its issue price.` : '.'}` }
    : d.approvals[0] ? { title: `${d.approvals[0].company.name} receives SEBI's go-ahead`, body: 'The observation letter has been issued; the company may now launch its IPO within 12 months.' } : null

  return (
    <div className="exec-wrap">
      <div className="exec-noprint exec-bar">
        <a className="btn" href="#/">← Home</a>
        <Seg value={win} onChange={setWin} options={[{ v: '1', label: '24 hours' }, { v: '2', label: '2 days' }, { v: '7', label: '7 days' }]} />
        <button className="btn btn-primary" onClick={() => window.print()}>⎙ Print / Save as PDF</button>
        <span className="muted text-sm">Black &amp; white · large type · one page break per section</span>
      </div>
      <article className="exec">
        <header className="ex-mast">
          <div className="ex-ribbon"><span>PRIVATE &amp; CONFIDENTIAL</span><span className="ex-badge">{edition} EDITION</span><span>No. {issueNo}</span></div>
          <div className="ex-orn">✦ ✦ ✦</div>
          <h1>The Executive Print</h1>
          <div className="ex-tag">India's IPO pipeline, read for you</div>
          <div className="ex-date">{stamp}</div>
        </header>

        <div className="ex-greet">
          <div className="ex-hello">Good {part}.</div>
          <p className="ex-lead">{lead}</p>
        </div>

        <div className="ex-tiles">
          {[[d.filed.length, 'New DRHP filings'], [d.approvals.length, 'SEBI approvals'], [d.listings.length, 'New listings'],
            [d.cal.filter(x => x.e.event_type === 'ISSUE_OPEN').length, 'Issues opening, next 7 days'], [d.locks.length, 'Lock-ins ending, next 14 days'], [d.changes.length, 'Significant updates']].map(([n, l]) => (
            <div key={l as string} className="ex-tile"><b>{n}</b><span>{l}</span></div>))}
        </div>

        {headline && <aside className="ex-headline"><div className="ex-kicker">★ TOP STORY</div><div className="ex-hl">{headline.title}</div><p>{headline.body}</p></aside>}

        <div className="ex-orn">❖ ❖ ❖</div>

        <Section title="The last 24 hours in detail" first>
          <h3>New DRHP filings</h3>
          {d.filed.length ? <ol>{d.filed.map(r => <li key={r.company.company_id}><b>{r.company.name}</b> — {segLabel(r)}, {dealSize(r).text}; lead managers: {(brlms(r).length ? brlms(r).map(b => b.name) : ipo(r)?.intermediaries?.brlms ?? ['to be read']).map(clean).join(', ')}. Filed {fmtDate(filedOn(r))}.</li>)}</ol>
            : <p>No new DRHP filings in the {when}. {d.fallback.length ? 'The three most recent filings are profiled instead.' : ''}</p>}

          <h3>SEBI approvals</h3>
          {d.approvals.length ? <ul>{d.approvals.map(r => <li key={r.company.company_id}><b>{r.company.name}</b> — observation letter received; the company may now launch its issue (valid 12 months).</li>)}</ul> : <p>None in the {when}.</p>}

          <h3>New listings</h3>
          {d.listings.length ? <ul>{d.listings.map(r => { const g = listingGainPct(r); return <li key={r.company.company_id}><b>{r.company.name}</b> listed {fmtDate(listedOn(r))}{ipo(r) && fv(ipo(r)!.facts.issue_price) ? ` at issue price ${inr(fv(ipo(r)!.facts.issue_price))}` : ''}{g != null ? `; opened ${g >= 0 ? '+' : ''}${g.toFixed(1)}% vs issue price` : ''}.</li> })}</ul> : <p>None in the {when}.</p>}

          <h3>Significant updates</h3>
          {d.changes.length ? <ul>{d.changes.slice(0, 12).map(c => <li key={c.change_id}><b>{clean(byId(v, c.company_id)?.company.name ?? c.company_id)}</b> — {c.label ?? c.field}: {c.old == null ? 'new' : `${String(c.old)} →`} <b>{String(c.new)}</b></li>)}</ul> : <p>No material changes detected in the {when}.</p>}
        </Section>

        <Section title="The week ahead">
          <h3>Issue calendar — next 7 days</h3>
          {d.cal.length ? <table className="ex-table"><thead><tr><th>Date</th><th>Company</th><th>Event</th></tr></thead><tbody>
            {d.cal.map(({ r, e }, i) => <tr key={i}><td>{fmtDate(e.date, false)}{e.date === today ? ' (today)' : ''}</td><th>{clean(r.company.name)}</th><td>{v.event_types[e.event_type]?.label ?? e.event_type}{e.date_kind === 'derived' ? ' (estimated)' : ''}</td></tr>)}</tbody></table> : <p>Nothing scheduled.</p>}
          <h3>Lock-ins ending — next 14 days</h3>
          {d.locks.length ? <table className="ex-table"><thead><tr><th>Date</th><th>Company</th><th>Holders</th><th className="r">% of equity</th></tr></thead><tbody>
            {d.locks.slice(0, 15).map((x, i) => <tr key={i}><td>{fmtDate(x.l.expiry_date, false)} ({x.d}d)</td><th>{clean(x.r.company.name)}</th><td>{x.l.holder_category.replace(/_/g, ' ').toLowerCase()}</td><td className="r">{x.l.pct_post_issue?.value != null ? pct(Number(x.l.pct_post_issue.value)) : 'n/a'}</td></tr>)}</tbody></table> : <p>No lock-in expiries.</p>}
          <p className="ex-small">Anchor lock-ins: the last locked day is shown; shares are tradable from the next business day.</p>
        </Section>

        <Section title="Recent listings — how are they doing?" first>
          {d.recentListed.length ? <table className="ex-table"><thead><tr><th>Company</th><th>Listed</th><th className="r">Issue ₹</th><th className="r">Listing gain</th><th className="r">Now ₹</th><th className="r">Since issue</th></tr></thead><tbody>
            {d.recentListed.slice(0, 14).map(r => { const g = listingGainPct(r), t = returnVsIssuePct(r); return (
              <tr key={r.company.company_id}><th>{clean(r.company.name)}</th><td>{fmtDate(listedOn(r), false)}</td><td className="r">{ipo(r) && fv(ipo(r)!.facts.issue_price) ? inr(fv(ipo(r)!.facts.issue_price)) : '—'}</td>
                <td className="r">{g != null ? `${g >= 0 ? '+' : ''}${g.toFixed(1)}%` : '—'}</td><td className="r">{cmp(r) != null ? inr(cmp(r), 2) : '—'}</td><td className="r">{t != null ? `${t >= 0 ? '+' : ''}${t.toFixed(1)}%` : '—'}</td></tr>) })}</tbody></table> : <p>No listings in the last 45 days.</p>}
          {!!d.mine.length && <>
            <h3>Your investments and tracked companies</h3>
            <table className="ex-table"><thead><tr><th>Company</th><th>Stage</th><th className="r">Price ₹</th><th className="r">Today</th><th>Next</th></tr></thead><tbody>
              {d.mine.slice(0, 14).map(r => { const ne = nextEvent(r), dc = dayChangePct(r); return (
                <tr key={r.company.company_id}><th>{clean(r.company.name)}</th><td>{r.company.lifecycle.replace(/_/g, ' ').toLowerCase()}</td><td className="r">{cmp(r) != null ? inr(cmp(r), 2) : '—'}</td>
                  <td className="r">{dc != null ? `${dc >= 0 ? '+' : ''}${dc.toFixed(1)}%` : '—'}</td><td>{ne ? `${v.event_types[ne.event_type]?.label ?? ne.event_type}, ${fmtDate(ne.date, false)}` : '—'}</td></tr>) })}</tbody></table>
          </>}
          {!!d.news.length && <>
            <h3>Headlines — {when}</h3>
            <ul>{d.news.map(({ r, n }) => <li key={n.news_id}><b>{clean(r.company.name)}</b> — {n.title} <span className="ex-small">({n.publisher ?? n.category})</span></li>)}</ul>
          </>}
        </Section>

        {dossiers.map((r, i) => <Dossier key={r.company.company_id} r={r} n={i + 1} />)}

        {!!extra.length && <Section title="Also filed">
          <table className="ex-table"><thead><tr><th>Company</th><th>Segment</th><th>Size</th><th>Filed</th></tr></thead><tbody>
            {extra.map(r => <tr key={r.company.company_id}><th>{r.company.name}</th><td>{segLabel(r)}</td><td>{dealSize(r).text}</td><td>{fmtDate(filedOn(r), false)}</td></tr>)}</tbody></table>
        </Section>}

        <footer className="ex-foot">Sources: SEBI, NSE and BSE filings and the offer documents themselves; every figure can be traced in the terminal. Lock-in dates and growth rates marked “calculated” are computed by the terminal. This report is for internal discussion and is not investment advice.</footer>
      </article>
    </div>
  )
}

