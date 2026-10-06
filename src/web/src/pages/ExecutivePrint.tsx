import { useId, useMemo, useState } from 'react'
import { useVault } from '../App'
import { Seg } from '../components/ui'
import { chrono, forecastCagr, seriesCagr } from '../components/IndustryCharts'
import { allLockins, byId, cmp, dayChangePct, ipo, isMine, isStub, listedOn, listingGainPct, nextEvent, returnVsIssuePct, upcomingEvents } from '../lib/derive'
import { daysUntil, fmtDate, fmtFact, fv, inr, isoToday, pct } from '../lib/format'
import { intelKey } from '../lib/portfolio'
import { finModel, fmtFin } from '../lib/fin'
import { brlms, dealSize, filedOn } from './AnchorDesk'
import type { CompanyRecord } from '../lib/types'

/* The Executive Print — a plain black-and-white morning report. Big type, no colour, page breaks between sections,
   built entirely from the data already in the terminal. Windows count calendar days in IST (filings carry a date, not a time). */

const SIGNIFICANT = new Set(['lifecycle', 'price_band', 'issue_price', 'total_issue', 'ISSUE_OPEN', 'ISSUE_CLOSE', 'LISTING', 'RHP_FILED', 'drhp_status'])
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
  const m = finModel(r)
  const { periods } = m
  const fyIdx = periods.map((_, i) => i).filter(i => !isStub(periods[i]))
  const fyP = fyIdx.map(i => periods[i])
  const rowv = (k: string) => m.row(k)?.values ?? []
  const rev = fyIdx.map(i => rowv('rev')[i] ?? null), pat = fyIdx.map(i => rowv('pat')[i] ?? null)
  const revCagr = fyP.length >= 2 ? seriesCagr(fyP, rev, fyP.map(() => false)) : null
  const patCagr = fyP.length >= 2 ? seriesCagr(fyP, pat, fyP.map(() => false)) : null
  const L = m.lastFy, P = m.prevFy
  const at = (k: string, i: number) => (i >= 0 ? m.row(k)?.values[i] ?? null : null)
  const tiles: [string, string, string][] = ([
    ['Revenue', fmtFin(at('rev', L), 'cr'), 'crore'], ['Revenue growth', fmtFin(at('rev_g', L), 'pct'), 'over last year'],
    ['EBITDA', fmtFin(at('ebitda', L), 'cr'), `margin ${fmtFin(at('ebitda_m', L), 'pct')}`], ['Profit after tax', fmtFin(at('pat', L), 'cr'), `margin ${fmtFin(at('pat_m', L), 'pct')}`],
    ['Return on equity', fmtFin(at('roe', L), 'pct'), 'ROE'], ['Return on capital', fmtFin(at('roce', L), 'pct'), 'ROCE'],
    ['Debt to equity', fmtFin(at('de', L), 'x'), 'times'], ['Cash from operations', fmtFin(at('cfo', L), 'cr'), 'CFO, crore'],
  ] as [string, string, string][]).filter(t => t[1] !== '—')
  const story: string[] = []
  if (L >= 0 && at('rev', L) != null) story.push(`In ${periods[L]} the company earned revenue of ₹${fmtFin(at('rev', L), 'cr')} crore${at('rev_g', L) != null ? `, ${at('rev_g', L)! >= 0 ? 'up' : 'down'} ${Math.abs(at('rev_g', L)!).toFixed(1)}% on ${periods[P] ?? 'the year before'}` : ''}.`)
  if (revCagr) story.push(`Over ${revCagr.a.y}–${revCagr.b.y}, sales have grown ${revCagr.pct.toFixed(1)}% a year${patCagr ? ` and profit ${patCagr.pct.toFixed(1)}% a year` : ''}.`)
  if (at('pat', L) != null && at('rev', L)) story.push(`${at('pat', L)! >= 0 ? 'It kept' : 'It lost'} about ₹${Math.abs((at('pat', L)! / at('rev', L)!) * 100).toFixed(1)} of every ₹100 of sales as ${at('pat', L)! >= 0 ? 'profit' : 'loss'} after tax${at('pat_m', P) != null && at('pat_m', L) != null ? ` (it was ₹${at('pat_m', P)!.toFixed(1)} in ${periods[P]})` : ''}.`)
  if (at('roe', L) != null) story.push(`It earns ${at('roe', L)!.toFixed(1)}% a year on the owners' money (ROE)${at('roce', L) != null ? ` and ${at('roce', L)!.toFixed(1)}% on all capital used (ROCE)` : ''}.`)
  if (at('de', L) != null) story.push(at('de', L)! < 0.5 ? `Debt is low: ₹${at('de', L)!.toFixed(2)} borrowed for every ₹1 of owners' money.` : `Debt is ₹${at('de', L)!.toFixed(2)} for every ₹1 of owners' money.`)
  if (at('cfo', L) != null) story.push(`The business generated ₹${fmtFin(at('cfo', L), 'cr')} crore of cash from operations${at('fcf', L) != null ? `; after capital spending, free cash flow was ₹${fmtFin(at('fcf', L), 'cr')} crore` : ''}.`)
  const groups = [...new Set(m.rows.map(x => x.group))]
  const cfChart = m.periods.map((p, i) => ({ p, v: [rowv('cfo')[i] ?? null, rowv('cfi')[i] ?? null, rowv('cff')[i] ?? null] }))
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
        {(r.company.overview?.summary ?? 'Business summary not yet read from the offer document.').split(/\n+/).map((t, i) => <p key={i}>{t}</p>)}
        {r.company.overview?.source?.page ? <p className="ex-small">From “Our Business — Overview”, page {r.company.overview.source.page} of the offer document.</p> : null}
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
      <section className="ex-sec ex-break">
        <h2>{n}. {clean(r.company.name)} — the numbers</h2>
        {m.rows.length ? (
          <>
            <h3>In plain words</h3>
            <ul>{story.map((t, i) => <li key={i}>{t}</li>)}</ul>
            {!!tiles.length && <div className="ex-tiles ex-tiles4">{tiles.map(([l, v, sub]) => <div key={l} className="ex-tile"><b>{v}</b><span>{l}</span><em>{sub}</em></div>)}</div>}
            {groups.map(g => (
              <div key={g}>
                <h3>{g}</h3>
                <table className="ex-table ex-fin"><thead><tr><th>Item</th>{periods.map(p => <th key={p} className="r">{p}{isStub(p) ? '*' : ''}</th>)}</tr></thead>
                  <tbody>{m.rows.filter(x => x.group === g).map(x => (
                    <tr key={x.key}><th>{x.label}{x.calc ? ' †' : ''}<div className="ex-hint">{x.hint}</div></th>{periods.map((p, i) => <td key={p} className="r">{fmtFin(x.values[i], x.unit)}</td>)}</tr>))}</tbody></table>
              </div>))}
            <p className="ex-small">₹ crore unless shown otherwise. Brackets mean a negative number or cash going out. * part-year period. † worked out by the terminal: {[...new Set(m.rows.filter(x => x.calc).map(x => `${x.label.replace(/ \(.*\)/, '')} = ${x.calc}`))].join('; ') || 'none'}. Everything else is as printed in the offer document.</p>
            {fyP.length >= 2 && <>
              <h3>Revenue and profit</h3>
              <Bars periods={fyP} series={[{ name: 'Revenue from operations', values: rev }, { name: 'Profit after tax', values: pat }]} />
              <Legend names={['Revenue from operations', 'Profit after tax']} />
            </>}
            {cfChart.some(c => c.v.some(x => x != null)) && <>
              <h3>Where the cash came from and went</h3>
              <Bars periods={cfChart.map(c => c.p)} series={[{ name: 'Operations (CFO)', values: cfChart.map(c => c.v[0]) }, { name: 'Investing (CFI)', values: cfChart.map(c => c.v[1]) }, { name: 'Financing (CFF)', values: cfChart.map(c => c.v[2]) }]} />
              <Legend names={['Operations (CFO)', 'Investing (CFI)', 'Financing (CFF)']} />
              <p className="ex-small">Operations: cash the business made. Investing: spent on (or received from) assets and investments. Financing: raised from, or repaid to, lenders and owners.</p>
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
    const wk = Date.now() - 7 * 24 * 3_600_000
    const tracked = mine.map(r => {
      const own = r.news.filter(n => new Date(n.published_at).getTime() >= wk).map(n => ({ title: n.title, publisher: n.publisher ?? n.category, at: n.published_at, url: n.url }))
      const web = (v.private_intel?.[intelKey(r.company.name)]?.news ?? []).filter(n => n.published_at && new Date(n.published_at).getTime() >= wk).map(n => ({ title: n.title, publisher: n.publisher ?? 'Web', at: n.published_at!, url: n.url }))
      const seen = new Set<string>()
      const items = [...own, ...web].sort((a, b) => b.at.localeCompare(a.at)).filter(x => { const k = x.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5)
      return { r, items }
    })
    return { tracked, filed, fallback, listings, approvals, changes, news, cal, locks, recentListed, mine }
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

        <Section title="Your companies in the news">
          {d.tracked.some(t => t.items.length) ? d.tracked.filter(t => t.items.length).map(({ r, items }) => (
            <div key={r.company.company_id} className="ex-newsco">
              <h3>{clean(r.company.name)} <span className="ex-small">{cmp(r) != null ? `₹${cmp(r)!.toFixed(2)}` : ''}{dayChangePct(r) != null ? ` (${dayChangePct(r)! >= 0 ? '+' : ''}${dayChangePct(r)!.toFixed(1)}% today)` : ''}</span></h3>
              <ul>{items.map((x, i) => <li key={i}><b>{x.title}</b> <span className="ex-small">— {x.publisher}, {fmtDate(x.at.slice(0, 10), false)}</span></li>)}</ul>
            </div>))
            : <p>{d.tracked.length ? 'No news on your tracked companies in the last 7 days.' : 'You are not tracking any company yet. Tap Track on any company and its news will appear here every morning.'}</p>}
          {d.tracked.some(t => !t.items.length) && d.tracked.some(t => t.items.length) && <p className="ex-small">No news in 7 days: {d.tracked.filter(t => !t.items.length).map(t => clean(t.r.company.name)).join(', ')}.</p>}
        </Section>

        <Section title="The last 24 hours in detail">
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

        <Section title="Reading guide">
          <dl className="ex-gloss">
            {[['EBITDA', 'Operating profit before interest, tax, depreciation and amortisation.'], ['PAT', 'Profit after tax — what is left for the owners.'], ['Margin', 'Profit as a share of sales.'],
              ['ROE', 'Return on equity: profit divided by the owners\' money in the business.'], ['ROCE', 'Return on capital employed: profit before interest and tax divided by all money used in the business.'],
              ['CFO / CFI / CFF', 'Cash from operations / investing / financing.'], ['Free cash flow', 'Operating cash less capital spending.'], ['FCFF', 'Free cash flow to the firm: cash available to lenders and owners together (estimated here at a 25.17% tax rate).'],
              ['DRHP', 'Draft Red Herring Prospectus: the draft offer document filed with SEBI before an IPO.'], ['BRLM', 'Book running lead manager: the investment bank that runs the IPO.'],
              ['Anchor investors', 'Large institutions that buy just before the IPO opens; their shares are locked in for 30 and 90 days.'], ['Lock-in', 'A period during which certain shareholders cannot sell.']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </Section>

        <footer className="ex-foot">Sources: SEBI, NSE and BSE filings and the offer documents themselves; every figure can be traced in the terminal. Lock-in dates and growth rates marked “calculated” are computed by the terminal. This report is for internal discussion and is not investment advice.</footer>
      </article>
    </div>
  )
}

