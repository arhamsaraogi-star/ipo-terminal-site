import { useMemo, useState } from 'react'
import { screenerUrl } from '../lib/portfolio'
import { parseScreener } from '../lib/screener'
import { goodOverview } from '../lib/overview'
import { finModel, fmtFin } from '../lib/fin'
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePf, useVault } from '../App'
import { Card, Delta, FactValue, Pill, Seg, SourceLine, Stage, Table } from '../components/ui'
import {
  byId, cmp, dayChangePct, finTable, holdingMarks, ipo, isHeld, isStub, issuePrice, issueSize, latest,
  listedOn, listingGainPct, listingOpen, mcapAtIssue, mcapNow, nextEvent, priceBand, quote, returnVsIssuePct, valuationInputs,
} from '../lib/derive'
import { crore, daysUntil, fmtDate, fmtDateTime, fv, humanize, inr, num, pct, shares, urgency } from '../lib/format'
import type { CompanyRecord, Fact, Holding } from '../lib/types'
import { holder } from './Dashboard'
import { anchorOutcome, expectedWindow, timelineStats } from '../lib/derive'
import { PrivateView } from './PrivateCo'
import { TrackButton } from '../components/Track'
import { WebIntel } from '../components/WebNews'
import { IndustryCharts } from '../components/IndustryCharts'
import { brlms, dealSize, filedOn } from './AnchorDesk'

const TABS = ['Overview', 'Financials', 'Valuation', 'Industry', 'IPO & lock-ins', 'Filings & news'] as const
type Tab = typeof TABS[number]

export default function CompanyPage({ id }: { id: string }) {
  const v = useVault()
  const [tab, setTab] = useState<Tab>('Overview')
  const [form, setForm] = useState(false)
  const r = byId(v, v.redirects?.[id] ?? id)
  if (!r) return <div className="glass p-10">Company not found. <a href="#/ipos/pipeline">Back to pipeline</a></div>
  if (r.custom) return <PrivateView r={r} />
  const c = r.company
  const cid = c.company_id
  const held = isHeld(v, cid)

  return (
    <div className="space-y-5">
      <header className="glass glass-strong p-5 md:p-6 fade-in">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Stage s={c.lifecycle} />
              <Pill tone={c.segment === 'SME' ? 'amber' : 'slate'}>{c.segment === 'SME' ? 'SME' : c.segment === 'MAINBOARD' ? 'Mainboard' : 'Segment TBC'}</Pill>
              {c.drhp_status && <Pill tone="violet">{c.drhp_status}</Pill>}
              {held && <Pill tone="amber">★ In portfolio</Pill>}
            </div>
            <h1 className="display text-[28px] md:text-[36px] font-bold leading-tight">{c.name}</h1>
            <p className="muted mt-1 text-sm">{[c.identifiers.nse_symbol && `NSE: ${c.identifiers.nse_symbol}`, c.identifiers.isin, c.identifiers.cin && `CIN ${c.identifiers.cin}`,
              c.website && <a key="w" href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, '')}</a>].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-primary" onClick={() => setForm(f => !f)}>{held ? '★ Edit holding' : '★ Add to portfolio'}</button>
            <TrackButton id={cid} />
            {c.identifiers.nse_symbol && <a className="btn hide-phone" href={screenerUrl(c.identifiers.nse_symbol)} target="_blank" rel="noreferrer" title="Open on Screener (uses your own login)">Screener ↗</a>}
            <button className="btn hide-phone" onClick={() => window.print()} title="One-page brief for an investment committee">⎙ IC brief</button>
          </div>
        </div>
        <MetricStrip r={r} />
        {form && <HoldingForm r={r} onDone={() => setForm(false)} />}
        <div className="seg mt-5">{TABS.map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      </header>

      {tab === 'Overview' && <Overview r={r} />}
      {tab === 'Financials' && <Financials r={r} />}
      {tab === 'Valuation' && <Valuation r={r} />}
      {tab === 'Industry' && <Industry r={r} />}
      {tab === 'IPO & lock-ins' && <div className="space-y-5"><IpoTab r={r} /><LockinTab r={r} /><Timeline r={r} /></div>}
      {tab === 'Filings & news' && <div className="space-y-5"><NewsTab r={r} /><WebIntel name={r.company.name} pending={false} /><Docs r={r} /></div>}
    </div>
  )
}

// ───────── header metrics ─────────
function M({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="min-w-0"><div className="eyebrow">{label}</div><div className="display text-[22px] md:text-[26px] font-semibold leading-tight mt-0.5">{children}</div>{sub && <div className="muted text-xs mt-0.5">{sub}</div>}</div>
}
function MetricStrip({ r }: { r: CompanyRecord }) {
  const vv = useVault()
  const et = vv.event_types
  const win = useMemo(() => expectedWindow(r, timelineStats(vv, r.company.segment)), [vv, r])
  const q = quote(r), listed = listedOn(r)
  const sub = ipo(r)?.subscription?.total_times
  if (q || listed) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mt-5">
        <M label={`Price${q ? ` · ${fmtDate(q.date, false)}` : ''}`} sub={<Delta v={dayChangePct(r)} />}>{inr(cmp(r), 2)}</M>
        <M label="vs issue price" sub={`Issue ${inr(issuePrice(r))}`}><Delta v={returnVsIssuePct(r)} /></M>
        <M label="Listing gain" sub={listingOpen(r) ? `Opened ${inr(listingOpen(r), 2)}` : undefined}><Delta v={listingGainPct(r)} /></M>
        <M label="Market cap" sub={mcapAtIssue(r) ? `${crore(mcapAtIssue(r))} at issue` : undefined}>{crore(mcapNow(r))}</M>
        <M label="Issue size" sub={sub != null ? `Subscribed ${sub.toFixed(1)}x` : undefined}>{crore(issueSize(r))}</M>
        <M label="Listed" sub={listed ? `${-daysUntil(listed)} days ago` : undefined}>{fmtDate(listed)}</M>
      </div>
    )
  }
  const ds = dealSize(r)
  const ne = nextEvent(r)
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5">
      <M label="Filed" sub={filedOn(r) ? `${-daysUntil(filedOn(r)!)} days ago` : undefined}>{fmtDate(filedOn(r))}</M>
      <M label="Size (as filed)">{ds.text}</M>
      <M label="Price band">{priceBand(r)}</M>
      {ne ? <M label="Next milestone" sub={fmtDate(ne.date)}><span className="text-[17px]">{et[ne.event_type]?.label ?? humanize(ne.event_type)}</span></M>
        : win ? <M label="Expected issue window" sub={`typical for ${r.company.segment === 'SME' ? 'SME' : 'mainboard'} · ${win.n} past issues`}><span className="text-[17px]">{monthYear(win.from)} – {monthYear(win.to)}</span></M>
        : <M label="Next milestone">—</M>}
      <M label="Lead managers"><span className="text-[15px] font-medium">{brlms(r).map(b => b.name.replace(/ (Private )?Limited$/i, '')).join(', ') || '—'}</span></M>
    </div>
  )
}

// ───────── price chart ─────────
function PriceChart({ r }: { r: CompanyRecord }) {
  const [range, setRange] = useState<'1M' | '3M' | '6M' | 'ALL'>('ALL')
  const hist = r.market?.history ?? []
  const data = useMemo(() => {
    const n = { '1M': 22, '3M': 66, '6M': 130, ALL: 100000 }[range]
    return hist.slice(-n).map(([d, c]) => ({ d, c }))
  }, [hist, range])
  if (hist.length < 2) return null
  const ip = issuePrice(r)
  const up = data.length > 1 && data[data.length - 1].c >= (ip ?? data[0].c)
  const color = up ? 'var(--pos)' : 'var(--neg)'
  return (
    <Card title="Price since listing" action={<Seg value={range} onChange={setRange} options={[{ v: '1M', label: '1M' }, { v: '3M', label: '3M' }, { v: '6M', label: '6M' }, { v: 'ALL', label: 'All' }]} />} solid>
      <div style={{ height: 240 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="d" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} tickFormatter={d => fmtDate(d, false)} />
            <YAxis tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} width={48} />
            <Tooltip contentStyle={{ background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12 }} labelFormatter={d => fmtDate(String(d))} formatter={(x) => [inr(Number(x), 2), 'Close']} />
            {ip && <ReferenceLine y={ip} stroke="var(--ink-3)" strokeDasharray="4 4" label={{ value: `Issue ₹${ip}`, fill: 'var(--ink-3)', fontSize: 11, position: 'insideTopLeft' }} />}
            <Area type="monotone" dataKey="c" stroke={color} strokeWidth={2} fill="url(#pg)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="muted text-xs">End-of-day closes, NSE archives (delayed).</p>
    </Card>
  )
}

const monthYear = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

// ───────── anchor economics for a listed IPO ─────────
function AnchorCard({ r }: { r: CompanyRecord }) {
  const o = anchorOutcome(r)
  if (!o) return null
  const step = (l: string, d: string | null, v: number | null, note?: string) => (
    <div className="glass p-3"><div className="eyebrow">{l}</div><div className="display text-[22px] font-semibold"><Delta v={v} /></div><div className="muted text-xs">{d ? fmtDate(d, false) : ''}{note ? ` · ${note}` : ''}</div></div>)
  return (
    <Card title="If you were an anchor" solid>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {step('Listing open', o.listed, o.rOpen)}
        {step('Day-30 unlock (50%)', o.d30, o.r30, o.r30 == null ? 'not yet' : undefined)}
        {step('Day-90 unlock (50%)', o.d90, o.r90, o.r90 == null ? 'not yet' : undefined)}
        {step('Today', null, o.rNow)}
        <div className="glass p-3" style={{ outline: '1px solid var(--accent)' }}><div className="eyebrow">Anchor return</div><div className="display text-[22px] font-semibold"><Delta v={o.blended} /></div><div className="muted text-xs">{o.final ? 'final · 50/50 exit at unlocks' : 'so far · open legs marked at today'}</div></div>
      </div>
      <p className="muted text-xs mt-2">Bought at the issue price ₹{o.ip}; anchor lock-ins run 30 days (50%) and 90 days (50%) from allotment ({fmtDate(o.allot)}). Exchange closing prices.</p>
    </Card>
  )
}

// ───────── overview ─────────
function ReadMore({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return <div><p className={`ink2 text-[15px] leading-relaxed ${open ? '' : 'clamp-m'}`}>{text}</p>
    {text.length > 320 && <button className="text-sm mt-1" style={{ color: 'var(--accent)' }} onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Read more'}</button>}</div>
}

/** Latest financials for a listed company: import the Excel file Screener (Pro) exports. Stays in your account, synced across devices. */
function ScreenerImportCard({ r }: { r: CompanyRecord }) {
  const { pf, setPf } = usePf()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const id = r.company.company_id
  const sym = r.company.identifiers.nse_symbol
  if (r.custom || r.company.lifecycle !== 'LISTED') return null
  const pick = async (f?: File | null) => {
    if (!f) return
    setBusy(true); setErr('')
    try {
      const imp = parseScreener(await f.arrayBuffer(), id)
      setPf({ ...pf, imports: [...(pf.imports ?? []).filter(x => x.company_id !== id), imp] })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const periods = r.imported ? [...new Set((r.facts?.financials ?? []).map(f => f.period).filter(Boolean) as string[])].sort() : []
  return (
    <Card title="Latest financials" solid>
      {r.imported ? (
        <>
          <p className="ink2">Annual numbers below come from your Screener export{periods.length ? ` (${periods[0]}–${periods[periods.length - 1]})` : ''}, imported {fmtDate(r.imported.imported_at.slice(0, 10))}. Re-import any time to refresh.</p>
          {!!r.imported.quarters.length && (
            <Table rows={r.imported.quarters.slice(0, 8)} cols={[
              { key: 'p', label: 'Quarter ended', render: x => <b>{fmtDate(x.period_end)}</b> },
              { key: 'i', label: 'Sales (₹ cr)', right: true, render: x => (x.income != null ? num(x.income, 1) : '—') },
              { key: 'a', label: 'Net profit (₹ cr)', right: true, render: x => (x.pat != null ? num(x.pat, 1) : '—') },
            ]} />)}
        </>
      ) : (
        <ol className="ink2 text-[15px] space-y-1 list-decimal pl-5">
          <li>Open this company on Screener{sym ? <> — <a href={screenerUrl(sym)} target="_blank" rel="noreferrer">screener.in/company/{sym} ↗</a></> : ''} while signed in to your Pro account.</li>
          <li>Click <b>Export to Excel</b> and save the file.</li>
          <li>Choose that file below. Annual P&amp;L, balance sheet, cash flow (CFO / CFI / CFF) and the latest quarters replace the old IPO-time figures everywhere in the terminal.</li>
        </ol>)}
      <div className="flex gap-2 flex-wrap items-center mt-3">
        <label className="btn btn-primary" style={{ cursor: 'pointer' }}>{busy ? 'Reading…' : r.imported ? 'Replace Screener file' : 'Import Screener Excel'}
          <input type="file" accept=".xlsx" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} /></label>
        {r.imported && <button className="btn" onClick={() => setPf({ ...pf, imports: (pf.imports ?? []).filter(x => x.company_id !== id) })}>Remove</button>}
      </div>
      {err && <p className="neg text-sm mt-2">{err}</p>}
      <p className="muted text-xs mt-3">Screener's export is for your own use under your Pro subscription; the file is read in your browser and kept only in your encrypted account.</p>
    </Card>
  )
}

/** A listed company's offer-document numbers are the ones printed for the IPO; say so when they are out of date. */
function IpoVintageNote({ r }: { r: CompanyRecord }) {
  const fy = latest(r, 'revenue_from_operations')?.period ?? latest(r, 'pat')?.period
  const y = fy ? Number(fy.replace(/\D/g, '')) : null
  const d = new Date(), lastDone = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1   // FY ending 31 Mar of this year is complete from April
  if (r.company.lifecycle !== 'LISTED' || r.company.external || r.imported || !y || y >= lastDone) return null
  return (
    <Card solid>
      <p className="ink2">Figures on this page are from the offer document at the IPO ({fy}) — the latest year the document covers, not the company's latest results.
        {' For the latest financials, import your Screener export on the Financials tab'}{r.listed?.results?.length ? '; latest NSE quarterly results are shown above.' : r.company.identifiers.nse_symbol ? ' (or track this company to pull its NSE results).' : '.'}
        {r.company.identifiers.nse_symbol && <> <a href={screenerUrl(r.company.identifiers.nse_symbol)} target="_blank" rel="noreferrer">Open on Screener ↗</a></>}</p>
    </Card>
  )
}

function ListedKeyData({ r }: { r: CompanyRecord }) {
  const d = r.listed, p = d?.profile
  if (!d) return <Card title="Key data" solid><p className="ink2">Fetching this company's data from NSE — it appears after the next refresh (about 15 minutes).</p></Card>
  const rng = p?.low_52w != null && p?.high_52w != null && p?.price != null ? Math.max(0, Math.min(100, ((p.price - p.low_52w) / (p.high_52w - p.low_52w || 1)) * 100)) : null
  return (
    <div className="space-y-5">
      <Card title={r.company.external ? 'Key data' : 'Latest data (NSE)'} solid>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <M label="52-week range">{p?.low_52w != null ? `${inr(p.low_52w)} – ${inr(p.high_52w)}` : '—'}</M>
          <M label="P/E" sub={p?.sector_pe != null ? `sector ${p.sector_pe.toFixed(1)}` : undefined}>{p?.pe != null ? p.pe.toFixed(1) : '—'}</M>
          <M label="Industry" sub={p?.sector}>{p?.industry ?? '—'}</M>
          <M label="Face value">{p?.face_value != null ? inr(p.face_value) : '—'}</M>
        </div>
        {rng != null && <div className="mt-4"><div className="h-2 rounded-full" style={{ background: 'var(--hairline)' }}><div className="h-2 rounded-full" style={{ width: `${rng}%`, background: 'var(--accent)' }} /></div>
          <div className="muted text-xs mt-1">Price sits {rng.toFixed(0)}% of the way from the 52-week low to the high</div></div>}
        <p className="muted text-xs mt-3">From NSE, refreshed every few hours{d.fetched_at ? ` · last ${fmtDateTime(d.fetched_at)}` : ''}. For deeper numbers, open Screener (button above).</p>
      </Card>
      {!!d.results?.length && (
        <Card title="Latest quarterly results (₹ crore)" solid>
          <Table rows={d.results} cols={[
            { key: 'p', label: 'Quarter ended', render: x => <b>{fmtDate(x.period_end)}</b> },
            { key: 'i', label: 'Income', right: true, render: x => x.income != null ? num(x.income, 1) : '—' },
            { key: 'a', label: 'Profit after tax', right: true, render: x => x.pat != null ? num(x.pat, 1) : '—' },
            { key: 'e', label: 'EPS (₹)', right: true, render: x => x.eps != null ? num(x.eps, 2) : '—' },
          ]} />
        </Card>)}
    </div>
  )
}

function Overview({ r }: { r: CompanyRecord }) {
  const v = useVault()
  const upcoming = r.events.filter(e => daysUntil(e.date) >= 0).slice(0, 6)
  return (
    <div className="space-y-5">
      {goodOverview(r.company.overview?.summary) && (
        <Card title="About the company" solid>
          <ReadMore text={r.company.overview.summary} />
          {r.company.overview.source && <p className="muted text-xs mt-2">From the offer document's “Our Business — Overview” · <SourceLine s={r.company.overview.source} /></p>}
        </Card>
      )}
      <PriceChart r={r} />
      {r.listed && <ListedKeyData r={r} />}
      <IpoVintageNote r={r} />
      {!r.company.external && <AnchorCard r={r} />}
      {!r.company.external && <div className="grid xl:grid-cols-2 gap-5">
        <DealTeam r={r} />
        <OfferAsFiled r={r} />
      </div>}
      <FinancialSnapshot r={r} />
      <Card title="Coming up" solid>
        <Table rows={upcoming} empty="No upcoming events" cols={[
          { key: 'd', label: 'Date', m: 'key', render: e => <b>{fmtDate(e.date)}</b> },
          { key: 'e', label: 'Event', primary: true, render: e => v.event_types[e.event_type]?.label ?? e.event_type },
          { key: 'k', label: 'Status', render: e => <Pill tone={e.date_kind === 'actual' ? 'green' : e.date_kind === 'scheduled' ? 'blue' : 'slate'}>{e.date_kind === 'derived' ? 'estimated' : e.date_kind}</Pill> },
          { key: 'x', label: 'Detail', render: e => <span className="text-sm">{e.detail ?? ''}</span> },
        ]} />
      </Card>
    </div>
  )
}

function FinancialSnapshot({ r }: { r: CompanyRecord }) {
  const rev = latest(r, 'revenue_from_operations'), pat = latest(r, 'pat'), ebitda = latest(r, 'ebitda'), nw = latest(r, 'net_worth')
  const roe = latest(r, 'roe') ?? latest(r, 'ronw'), em = latest(r, 'ebitda_margin')
  if (!rev && !pat) return null
  const margin = em ? fv(em) : fv(ebitda) != null && fv(rev) ? (fv(ebitda)! / fv(rev)!) * 100 : null
  return (
    <Card title={`${r.company.lifecycle === 'LISTED' && !r.company.external && !r.imported ? 'At the IPO' : 'Financial snapshot'} · ${rev?.period ?? pat?.period ?? ''}`} solid>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <M label="Revenue"><FactValue f={rev} /></M>
        <M label="EBITDA"><FactValue f={ebitda} /></M>
        <M label="EBITDA margin">{pct(margin)}</M>
        <M label="PAT"><FactValue f={pat} /></M>
        <M label="Net worth"><FactValue f={nw} /></M>
        <M label="ROE / RoNW"><FactValue f={roe} /></M>
      </div>
      <p className="muted text-xs mt-3">From the offer document's restated financials. Click any figure for the page it came from.</p>
    </Card>
  )
}

function DealTeam({ r }: { r: CompanyRecord }) {
  const contacts = ipo(r)?.intermediaries?.contacts ?? []
  if (!contacts.length) return <Card title="Deal team" solid><p className="muted">Lead managers appear once the offer-document cover has been read.</p></Card>
  return (
    <Card title="Deal team (offer-document cover)" solid>
      <Table rows={contacts} cols={[
        { key: 'n', label: 'Firm', render: c => <div><b>{c.name}</b><div className="text-xs muted">{c.role === 'BRLM' ? 'Lead manager · runs the anchor book' : 'Registrar'}</div></div> },
        { key: 'p', label: 'Contact', render: c => <span className="text-sm">{c.contact_person ?? '—'}{c.phone && <><br /><span className="muted">{c.phone}</span></>}</span> },
        { key: 'e', label: 'Email', render: c => c.email ? <a onClick={e => e.stopPropagation()} href={`mailto:${c.email}?subject=${encodeURIComponent(`Anchor interest — ${r.company.name} IPO`)}`}>{c.email}</a> : '—' },
      ]} />
      {contacts[0]?.source && <p className="muted text-xs mt-2">Source: <SourceLine s={contacts[0].source} /></p>}
    </Card>
  )
}

function OfferAsFiled({ r }: { r: CompanyRecord }) {
  const F = ipo(r)?.facts ?? {}
  const keys = ['offer_type', 'total_issue', 'fresh_issue', 'ofs', 'drhp_total_issue', 'drhp_fresh_issue', 'drhp_ofs', 'drhp_total_issue_shares', 'drhp_fresh_issue_shares', 'drhp_ofs_shares',
    'pre_issue_shares', 'shares_outstanding', 'face_value', 'lot_size', 'eligibility_regulation', 'anchor_portion_contemplated', 'pre_ipo_placement_contemplated', 'drhp_dated']
  const rows = keys.filter(k => F[k]).map(k => F[k])
  return (
    <Card title="The offer" solid>
      <Table rows={rows} empty="Offer details not extracted yet" cols={[
        { key: 'm', label: 'Item', render: f => f.label ?? humanize(f.metric) },
        { key: 'v', label: 'Value', right: true, render: f => typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : <FactValue f={f} /> },
      ]} />
      {!!r.company.promoters?.length && <p className="text-sm mt-3"><span className="eyebrow">Promoters</span><br />{r.company.promoters.join(', ')}</p>}
    </Card>
  )
}

// ───────── financials ─────────
export const FIN_ORDER: [string, string][] = [
  ['revenue_from_operations', 'Revenue from operations'], ['total_income', 'Total income'], ['ebitda', 'EBITDA'], ['ebitda_margin', 'EBITDA margin'],
  ['pbt', 'Profit before tax'], ['pat', 'Profit after tax'], ['pat_margin', 'PAT margin'], ['revenue_growth', 'Revenue growth'], ['pat_growth', 'PAT growth'],
  ['eps_basic', 'EPS (basic, ₹)'], ['eps_diluted', 'EPS (diluted, ₹)'], ['net_worth', 'Net worth'], ['equity_share_capital', 'Equity share capital'],
  ['total_borrowings', 'Borrowings'], ['net_debt', 'Net debt'], ['cash_and_equivalents', 'Cash & equivalents'], ['total_assets', 'Total assets'],
  ['debt_equity', 'Debt / equity (x)'], ['roe', 'ROE'], ['ronw', 'Return on net worth'], ['roce', 'ROCE'], ['nav_per_share', 'NAV per share (₹)'],
  ['finance_cost', 'Finance costs'], ['current_liabilities', 'Current liabilities'],
]
function CashFlowCard({ r }: { r: CompanyRecord }) {
  const m = finModel(r)
  const rows = m.rows.filter(x => x.group === 'Cash flow')
  if (!rows.length) return null
  const chart = m.periods.map((p, i) => ({ p: isStub(p) ? `${p}*` : p, 'Operations (CFO)': m.row('cfo')?.values[i] ?? null, 'Investing (CFI)': m.row('cfi')?.values[i] ?? null, 'Financing (CFF)': m.row('cff')?.values[i] ?? null, 'Free cash flow': m.row('fcf')?.values[i] ?? null }))
  return (
    <Card title="Cash flow (₹ crore)" solid>
      {(m.row('cfo') || m.row('cfi') || m.row('cff')) && <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={chart} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="p" tick={{ fill: 'var(--ink-3)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={56} tickFormatter={x => num(x)} />
            <Tooltip contentStyle={{ background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(x, n) => [crore(Number(x), 1), n]} />
            <Legend />
            <Bar dataKey="Operations (CFO)" fill="#34c77b" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Investing (CFI)" fill="#ff9f0a" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Financing (CFF)" fill="#0a84ff" radius={[4, 4, 0, 0]} />
            <Line dataKey="Free cash flow" stroke="#b07cff" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>}
      <Table wide rows={rows} cols={[
        { key: 'l', label: 'Item', render: x => <div><b>{x.label}</b><div className="muted text-xs">{x.hint}</div></div> },
        ...m.periods.map((p, i) => ({ key: p, label: isStub(p) ? `${p} (part-year)` : p, right: true, render: (x: typeof rows[number]) => <span>{fmtFin(x.values[i], x.unit)}{x.calc && x.values[i] != null ? ' †' : ''}</span> })),
      ]} />
      <p className="muted text-xs mt-3">Brackets = cash going out. † calculated here: {[...new Set(rows.filter(x => x.calc).map(x => `${x.label} = ${x.calc}`))].join('; ') || 'none'}.</p>
    </Card>
  )
}

function Financials({ r }: { r: CompanyRecord }) {
  if (r.company.external) return <div className="space-y-5"><ScreenerImportCard r={r} /><ListedKeyData r={r} /></div>
  return <div className="space-y-5"><ScreenerImportCard r={r} />{r.listed && <ListedKeyData r={r} />}<FinancialsFiled r={r} /></div>
}
function FinancialsFiled({ r }: { r: CompanyRecord }) {
  const note = <IpoVintageNote r={r} />
  const { periods, byMetric } = finTable(r)
  if (!periods.length) {
    const queued = r.documents.some(d => ['DRHP', 'RHP', 'PROSPECTUS', 'UDRHP'].includes(d.doc_type) && /\.(pdf|zip)$/i.test(d.url))
    return <Card solid><p className="ink2">{queued ? 'The offer document is queued for reading — restated financials appear here automatically (usually within a few refreshes).' : 'No offer document with financials is available for this company yet.'}</p></Card>
  }
  const val = (m: string, p: string) => fv(byMetric.get(m)?.get(p))
  const marginOf = (num: string, mm: string, p: string) => val(mm, p) ?? (val(num, p) != null && val('revenue_from_operations', p) ? (val(num, p)! / val('revenue_from_operations', p)!) * 100 : null)
  const chart = periods.map(p => ({ p: isStub(p) ? `${p}*` : p, Revenue: val('revenue_from_operations', p), PAT: val('pat', p), EBITDA: val('ebitda', p),
    'EBITDA %': marginOf('ebitda', 'ebitda_margin', p), 'PAT %': marginOf('pat', 'pat_margin', p) }))
  const src = r.documents.find(d => d.document_id === r.facts?.source_document)
  return (
    <div className="space-y-5">
      <Card title="Revenue, profit and margins" solid>
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="p" tick={{ fill: 'var(--ink-3)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={56} tickFormatter={x => `₹${num(x)}`} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={40} tickFormatter={x => `${x}%`} />
              <Tooltip contentStyle={{ background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(x, n) => [String(n).includes('%') ? pct(Number(x)) : crore(Number(x), 1), n]} />
              <Legend />
              <Bar yAxisId="l" dataKey="Revenue" fill="#0a84ff" radius={[6, 6, 0, 0]} />
              <Bar yAxisId="l" dataKey="PAT" fill="#34c77b" radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" dataKey="EBITDA %" stroke="#ff9f0a" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
              <Line yAxisId="r" dataKey="PAT %" stroke="#b07cff" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="muted text-xs">₹ crore. * = part-year (stub) period. Margins are as printed in the document, or calculated where not printed.</p>
      </Card>
      {note}
      <CashFlowCard r={r} />
      <Card title="Restated financials (₹ crore unless stated)" solid>
        <Table wide rows={FIN_ORDER.filter(([m]) => byMetric.has(m))} cols={[
          { key: 'm', label: 'Metric', render: ([, l]) => <b>{l}</b> },
          ...periods.map(p => ({ key: p, label: isStub(p) ? `${p} (part-year)` : p, right: true, render: ([m]: [string, string]) => <FactValue f={byMetric.get(m)?.get(p)} /> })),
        ]} />
        <p className="muted text-xs mt-3">{r.imported ? 'Source: your Screener export (Export to Excel). EBITDA is worked out as profit before tax + interest + depreciation − other income.' : <>Source: {src ? <a href={src.url} target="_blank" rel="noreferrer">{src.doc_type} · {fmtDate(src.filing_date)}</a> : 'offer document'} — values read from the restated summary financials and KPI tables; each figure links to its page. Values that contradicted the document's own statements were dropped rather than shown.</>}</p>
      </Card>
    </div>
  )
}

// ───────── valuation ─────────
function WhatIf({ V }: { V: ReturnType<typeof valuationInputs> }) {
  const [mode, setMode] = useState<'mcap' | 'price'>(V.shares.value ? 'price' : 'mcap')
  const [x, setX] = useState('')
  const n = parseFloat(x.replace(/,/g, ''))
  const mcap = !isFinite(n) || n <= 0 ? null : mode === 'mcap' ? n : V.shares.value ? (n * V.shares.value) / 1e7 : null
  const g = (f: Fact | null | undefined) => fv(f)
  const post = mcap != null && V.inputs.fresh ? mcap + V.inputs.fresh : null
  const nd = g(V.inputs.debt) != null && g(V.inputs.cash) != null ? g(V.inputs.debt)! - g(V.inputs.cash)! : null
  const ev = mcap != null && nd != null ? mcap + nd : null
  const ratio = (a: number | null, b: number | null | undefined, pos = false) => a == null || !b || (pos && b <= 0) ? '—' : `${(a / b).toFixed(1)}x`
  return (
    <Card title="What-if valuation" solid>
      <p className="muted text-sm mb-3">Type a market cap or a share price to see the implied multiples on the latest full-year figures. Useful for DRHPs before a price band.</p>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Seg value={mode} onChange={setMode} options={[{ v: 'mcap', label: 'Market cap ₹ cr' }, ...(V.shares.value ? [{ v: 'price' as const, label: 'Price ₹/share' }] : [])]} />
        <input className="input !h-10 !w-48" inputMode="decimal" placeholder={mode === 'mcap' ? 'e.g. 5000' : 'e.g. 450'} value={x} onChange={e => setX(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[['Market cap', crore(mcap)], ['P/E', ratio(mcap, g(V.inputs.pat), true)], ['P/B', ratio(mcap, g(V.inputs.nw))], ['P/S', ratio(mcap, g(V.inputs.rev))], ['EV/EBITDA', ratio(ev, g(V.inputs.ebitda), true)]].map(([l, val]) => (
          <div key={l} className="glass p-3"><div className="eyebrow">{l}</div><div className="display text-[22px] font-semibold">{val}</div></div>
        ))}
      </div>
      {post != null && <p className="muted text-xs mt-3">If the market cap typed is pre-money, post-money including the fresh issue is {crore(post)}. EV = mcap + borrowings − cash.</p>}
    </Card>
  )
}

function Valuation({ r }: { r: CompanyRecord }) {
  const V = valuationInputs(r)
  const peers = r.facts?.peers ?? []
  const fmtX = (x: number | null) => (x == null ? '—' : `${x.toFixed(1)}x`)
  const rows: { label: string; get: (p: typeof V.points[number]) => string; note?: string }[] = [
    { label: 'Share price', get: p => inr(p.price, 2) },
    { label: 'Market cap', get: p => crore(p.mcap) },
    { label: `P/E (${V.inputs.pat?.period ?? 'latest FY'})`, get: p => (V.lossMaking ? 'Loss-making' : fmtX(p.pe)) },
    { label: `P/B (${V.inputs.nw?.period ?? 'latest FY'} net worth)`, get: p => fmtX(p.pb) },
    { label: `Price / sales (${V.inputs.rev?.period ?? 'latest FY'})`, get: p => fmtX(p.ps) },
    { label: 'Enterprise value', get: p => crore(p.ev), note: 'mcap + borrowings − cash − fresh-issue proceeds' },
    { label: `EV / EBITDA (${V.inputs.ebitda?.period ?? 'latest FY'})`, get: p => fmtX(p.evEbitda) },
  ]
  return (
    <div className="space-y-5">
      {V.points.some(p => p.price) && <Card title="Valuation inputs" solid>
        <p className="muted text-sm mb-3">Mechanical calculations from disclosed figures — inputs for your own model, not a view on value.</p>
        <div className="tbl-wrap wide"><table className="tbl tbl-wide">
          <thead><tr><th>Metric</th>{V.points.map(p => <th key={p.key} className="r">{p.label}</th>)}</tr></thead>
          <tbody>{rows.map(row => (
            <tr key={row.label}><td className="td-primary" data-label="">{row.label}{row.note && <div className="muted text-xs">{row.note}</div>}</td>
              {V.points.map(p => <td key={p.key} className="r" data-label={p.label}>{p.price ? row.get(p) : '—'}</td>)}</tr>
          ))}</tbody>
        </table></div>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-1 mt-4 text-sm ink2">
          <div>Share count: <b>{V.shares.value ? shares(V.shares.value) : 'not available'}</b> <span className="muted">({V.shares.basis || 'needs capital structure'})</span></div>
          <div>PAT: <FactValue f={V.inputs.pat} /> · EBITDA: <FactValue f={V.inputs.ebitda} /></div>
          <div>Net worth: <FactValue f={V.inputs.nw} /> · Revenue: <FactValue f={V.inputs.rev} /></div>
          <div>Borrowings: <FactValue f={V.inputs.debt} /> · Cash: <FactValue f={V.inputs.cash} /></div>
        </div>
      </Card>}
      <WhatIf V={V} />
      <Card title="Listed peers — today vs the offer document" solid>
        <Table wide rows={peers} empty="No peer comparison table found in the offer document" initialSort={{ key: 'mc', dir: -1 }} cols={[
          { key: 'n', label: 'Company', render: p => <div><b>{p.name.replace(/\s*\((consolidated|standalone)[^)]*\)/i, '')}</b>{p.live && <div className="muted text-xs">NSE: {p.live.symbol}</div>}</div> },
          { key: 'pr', label: 'Price today', right: true, render: p => (p.live ? inr(p.live.price, 2) : <span className="muted">not listed / no match</span>), sort: p => p.live?.price ?? null },
          { key: 'mc', label: 'Mcap today', right: true, render: p => crore(p.live?.mcap_cr), sort: p => p.live?.mcap_cr ?? null },
          { key: 'pe', label: 'P/E today', right: true, render: p => (p.live?.pe != null ? <b>{p.live.pe.toFixed(1)}x</b> : '—'), sort: p => p.live?.pe ?? null },
          { key: 'pb', label: 'P/B today', right: true, render: p => (p.live?.pb != null ? `${p.live.pb.toFixed(1)}x` : '—'), sort: p => p.live?.pb ?? null },
          { key: 'pe0', label: 'P/E in doc', right: true, hideMobile: true, render: p => (p.pe != null ? `${p.pe.toFixed(1)}x` : '—') },
          { key: 'eps', label: 'EPS (₹)', right: true, hideMobile: true, render: p => { const e = p.eps_diluted ?? p.eps_basic; return e != null ? num(e, 2) : '—' } },
          { key: 'ronw', label: 'RoNW', right: true, render: p => pct(p.ronw) },
          { key: 'nav', label: 'NAV (₹)', right: true, hideMobile: true, render: p => (p.nav != null ? num(p.nav, 2) : '—') },
        ]} />
        {peers[0]?.source && <p className="muted text-xs mt-2">EPS, RoNW and NAV as printed in the offer document (<SourceLine s={peers[0].source} />). Today's price and market cap: NSE close {peers.find(p => p.live)?.live?.date ? `of ${fmtDate(peers.find(p => p.live)!.live!.date)}` : ''}; P/E and P/B today = today's price ÷ the document's EPS / NAV.</p>}
      </Card>
    </div>
  )
}

// ───────── industry ─────────
function Industry({ r }: { r: CompanyRecord }) {
  const series = r.facts?.industry_series ?? []
  const claims = r.facts?.industry_claims ?? []
  const [open, setOpen] = useState(false)
  if (!series.length && !claims.length) return <Card solid><p className="ink2">Industry charts appear once the offer document's Industry Overview has been read (usually within a few refreshes of filing).</p></Card>
  return (
    <div className="space-y-5">
      {series.length ? <IndustryCharts series={series} /> : <Card solid><p className="ink2">No chartable series found in this document's Industry Overview yet.</p></Card>}
      {!!claims.length && (
        <div>
          <button className="btn" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'} source statements ({claims.length})</button>
          {open && <Card solid className="mt-4"><ul className="space-y-2">{claims.map((c, i) => (
            <li key={i} className="text-sm ink2 flex gap-3"><span className="pill tone-slate shrink-0 h-fit">p.{c.page}</span><span>{c.text}</span></li>))}</ul></Card>}
        </div>
      )}
    </div>
  )
}

// ───────── IPO ─────────
const OFFER_ROWS = ['fresh_issue', 'ofs', 'total_issue', 'issue_type', 'price_band_low', 'price_band_high', 'issue_price', 'lot_size', 'face_value',
  'pre_issue_shares', 'fresh_issue_shares', 'ofs_shares', 'post_issue_shares', 'shares_outstanding', 'anchor_shares', 'shares_offered_ex_anchor', 'issue_size_text']
function IpoTab({ r }: { r: CompanyRecord }) {
  const o = ipo(r)
  if (!o) return <Card solid>No offering details yet — they appear when the issue is announced on the exchange.</Card>
  const rows = [...OFFER_ROWS.filter(k => o.facts[k]), ...Object.keys(o.facts).filter(k => !OFFER_ROWS.includes(k) && !k.startsWith('drhp_'))].map(k => o.facts[k])
  return (
    <div className="grid xl:grid-cols-[1.4fr_1fr] gap-5">
      <Card title="Offer structure" solid>
        <Table rows={rows} cols={[
          { key: 'm', label: 'Item', render: (f: Fact) => f.label ?? humanize(f.metric) },
          { key: 'v', label: 'Value', right: true, render: (f: Fact) => f.unit === 'text' ? <span className="text-sm">{String(f.value)}</span> : <FactValue f={f} /> },
          { key: 'k', label: 'Type', right: true, hideMobile: true, render: (f: Fact) => <Pill tone={f.kind === 'reported' ? 'slate' : 'violet'}>{f.kind}</Pill> },
        ]} />
      </Card>
      <Card title="Issue" solid>
        <IssueMix facts={o.facts} />
        <div className="mt-4 text-sm ink2 space-y-1">
          <div>Exchanges: <b>{o.exchanges?.join(', ') || '—'}</b></div>
          <div>Lead managers: <b>{o.intermediaries?.brlms?.join(', ') || '—'}</b></div>
          <div>Registrar: <b>{o.intermediaries?.registrar ?? '—'}</b></div>
        </div>
        {o.subscription?.total_times != null && <div className="mt-4"><span className="eyebrow block">Subscription (total)</span>
          <span className="display text-[30px] font-semibold">{o.subscription.total_times.toFixed(2)}x</span>
          <span className="muted text-xs block">as of {fmtDateTime(o.subscription.as_of)}</span></div>}
      </Card>
    </div>
  )
}
function IssueMix({ facts }: { facts: Record<string, Fact> }) {
  const fresh = fv(facts.fresh_issue) ?? 0, ofs = fv(facts.ofs) ?? 0
  const t = fresh + ofs
  if (!t) return <p className="muted">Fresh / OFS split not available</p>
  return (
    <div>
      <div className="flex h-4 rounded-full overflow-hidden">
        <div style={{ width: `${(fresh / t) * 100}%`, background: 'var(--accent)' }} />
        <div style={{ width: `${(ofs / t) * 100}%`, background: '#b07cff' }} />
      </div>
      <div className="flex justify-between mt-2 text-sm flex-wrap gap-2">
        <span><b style={{ color: 'var(--accent)' }}>●</b> Fresh {crore(fresh)} · {pct((fresh / t) * 100, 0)}</span>
        <span><b style={{ color: '#b07cff' }}>●</b> OFS {crore(ofs)} · {pct((ofs / t) * 100, 0)}</span>
      </div>
    </div>
  )
}

// ───────── timeline / lock-ins / documents / news ─────────
function Timeline({ r }: { r: CompanyRecord }) {
  const v = useVault()
  return (
    <Card title="Lifecycle" solid>
      <ol className="relative ml-2">
        {r.events.map(e => {
          const past = daysUntil(e.date) < 0
          return (
            <li key={e.event_id} className="pl-6 pb-5 relative" style={{ borderLeft: '2px solid var(--hairline)' }}>
              <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full" style={{ background: past ? 'var(--ink-3)' : e.date_kind === 'derived' ? '#b07cff' : 'var(--accent)' }} />
              <div className="flex flex-wrap items-center gap-2">
                <b>{fmtDate(e.date)}</b><span>{v.event_types[e.event_type]?.label ?? e.event_type}</span>
                <Pill tone={e.date_kind === 'actual' ? 'green' : e.date_kind === 'scheduled' ? 'blue' : 'violet'}>{e.date_kind === 'derived' ? 'estimated' : e.date_kind}</Pill>
              </div>
              {e.detail && <div className="ink2 text-[15px]">{e.detail}</div>}
              <div className="muted text-xs">{e.source ? <SourceLine s={e.source} /> : e.rule_id ? `Rule ${e.rule_id}` : ''}</div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
function LockinTab({ r }: { r: CompanyRecord }) {
  return (
    <Card title="Lock-in tranches" solid>
      <Table rows={r.lockins} empty="No lock-ins computed (needs allotment date and anchor / capital-structure figures)" cols={[
        { key: 'h', label: 'Holder', render: l => <b>{holder(l.holder_category)}</b> },
        { key: 'e', label: 'Expiry', right: true, render: l => <b>{fmtDate(l.expiry_date)}</b> },
        { key: 'u', label: 'Status', right: true, render: l => { const d = daysUntil(l.expiry_date), u = urgency(d); return <Pill tone={u.tone}>{d < 0 ? 'Expired' : `${d}d`}</Pill> } },
        { key: 's', label: 'Shares', right: true, render: l => <FactValue f={l.shares} /> },
        { key: 'p', label: '% of shares out', right: true, render: l => <FactValue f={l.pct_post_issue} /> },
        { key: 'r', label: 'Rule', hideMobile: true, render: l => <span className="text-sm">{l.rule_id} {!l.rule_verified && <Pill tone="amber">unverified rule</Pill>}</span> },
      ]} />
      <p className="muted text-xs mt-3">Lock-ins run from the allotment date. Unlocked shares become eligible for sale; that does not mean they will be sold.</p>
    </Card>
  )
}
function Docs({ r }: { r: CompanyRecord }) {
  const rows = [...r.documents].sort((a, b) => (b.filing_date ?? '').localeCompare(a.filing_date ?? ''))
  return (
    <Card title="Documents" solid>
      <Table rows={rows} empty="No documents registered" cols={[
        { key: 'f', label: 'Filed', m: 'key', render: d => fmtDate(d.filing_date), sort: d => d.filing_date ?? '' },
        { key: 't', label: 'Type', render: d => <Pill tone="blue">{d.doc_type}</Pill> },
        { key: 'n', label: 'Document', render: d => <a href={d.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{d.title ?? d.document_id}</a> },
        { key: 'p', label: 'Pages', right: true, hideMobile: true, render: d => d.pages ?? '—' },
        { key: 'x', label: 'Read', right: true, render: d => { const ex = (d as unknown as { extraction?: { status?: string } }).extraction; return ex?.status === 'ok' ? <Pill tone="green">read</Pill> : ex?.status ? <Pill tone="amber">{ex.status}</Pill> : <span className="muted">—</span> } },
      ]} />
    </Card>
  )
}
function NewsTab({ r }: { r: CompanyRecord }) {
  return (
    <Card title="Exchange announcements & news" solid>
      <Table rows={r.news} empty="No announcements yet" search={n => `${n.title} ${n.category}`} cols={[
        { key: 't', label: 'Time', m: 'key', render: n => fmtDateTime(n.published_at), sort: n => n.published_at },
        { key: 'h', label: 'Headline', primary: true, render: n => n.url.startsWith('http') ? <a href={n.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{n.title}</a> : n.title },
        { key: 'c', label: 'Type', render: n => <Pill tone={n.tier === 'official' ? 'blue' : 'slate'}>{n.category.replace(/_/g, ' ')}</Pill> },
      ]} />
    </Card>
  )
}

// ───────── holding form (listed, allotment, anchor, pre-IPO) ─────────
function HoldingForm({ r, onDone }: { r: CompanyRecord; onDone: () => void }) {
  const { pf, setPf } = usePf()
  const id = r.company.company_id
  const cur = pf.holdings.find(h => h.company_id === id)
  const listed = !!listedOn(r)
  const [route, setRoute] = useState(cur?.route ?? (listed ? 'ALLOTMENT' : 'PRE_IPO'))
  const [q, setQ] = useState(cur?.quantity ? String(cur.quantity) : '')
  const [c, setC] = useState(cur?.avg_cost ? String(cur.avg_cost) : '')
  const [d, setD] = useState(cur?.acquired_on ?? new Date().toISOString().slice(0, 10))
  const [ev, setEv] = useState(cur?.entry_valuation_cr ? String(cur.entry_valuation_cr) : '')
  const [inv, setInv] = useState(cur?.invested_cr ? String(cur.invested_cr) : '')
  const [lr, setLr] = useState(cur?.latest_round_cr ? String(cur.latest_round_cr) : '')
  const [lrd, setLrd] = useState(cur?.latest_round_on ?? '')
  const [err, setErr] = useState('')
  const n = (x: string) => (x.trim() ? Number(x.replace(/[,₹\s]/g, '')) : null)
  const save = () => {
    const h: Holding = { company_id: id, route, acquired_on: d, quantity: n(q) ?? 0, avg_cost: n(c) ?? 0,
      entry_valuation_cr: n(ev), invested_cr: n(inv), latest_round_cr: n(lr), latest_round_on: lrd || null }
    if (!(h.quantity > 0 && h.avg_cost > 0) && !(h.entry_valuation_cr && (h.invested_cr || h.quantity))) {
      setErr(route === 'PRE_IPO' ? 'Enter quantity + price per share, or entry valuation + amount invested.' : 'Enter quantity and average cost.'); return
    }
    setPf({ ...pf, holdings: [...pf.holdings.filter(x => x.company_id !== id), h] })
    onDone()
  }
  const preview = holdingMarks(r, { company_id: id, route, acquired_on: d, quantity: n(q) ?? 0, avg_cost: n(c) ?? 0, entry_valuation_cr: n(ev), invested_cr: n(inv), latest_round_cr: n(lr), latest_round_on: lrd || null })
  return (
    <div className="glass panel p-4 mt-5 space-y-3">
      <div className="flex flex-wrap gap-2 items-center"><span className="eyebrow mr-1">How we hold it</span>
        <Seg value={route} onChange={setRoute} options={[{ v: 'PRE_IPO', label: 'Pre-IPO' }, { v: 'ANCHOR', label: 'Anchor' }, { v: 'ALLOTMENT', label: 'IPO allotment' }, { v: 'MARKET', label: 'Bought in market' }]} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-sm">Date invested<input className="input mt-1" type="date" value={d} onChange={e => setD(e.target.value)} /></label>
        <label className="text-sm">Quantity (shares)<input className="input mt-1" value={q} onChange={e => setQ(e.target.value)} inputMode="numeric" placeholder="optional for pre-IPO" /></label>
        <label className="text-sm">Price per share ₹<input className="input mt-1" value={c} onChange={e => setC(e.target.value)} inputMode="decimal" /></label>
        {route === 'PRE_IPO' && <label className="text-sm">Amount invested ₹ cr<input className="input mt-1" value={inv} onChange={e => setInv(e.target.value)} inputMode="decimal" /></label>}
      </div>
      {route === 'PRE_IPO' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="text-sm">Entry valuation ₹ cr (post-money)<input className="input mt-1" value={ev} onChange={e => setEv(e.target.value)} inputMode="decimal" /></label>
          <label className="text-sm">Latest round valuation ₹ cr<input className="input mt-1" value={lr} onChange={e => setLr(e.target.value)} inputMode="decimal" /></label>
          <label className="text-sm">Latest round date<input className="input mt-1" type="date" value={lrd} onChange={e => setLrd(e.target.value)} /></label>
        </div>
      )}
      {!!preview.marks.length && (n(c) || n(ev)) && (
        <div className="text-sm ink2 flex flex-wrap gap-x-6 gap-y-1">{preview.marks.map(m => <span key={m.label}>{m.label}: <b>{m.multiple != null ? `${m.multiple.toFixed(2)}x` : '—'}</b>{m.cagr != null && <span className="muted"> ({pct(m.cagr)} p.a.)</span>}</span>)}</div>
      )}
      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn btn-primary" onClick={save}>Save</button>
        {cur && <button className="btn" onClick={() => { setPf({ ...pf, holdings: pf.holdings.filter(x => x.company_id !== id) }); onDone() }}>Remove</button>}
        <button className="btn" onClick={onDone}>Cancel</button>
        {err && <span className="neg text-sm">{err}</span>}
      </div>
      <p className="muted text-xs">Stored only in this browser (never on GitHub). Portfolio → Export moves it to another device. Per-share comparisons ignore later splits/bonuses; valuation comparisons use the company's market cap.</p>
    </div>
  )
}


