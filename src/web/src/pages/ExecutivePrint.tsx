import { useId, useMemo } from 'react'
import { useVault } from '../App'
import { chrono, forecastCagr, seriesCagr } from '../components/IndustryCharts'
import { ipo, isLiveDrhp, isMine, isStub, dayChangePct, cmp } from '../lib/derive'
import { goodOverview } from '../lib/overview'
import { finModel, fmtFin } from '../lib/fin'
import { daysUntil, fmtDate, fmtFact, fv, isoToday } from '../lib/format'
import { intelKey } from '../lib/portfolio'
import { brlms, dealSize, filedOn } from './AnchorDesk'
import type { CompanyRecord } from '../lib/types'

/* The Executive Print — a plain black-and-white morning report. Big type, no colour, page breaks between sections,
   built entirely from the data already in the terminal. Windows count calendar days in IST (filings carry a date, not a time). */

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

const GLOSSARY: [string, string][] = [['EBITDA', 'Operating profit before interest, tax, depreciation and amortisation.'], ['PAT', 'Profit after tax: what is left for the owners.'],
  ['Margin', 'Profit as a share of sales.'], ['ROE', 'Return on equity: profit divided by the owners\' money in the business.'], ['ROCE', 'Return on capital employed: profit before interest and tax divided by all the money used in the business.'],
  ['CFO / CFI / CFF', 'Cash from operations / investing / financing.'], ['Free cash flow', 'Operating cash less capital spending.'], ['FCFF', 'Free cash flow to the firm: cash available to lenders and owners together (estimated at a 25.17% tax rate).'],
  ['DRHP', 'Draft Red Herring Prospectus: the draft offer document filed with SEBI before an IPO.'], ['BRLM', 'Book running lead manager: the investment bank that runs the IPO.']]

const OFFER_KEYS = ['offer_type', 'total_issue', 'fresh_issue', 'ofs', 'drhp_total_issue', 'drhp_fresh_issue', 'drhp_ofs', 'drhp_total_issue_shares', 'drhp_fresh_issue_shares', 'drhp_ofs_shares',
  'pre_issue_shares', 'face_value', 'lot_size', 'eligibility_regulation', 'anchor_portion_contemplated', 'pre_ipo_placement_contemplated']

/** One filing, in full: the business, the offer, the numbers in plain words, cash flow, the market and its listed peers. */
function Dossier({ r, n }: { r: CompanyRecord; n: number }) {
  const o = ipo(r), F = o?.facts ?? {}
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
  const tiles = ([['Revenue', fmtFin(at('rev', L), 'cr'), '₹ crore'], ['Revenue growth', fmtFin(at('rev_g', L), 'pct'), 'on last year'], ['EBITDA', fmtFin(at('ebitda', L), 'cr'), `margin ${fmtFin(at('ebitda_m', L), 'pct')}`],
    ['Profit after tax', fmtFin(at('pat', L), 'cr'), `margin ${fmtFin(at('pat_m', L), 'pct')}`], ['Return on equity', fmtFin(at('roe', L), 'pct'), 'ROE'], ['Return on capital', fmtFin(at('roce', L), 'pct'), 'ROCE'],
    ['Debt to equity', fmtFin(at('de', L), 'x'), 'times'], ['Cash from operations', fmtFin(at('cfo', L), 'cr'), 'CFO, ₹ crore']] as [string, string, string][]).filter(t => t[1] !== '—')
  const story: string[] = []
  if (L >= 0 && at('rev', L) != null) story.push(`In ${periods[L]} the company earned revenue of ₹${fmtFin(at('rev', L), 'cr')} crore${at('rev_g', L) != null ? `, ${at('rev_g', L)! >= 0 ? 'up' : 'down'} ${Math.abs(at('rev_g', L)!).toFixed(1)}% on ${periods[P] ?? 'the year before'}` : ''}.`)
  if (revCagr) story.push(`Over ${revCagr.a.y}–${revCagr.b.y}, sales have grown ${revCagr.pct.toFixed(1)}% a year${patCagr ? ` and profit ${patCagr.pct.toFixed(1)}% a year` : ''}.`)
  if (at('pat', L) != null && at('rev', L)) story.push(`${at('pat', L)! >= 0 ? 'It kept' : 'It lost'} about ₹${Math.abs((at('pat', L)! / at('rev', L)!) * 100).toFixed(1)} of every ₹100 of sales as ${at('pat', L)! >= 0 ? 'profit' : 'loss'} after tax${at('pat_m', P) != null && at('pat_m', L) != null ? ` (₹${at('pat_m', P)!.toFixed(1)} in ${periods[P]})` : ''}.`)
  if (at('roe', L) != null) story.push(`It earns ${at('roe', L)!.toFixed(1)}% a year on the owners' money (ROE)${at('roce', L) != null ? ` and ${at('roce', L)!.toFixed(1)}% on all capital used (ROCE)` : ''}.`)
  if (at('de', L) != null) story.push(at('de', L)! < 0.5 ? `Debt is low: ₹${at('de', L)!.toFixed(2)} borrowed for every ₹1 of owners' money.` : `Debt is ₹${at('de', L)!.toFixed(2)} for every ₹1 of owners' money.`)
  if (at('cfo', L) != null) story.push(`The business generated ₹${fmtFin(at('cfo', L), 'cr')} crore of cash from operations${at('fcf', L) != null ? `; after capital spending, free cash flow was ₹${fmtFin(at('fcf', L), 'cr')} crore` : ''}.`)
  const groups = [...new Set(m.rows.map(x => x.group))]
  const cf = periods.map((p, i) => ({ p, v: [rowv('cfo')[i] ?? null, rowv('cfi')[i] ?? null, rowv('cff')[i] ?? null] }))
  const leads = (brlms(r).length ? brlms(r).map(b => b.name) : o?.intermediaries?.brlms ?? []).map(clean)
  const offer = OFFER_KEYS.filter(k => F[k] && F[k].status !== 'not_available').map(k => F[k])
  const industry = (r.facts?.industry_series ?? []).filter(s => !s.macro).map(s => {
    const c = chrono(s); const main = c.rows.find(x => /^total$/i.test(x.name.trim())) ?? c.rows[0]
    const g = main ? forecastCagr(c.periods, main.values, c.projected) : null
    const h = main ? seriesCagr(c.periods, main.values, c.projected, true) : null
    return { s, c, g, h, main, score: (g ? 4 : 0) + (h ? 1 : 0) + (/share|%|growth|y-o-y|yoy/i.test(`${s.unit ?? ''} ${s.title}`) ? -3 : 0) + Math.min(c.periods.length, 8) * 0.1 }
  }).filter(x => x.main && x.c.periods.length >= 3).sort((a, b) => b.score - a.score).slice(0, 3)
  const claims = (r.facts?.industry_claims ?? []).slice(0, 3)
  const peers = (r.facts?.peers ?? []).filter(p => !/our company|\bthe company\b/i.test(p.name) && !p.name.toLowerCase().includes(r.company.name.toLowerCase().split(' ')[0])).slice(0, 6)
  const fresh = fv(F.fresh_issue) ?? fv(F.drhp_fresh_issue), ofs = fv(F.ofs) ?? fv(F.drhp_ofs)
  const crs = (x: number | null) => (x != null ? `₹${Math.round(x).toLocaleString('en-IN')} cr` : '—')
  const facts = ([['Issue size', dealSize(r).text], ['Fresh issue', fresh != null ? crs(fresh) : '—'], ['Offer for sale', ofs != null ? crs(ofs) : '—'],
    ['Latest revenue', crs(at('rev', L))], ['Revenue growth', revCagr ? `${revCagr.pct.toFixed(1)}% a year` : '—']] as [string, string][]).filter(f => f[1] !== '—').slice(0, 4)
  const about = goodOverview(r.company.overview?.summary) ? r.company.overview!.summary : null
  return (
    <>
      <section className="ex-page">
        <div className="ex-ph">
          <div className="ex-ph-n">{n}</div>
          <div className="min-w-0">
            <div className="ex-dossier-title">{r.company.name}</div>
            <div className="ex-sub">{[segLabel(r), r.company.sector, `DRHP filed ${fmtDate(filedOn(r))}`, r.company.drhp_status && `SEBI: ${r.company.drhp_status}`].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        {facts.length >= 2 && <div className="ex-facts">{facts.map(([l, v]) => <div key={l}><span>{l}</span><b>{v}</b></div>)}</div>}
        {(leads.length > 0 || !!r.company.promoters?.length) && <p className="ex-lm">{leads.length > 0 && <><b>Lead managers:</b> {leads.join(', ')}</>}{leads.length > 0 && !!r.company.promoters?.length && ' · '}{!!r.company.promoters?.length && <><b>Promoters:</b> {r.company.promoters.join(', ')}</>}</p>}
        <h3>What the company does</h3>
        {about ? <>{about.split(/\n+/).map((t, i) => <p key={i}>{t}</p>)}
          {r.company.overview?.source?.page ? <p className="ex-small">From “Our Business — Overview”, page {r.company.overview.source.page} of the offer document.</p> : null}</>
          : <p className="ex-small">The business description could not be read reliably from the offer document yet. It will appear in the next edition once the document has been re-read.</p>}
        {(offer.length > 0 || dealSize(r).text !== '—' || !!o?.intermediaries?.registrar) && <><h3>The offer</h3>
        <table className="ex-table"><tbody>
          {dealSize(r).text !== '—' && <tr><th>Size</th><td>{dealSize(r).text}</td></tr>}
          {offer.map(f => <tr key={f.metric}><th>{f.label ?? f.metric.replace(/_/g, ' ')}</th><td>{typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : fmtFact(f)}</td></tr>)}
          {o?.intermediaries?.registrar && <tr><th>Registrar</th><td>{clean(o.intermediaries.registrar)}</td></tr>}
        </tbody></table></>}
        {!!brlms(r).filter(c => c.email).length && <p className="ex-small">Deal-team contacts: {brlms(r).filter(c => c.email).slice(0, 4).map(c => `${clean(c.name)} — ${c.email}`).join(' · ')}</p>}
      </section>

      <section className="ex-page">
        <div className="ex-ph"><div className="ex-ph-n">{n}</div><div><div className="ex-dossier-title">{clean(r.company.name)} — the numbers</div><div className="ex-sub">₹ crore unless shown otherwise · from the restated financials in the offer document</div></div></div>
        {m.rows.length ? (
          <>
            <h3>In plain words</h3>
            <ul>{story.map((t, i) => <li key={i}>{t}</li>)}</ul>
            {!!tiles.length && <div className="ex-facts ex-facts4">{tiles.map(([l, v, sub]) => <div key={l}><span>{l}</span><b>{v}</b><em>{sub}</em></div>)}</div>}
            {groups.map(g => (
              <div key={g}>
                <h3>{g}</h3>
                <table className="ex-table ex-fin"><thead><tr><th>Item</th>{periods.map(p => <th key={p} className="r">{p}{isStub(p) ? '*' : ''}</th>)}</tr></thead>
                  <tbody>{m.rows.filter(x => x.group === g).map(x => (
                    <tr key={x.key}><th>{x.label}{x.calc ? ' †' : ''}<div className="ex-hint">{x.hint}</div></th>{periods.map((p, i) => <td key={p} className="r">{fmtFin(x.values[i], x.unit)}</td>)}</tr>))}</tbody></table>
              </div>))}
            <p className="ex-small">Brackets mean a negative number or cash going out. * part-year period. † worked out by the terminal: {[...new Set(m.rows.filter(x => x.calc).map(x => `${x.label.replace(/ \(.*\)/, '')} = ${x.calc}`))].join('; ') || 'none'}. Everything else is as printed in the offer document.</p>
            {m.notes.map((t, i) => <p key={i} className="ex-small">{t}</p>)}
            {fyP.length >= 2 && <><h3>Revenue and profit</h3><Bars periods={fyP} series={[{ name: 'Revenue from operations', values: rev }, { name: 'Profit after tax', values: pat }]} /><Legend names={['Revenue from operations', 'Profit after tax']} /></>}
            {cf.some(c => c.v.some(x => x != null)) && <>
              <h3>Where the cash came from and went</h3>
              <Bars periods={cf.map(c => c.p)} series={[{ name: 'Operations (CFO)', values: cf.map(c => c.v[0]) }, { name: 'Investing (CFI)', values: cf.map(c => c.v[1]) }, { name: 'Financing (CFF)', values: cf.map(c => c.v[2]) }]} />
              <Legend names={['Operations (CFO)', 'Investing (CFI)', 'Financing (CFF)']} />
              <p className="ex-small">Operations: cash the business made. Investing: spent on (or received from) assets and investments. Financing: raised from, or repaid to, lenders and owners.</p>
            </>}
          </>
        ) : <p className="ex-empty">The offer document is still being read — restated financials will appear in the next edition.</p>}
      </section>

      {(industry.length > 0 || claims.length > 0 || peers.length > 0) && <section className="ex-page">
        <div className="ex-ph"><div className="ex-ph-n">{n}</div><div><div className="ex-dossier-title">{clean(r.company.name)} — the market</div></div></div>
        {industry.length ? industry.map(({ s, c, g, h }, i) => (
          <figure key={i} className="ex-fig">
            <figcaption><b>{s.title}</b><span className="ex-small"> · {[s.unit, `page ${s.page} of the offer document`].filter(Boolean).join(' · ')}</span></figcaption>
            <Bars periods={c.periods} projected={c.projected} series={c.rows.length === 1 ? c.rows : c.rows.filter(x => !/^total$/i.test(x.name.trim())).slice(0, 3)} />
            {c.rows.length > 1 && <Legend names={c.rows.filter(x => !/^total$/i.test(x.name.trim())).slice(0, 3).map(x => x.name)} />}
            <p className="ex-small">{c.projected.some(Boolean) ? 'Outlined bars are estimates or projections. ' : ''}{g ? `Forecast growth ${g.pct.toFixed(1)}% a year (${g.a.p}–${g.b.p}).` : h ? `Historical growth ${h.pct.toFixed(1)}% a year.` : ''}</p>
          </figure>)) : <p className="ex-empty">Industry data not yet read from the offer document.</p>}
        {!!claims.length && <ul>{claims.map((c, i) => <li key={i}>{c.text}{c.cagr_pct != null ? ` (growth ${c.cagr_pct}% a year)` : ''} <span className="ex-small">p.{c.page}</span></li>)}</ul>}
        {!!peers.length && <>
          <h3>Listed peers named in the document</h3>
          <table className="ex-table ex-fin"><thead><tr><th>Peer</th><th className="r">P/E</th><th className="r">P/B</th><th className="r">RoNW %</th></tr></thead>
            <tbody>{peers.map(p => <tr key={p.name}><th>{clean(p.name.replace(/\s*\((consolidated|standalone)[^)]*\)/i, ''))}</th><td className="r">{(p.live?.pe ?? p.pe) != null ? (p.live?.pe ?? p.pe)!.toFixed(1) : '—'}</td><td className="r">{(p.live?.pb ?? p.pb) != null ? (p.live?.pb ?? p.pb)!.toFixed(2) : '—'}</td><td className="r">{p.ronw != null ? p.ronw.toFixed(1) : '—'}</td></tr>)}</tbody></table>
        </>}
      </section>}
    </>
  )
}

export default function ExecutivePrint() {
  const v = useVault()
  const filed = useMemo(() => v.companies
    .filter(r => r.company.lifecycle !== 'WITHDRAWN' && !r.company.is_sample && !r.custom && isLiveDrhp(r))
    .filter(r => { const f = filedOn(r); return !!f && daysUntil(f) <= 0 && daysUntil(f) >= -1 })
    .sort((a, b) => filedOn(b)!.localeCompare(filedOn(a)!) || (fv(dealSize(b).f) ?? 0) - (fv(dealSize(a).f) ?? 0)), [v])
  const news = useMemo(() => {
    const cutoff = Date.now() - 7 * 864e5
    return v.companies.filter(r => isMine(v, r.company.company_id)).map(r => {
      const items = [
        ...r.news.map(n => ({ t: n.published_at, title: n.title, url: n.url, src: n.tier === 'official' ? (n.publisher ?? 'Exchange') : (n.publisher ?? 'Media') })),
        ...(v.private_intel?.[intelKey(r.company.name)]?.news ?? []).map(n => ({ t: n.published_at ?? '', title: n.title, url: n.url, src: n.publisher ?? 'Web' })),
      ].filter(x => x.t && Date.parse(x.t) >= cutoff).sort((a, b) => b.t.localeCompare(a.t))
      const seen = new Set<string>()
      return { r, items: items.filter(x => { const k = x.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5) }
    }).filter(x => x.items.length).sort((a, b) => b.items[0].t.localeCompare(a.items[0].t))
  }, [v])
  const tracked = v.companies.filter(r => isMine(v, r.company.company_id)).length
  const stamp = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const hr = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }))
  const part = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'
  const leads = (r: CompanyRecord) => (brlms(r).length ? brlms(r).map(b => b.name) : ipo(r)?.intermediaries?.brlms ?? []).map(clean)
  void isoToday

  return (
    <div className="exec-wrap">
      <div className="exec-noprint exec-bar">
        <a className="btn" href="#/">← Home</a>
        <button className="btn btn-primary" onClick={() => window.print()}>⎙ Print / Save as PDF</button>
      </div>
      <article className="exec">
        <header className="ex-mast">
          <div className="ex-eyebrow">Private &amp; confidential · {stamp}</div>
          <h1>The Executive Print</h1>
          <div className="ex-hello">Good {part}.</div>
          <p className="ex-lead">Here are the top happenings from the IPO pipeline in the last 24 hours: {filed.length ? `${filed.length} new DRHP filing${filed.length === 1 ? '' : 's'}` : 'no new DRHP filings'}{tracked ? `, and the latest news on your ${tracked} tracked compan${tracked === 1 ? 'y' : 'ies'}` : ''}.</p>
        </header>

        <section className="ex-sec">
          <h2>News on your tracked companies · last 7 days</h2>
          {!tracked ? <p className="ex-empty">You aren't tracking any companies yet — press ◎ Track or ★ Add to portfolio on a company.</p>
            : news.length ? news.map(({ r, items }) => (
              <div key={r.company.company_id} className="ex-news">
                <div className="ex-news-co">{clean(r.company.name)}{cmp(r) != null && <span className="ex-small"> · ₹{cmp(r)!.toFixed(2)}{dayChangePct(r) != null ? ` (${dayChangePct(r)! >= 0 ? '+' : ''}${dayChangePct(r)!.toFixed(1)}% today)` : ''}</span>}</div>
                <ul>{items.map((x, i) => <li key={i}>{x.url?.startsWith('http') ? <a href={x.url} target="_blank" rel="noreferrer">{x.title}</a> : x.title} <span className="ex-small">— {x.src}, {fmtDate(x.t.slice(0, 10), false)}</span></li>)}</ul>
              </div>))
            : <p className="ex-empty">No news on your {tracked} tracked compan{tracked === 1 ? 'y' : 'ies'} in the last 7 days.</p>}
        </section>

        <section className="ex-sec ex-break">
          <h2>DRHPs filed in the last day</h2>
          {filed.length ? (
            <table className="ex-table">
              <thead><tr><th>#</th><th>Company</th><th>Segment</th><th className="r">Size</th><th>Lead managers</th></tr></thead>
              <tbody>{filed.map((r, i) => (
                <tr key={r.company.company_id}>
                  <td className="ex-num">{i + 1}</td>
                  <th>{clean(r.company.name)}{r.company.sector && <div className="ex-small">{r.company.sector}</div>}</th>
                  <td>{segLabel(r)}</td>
                  <td className="r">{dealSize(r).text}</td>
                  <td className="ex-small">{leads(r).join(', ') || '—'}</td>
                </tr>))}</tbody>
            </table>
          ) : <p className="ex-empty">No DRHPs were filed in the last day.</p>}
        </section>

        {filed.map((r, i) => <Dossier key={r.company.company_id} r={r} n={i + 1} />)}

        <section className="ex-page">
          <h2>Reading guide</h2>
          <dl className="ex-gloss">{GLOSSARY.map(([k, d]) => <div key={k}><dt>{k}</dt><dd>{d}</dd></div>)}</dl>
        </section>

        <footer className="ex-foot">Sources: SEBI, NSE and BSE filings, the offer documents, exchange announcements and Google News. Growth rates and items marked † are calculated by the terminal from printed figures. For internal discussion; not investment advice.</footer>
      </article>
    </div>
  )
}
