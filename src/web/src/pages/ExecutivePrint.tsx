import { useId, useMemo } from 'react'
import { useVault } from '../App'
import { chrono, forecastCagr, seriesCagr } from '../components/IndustryCharts'
import { finTable, ipo, isMine, isStub } from '../lib/derive'
import { daysUntil, fmtDate, fmtDateTime, fmtFact, fv, pct } from '../lib/format'
import { intelKey } from '../lib/portfolio'
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

const ONE_PAGER_ROWS: [string, string][] = [['revenue_from_operations', 'Revenue'], ['ebitda', 'EBITDA'], ['ebitda_margin', 'EBITDA margin'],
  ['pat', 'Profit after tax'], ['pat_margin', 'PAT margin'], ['net_worth', 'Net worth'], ['total_borrowings', 'Borrowings'], ['ronw', 'RoNW']]
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + ' …' : t)

/** One page per filing: who they are, the offer, the numbers, the market, the peers. */
function OnePager({ r, n }: { r: CompanyRecord; n: number }) {
  const o = ipo(r)
  const { periods, byMetric } = finTable(r)
  const fy = periods.filter(p => !isStub(p)).slice(-3)
  const cols = [...fy, ...periods.filter(p => isStub(p) && p > (fy[fy.length - 1] ?? '')).slice(-1)]
  const val = (m: string, p: string) => fv(byMetric.get(m)?.get(p))
  const rev = fy.map(p => val('revenue_from_operations', p)), pat = fy.map(p => val('pat', p))
  const revCagr = fy.length >= 2 ? seriesCagr(fy, rev, fy.map(() => false)) : null
  const leads = (brlms(r).length ? brlms(r).map(b => b.name) : o?.intermediaries?.brlms ?? []).map(clean)
  const ind = (r.facts?.industry_series ?? []).filter(s => !s.macro).map(s => {
    const c = chrono(s); const main = c.rows.find(x => /^total$/i.test(x.name.trim())) ?? c.rows[0]
    const g = main ? forecastCagr(c.periods, main.values, c.projected) : null
    return { s, c, main, g, score: (g ? 5 : 0) + (/share|%|growth|y-o-y|yoy/i.test(`${s.unit ?? ''} ${s.title}`) ? -3 : 0) + Math.min(c.periods.length, 8) * 0.1 }
  }).filter(x => x.main && x.c.periods.length >= 3).sort((a, b) => b.score - a.score)[0]
  const peers = (r.facts?.peers ?? []).filter(p => !/our company|\bthe company\b/i.test(p.name) && !p.name.toLowerCase().includes(r.company.name.toLowerCase().split(' ')[0])).slice(0, 4)
  const F = o?.facts ?? {}
  const fresh = fv(F.fresh_issue) ?? fv(F.drhp_fresh_issue), ofs = fv(F.ofs) ?? fv(F.drhp_ofs)
  return (
    <section className="ex-page">
      <div className="ex-ph">
        <div className="ex-ph-n">{n}</div>
        <div className="min-w-0">
          <div className="ex-dossier-title">{r.company.name}</div>
          <div className="ex-sub">{[segLabel(r), r.company.sector, `DRHP filed ${fmtDate(filedOn(r))}`].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="ex-facts">
        <div><span>Issue size</span><b>{dealSize(r).text}</b></div>
        <div><span>Fresh / OFS</span><b>{fresh != null || ofs != null ? `${fresh != null ? `₹${Math.round(fresh).toLocaleString('en-IN')} cr` : '—'} / ${ofs != null ? `₹${Math.round(ofs).toLocaleString('en-IN')} cr` : '—'}` : '—'}</b></div>
        <div><span>Latest revenue</span><b>{rev.length && rev[rev.length - 1] != null ? `₹${Math.round(rev[rev.length - 1]!).toLocaleString('en-IN')} cr` : '—'}</b></div>
        <div><span>Revenue growth</span><b>{revCagr ? `${revCagr.pct.toFixed(1)}% a year` : '—'}</b></div>
      </div>
      <p className="ex-lm"><b>Lead managers:</b> {leads.length ? leads.join(', ') : 'not yet read'}{r.company.promoters?.length ? <> · <b>Promoters:</b> {r.company.promoters.slice(0, 4).join(', ')}</> : null}</p>

      <h3>What the company does</h3>
      <p>{r.company.overview?.summary ? cut(r.company.overview.summary, 650) : 'Business summary will appear once the offer document has been read.'}</p>

      <div className="ex-two">
        <div>
          <h3>Financials (₹ cr)</h3>
          {cols.length ? (
            <table className="ex-table ex-fin"><thead><tr><th></th>{cols.map(p => <th key={p} className="r">{p}{isStub(p) ? '*' : ''}</th>)}</tr></thead>
              <tbody>{ONE_PAGER_ROWS.filter(([m]) => byMetric.has(m)).map(([m, l]) => <tr key={m}><th>{l}</th>{cols.map(p => <td key={p} className="r">{cell(byMetric.get(m)?.get(p))}</td>)}</tr>)}</tbody></table>
          ) : <p className="ex-small">Restated financials not yet read.</p>}
          {fy.length >= 2 && <><Bars periods={fy} series={[{ name: 'Revenue', values: rev }, { name: 'PAT', values: pat }]} /><Legend names={['Revenue', 'PAT']} /></>}
        </div>
        <div>
          <h3>The market</h3>
          {ind ? (
            <figure className="ex-fig">
              <figcaption><b>{ind.s.title}</b>{ind.s.unit ? <span className="ex-small"> · {ind.s.unit}</span> : null}</figcaption>
              <Bars periods={ind.c.periods} projected={ind.c.projected} series={[ind.main!]} />
              <p className="ex-small">{ind.g ? `Forecast growth ${ind.g.pct.toFixed(1)}% a year (${ind.g.a.p}–${ind.g.b.p}). ` : ''}{ind.c.projected.some(Boolean) ? 'Outlined bars are projections. ' : ''}p.{ind.s.page} of the DRHP.</p>
            </figure>
          ) : <p className="ex-small">Industry data not yet read.</p>}
          {!!peers.length && <>
            <h3>Listed peers</h3>
            <table className="ex-table ex-fin"><thead><tr><th>Peer</th><th className="r">P/E</th><th className="r">RoNW</th></tr></thead>
              <tbody>{peers.map(p => <tr key={p.name}><th>{clean(p.name.replace(/\s*\((consolidated|standalone)[^)]*\)/i, ''))}</th><td className="r">{(p.live?.pe ?? p.pe) != null ? `${(p.live?.pe ?? p.pe)!.toFixed(1)}x` : '—'}</td><td className="r">{p.ronw != null ? pct(p.ronw) : '—'}</td></tr>)}</tbody></table>
          </>}
        </div>
      </div>
    </section>
  )
}

export default function ExecutivePrint() {
  const v = useVault()
  const filed = useMemo(() => v.companies
    .filter(r => r.company.lifecycle !== 'WITHDRAWN' && !r.company.is_sample && !r.custom)
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
      return { r, items: items.filter(x => { const k = x.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 4) }
    }).filter(x => x.items.length).sort((a, b) => b.items[0].t.localeCompare(a.items[0].t))
  }, [v])
  const tracked = v.companies.filter(r => isMine(v, r.company.company_id)).length
  const stamp = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const leads = (r: CompanyRecord) => (brlms(r).length ? brlms(r).map(b => b.name) : ipo(r)?.intermediaries?.brlms ?? []).map(clean)

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
          <div className="ex-tag">DRHPs filed in the last day · one-pagers · news on your companies</div>
        </header>

        <section className="ex-sec">
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

        {filed.map((r, i) => <OnePager key={r.company.company_id} r={r} n={i + 1} />)}

        <section className="ex-sec ex-break">
          <h2>News on your tracked companies · last 7 days</h2>
          {!tracked ? <p className="ex-empty">You aren't tracking any companies yet — press ◎ Track or ★ Add to portfolio on a company.</p>
            : news.length ? news.map(({ r, items }) => (
              <div key={r.company.company_id} className="ex-news">
                <div className="ex-news-co">{clean(r.company.name)}</div>
                <ul>{items.map((x, i) => <li key={i}>{x.url?.startsWith('http') ? <a href={x.url} target="_blank" rel="noreferrer">{x.title}</a> : x.title} <span className="ex-small">— {x.src}, {fmtDateTime(x.t)}</span></li>)}</ul>
              </div>))
            : <p className="ex-empty">No news on your {tracked} tracked compan{tracked === 1 ? 'y' : 'ies'} in the last 7 days.</p>}
        </section>

        <footer className="ex-foot">Sources: SEBI, NSE and BSE filings, the offer documents, exchange announcements and Google News. Growth rates are calculated by the terminal from printed figures. For internal discussion; not investment advice.</footer>
      </article>
    </div>
  )
}
