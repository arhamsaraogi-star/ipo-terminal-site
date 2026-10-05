import { useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useVault } from '../App'
import { Card, FactValue, Kpi, Pill, SourceLine, Stage, Table } from '../components/ui'
import { byId, finTable, ipo, isHeld, isWatched, issuePrice, issueSize, latest, nextLockin, portfolioIssueUrl, priceBand, valuationInputs } from '../lib/derive'
import { cagr, crore, daysUntil, fmtDate, fmtDateTime, fv, fyYear, humanize, pct, urgency } from '../lib/format'
import type { CompanyRecord, Fact } from '../lib/types'
import { holder } from './Dashboard'

const TABS = ['Overview', 'IPO', 'Financials', 'Industry', 'Valuation', 'Timeline', 'Lock-ins', 'Documents', 'News', 'Changes'] as const
type Tab = typeof TABS[number]

export default function CompanyPage({ id }: { id: string }) {
  const v = useVault()
  const r = byId(v, id)
  const [tab, setTab] = useState<Tab>('Overview')
  if (!r) return <div className="glass p-10">Company not found. <a href="#/pipeline">Back to pipeline</a></div>
  const c = r.company
  const held = isHeld(v, id), watched = isWatched(v, id)
  const addUrl = portfolioIssueUrl(v.meta.repo, held ? 'remove' : 'add', id)
  const watchUrl = portfolioIssueUrl(v.meta.repo, watched ? 'unwatch' : 'watch', id)

  return (
    <div className="space-y-5">
      <header className="glass glass-strong p-6 fade-in">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Stage s={c.lifecycle} />
              <Pill tone={c.segment === 'SME' ? 'amber' : 'slate'}>{c.segment === 'SME' ? 'SME' : c.segment === 'MAINBOARD' ? 'Mainboard' : 'Segment TBC'}</Pill>
              {c.is_sample && <Pill tone="amber">DEMO</Pill>}
              {held && <Pill tone="amber">★ In portfolio</Pill>}
            </div>
            <h1 className="display text-[36px] font-bold leading-tight">{c.name}</h1>
            <p className="muted mt-1">{[c.sector, c.industry, c.identifiers.nse_symbol && `NSE: ${c.identifiers.nse_symbol}`, c.identifiers.bse_code && `BSE: ${c.identifiers.bse_code}`, c.identifiers.cin && `CIN ${c.identifiers.cin}`].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a className="btn btn-primary" href={addUrl ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!addUrl}
              title={addUrl ? 'Opens a pre-filled GitHub issue; the portfolio workflow updates holdings' : 'Repository not configured'}>
              {held ? '★ Update / remove holding' : '★ Add to portfolio'}</a>
            <a className="btn" href={watchUrl ?? undefined} target="_blank" rel="noreferrer">{watched ? '☆ Unwatch' : '☆ Watch'}</a>
          </div>
        </div>
        <div className="seg mt-5">{TABS.map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      </header>

      {tab === 'Overview' && <Overview r={r} />}
      {tab === 'IPO' && <IpoTab r={r} />}
      {tab === 'Financials' && <Financials r={r} />}
      {tab === 'Industry' && <Industry r={r} />}
      {tab === 'Valuation' && <Valuation r={r} />}
      {tab === 'Timeline' && <Timeline r={r} />}
      {tab === 'Lock-ins' && <LockinTab r={r} />}
      {tab === 'Documents' && <Docs r={r} />}
      {tab === 'News' && <NewsTab r={r} />}
      {tab === 'Changes' && <ChangesTab r={r} />}
    </div>
  )
}

function Overview({ r }: { r: CompanyRecord }) {
  const v = useVault()
  const rev = latest(r, 'revenue_from_operations'), pat = latest(r, 'pat'), ebitda = latest(r, 'ebitda')
  const nl = nextLockin(r)
  const margin = fv(ebitda) != null && fv(rev) ? (fv(ebitda)! / fv(rev)!) * 100 : null
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Issue size" value={crore(issueSize(r))} sub={priceBand(r) !== '—' ? `Band ${priceBand(r)}` : 'Price band not yet announced'} />
        <Kpi label={`Revenue ${rev?.period ?? ''}`} value={<FactValue f={rev} />} sub={revCagr(r)} />
        <Kpi label="EBITDA margin" value={pct(margin)} sub={<span>calculated · EBITDA <FactValue f={ebitda} /></span>} />
        <Kpi label={`PAT ${pat?.period ?? ''}`} value={<FactValue f={pat} />} tone={(fv(pat) ?? 0) < 0 ? 'neg' : ''}
          sub={nl ? `Next unlock in ${daysUntil(nl.expiry_date)}d` : undefined} />
      </div>
      <Card title="What does the company do?">
        {r.company.overview ? <>
          <p className="text-[17px] leading-relaxed ink2 max-w-[80ch]">{r.company.overview.summary}</p>
          {!!r.company.overview.segments?.length && <div className="flex flex-wrap gap-2 mt-3">{r.company.overview.segments.map(s => <Pill key={s} tone="blue">{s}</Pill>)}</div>}
          <p className="muted text-xs mt-3">Source: <SourceLine s={r.company.overview.source} /></p>
        </> : <p className="muted">Not available — no offer document processed yet.</p>}
      </Card>
      {r.company.private_tracker && (
        <Card title="IPO intent" solid>
          <p><Pill tone="violet">{humanize(r.company.private_tracker.confidence)}</Pill> <span className="ink2 ml-2">Expected timing: {r.company.private_tracker.expected_timing ?? 'not stated'}</span></p>
        </Card>
      )}
      <Card title="Upcoming" solid>
        <Table rows={r.events.filter(e => daysUntil(e.date) >= 0).slice(0, 6)} empty="No upcoming events" cols={[
          { key: 'd', label: 'Date', render: e => <b>{fmtDate(e.date)}</b> },
          { key: 'e', label: 'Event', render: e => v.event_types[e.event_type]?.label ?? e.event_type },
          { key: 'k', label: 'Status', render: e => <Pill tone={e.date_kind === 'actual' ? 'green' : e.date_kind === 'scheduled' ? 'blue' : 'slate'}>{e.date_kind}</Pill> },
          { key: 'x', label: 'Detail', render: e => e.detail ?? '' },
        ]} />
      </Card>
    </div>
  )
}

function revCagr(r: CompanyRecord) {
  const { periods, byMetric } = finTable(r)
  const m = byMetric.get('revenue_from_operations')
  if (!m || periods.length < 2) return undefined
  const a = periods[0], b = periods[periods.length - 1]
  const g = cagr(fv(m.get(a)) ?? 0, fv(m.get(b)) ?? 0, (fyYear(b) ?? 0) - (fyYear(a) ?? 0))
  return g == null ? undefined : `${pct(g)} CAGR ${a}–${b} (calc.)`
}

const OFFER_ROWS = ['fresh_issue', 'ofs', 'total_issue', 'price_band_low', 'price_band_high', 'issue_price', 'lot_size', 'face_value',
  'pre_issue_shares', 'fresh_issue_shares', 'post_issue_shares', 'promoter_pre_pct', 'promoter_post_pct', 'anchor_shares']

function IpoTab({ r }: { r: CompanyRecord }) {
  const o = ipo(r)
  if (!o) return <Card>No offering recorded.</Card>
  const rows = [...OFFER_ROWS.filter(k => o.facts[k]), ...Object.keys(o.facts).filter(k => !OFFER_ROWS.includes(k))].map(k => o.facts[k])
  return (
    <div className="grid xl:grid-cols-[1.4fr_1fr] gap-5">
      <Card title="Offer structure" solid>
        <Table rows={rows} cols={[
          { key: 'm', label: 'Metric', render: f => f.label ?? humanize(f.metric) },
          { key: 'v', label: 'Value', right: true, render: f => <FactValue f={f} /> },
          { key: 'k', label: 'Type', right: true, render: f => <Pill tone={f.kind === 'reported' ? 'slate' : 'violet'}>{f.kind}</Pill> },
          { key: 's', label: 'Source', render: f => <span className="text-sm"><SourceLine s={f.source} /></span> },
        ]} />
      </Card>
      <Card title="Issue mix" solid>
        <IssueMix facts={o.facts} />
        <div className="mt-4 text-sm ink2">
          <div>Exchanges: <b>{o.exchanges?.join(', ') || '—'}</b></div>
          <div>BRLMs: <b>{o.intermediaries?.brlms?.join(', ') || '—'}</b></div>
          <div>Registrar: <b>{o.intermediaries?.registrar ?? '—'}</b></div>
        </div>
      </Card>
    </div>
  )
}

function IssueMix({ facts }: { facts: Record<string, Fact> }) {
  const fresh = fv(facts.fresh_issue), ofs = fv(facts.ofs)
  if (fresh == null || ofs == null) return <p className="muted">Fresh / OFS split not available</p>
  const t = fresh + ofs
  return (
    <div>
      <div className="flex h-4 rounded-full overflow-hidden">
        <div style={{ width: `${(fresh / t) * 100}%`, background: 'var(--accent)' }} />
        <div style={{ width: `${(ofs / t) * 100}%`, background: '#b07cff' }} />
      </div>
      <div className="flex justify-between mt-2 text-sm">
        <span><b style={{ color: 'var(--accent)' }}>●</b> Fresh {crore(fresh)} · {pct((fresh / t) * 100, 0)}</span>
        <span><b style={{ color: '#b07cff' }}>●</b> OFS {crore(ofs)} · {pct((ofs / t) * 100, 0)}</span>
      </div>
    </div>
  )
}

const FIN_ROWS: [string, string][] = [['revenue_from_operations', 'Revenue from operations'], ['ebitda', 'EBITDA'], ['depreciation', 'D&A'],
  ['ebit', 'EBIT'], ['finance_cost', 'Finance cost'], ['other_income', 'Other income'], ['pbt', 'PBT'], ['tax', 'Tax'], ['pat', 'PAT'],
  ['total_debt', 'Total debt'], ['cash', 'Cash & equivalents']]

function Financials({ r }: { r: CompanyRecord }) {
  const { periods, byMetric } = finTable(r)
  if (!periods.length) return <Card>Financials not available yet.</Card>
  const val = (m: string, p: string) => fv(byMetric.get(m)?.get(p))
  const chart = periods.map(p => ({ p, Revenue: val('revenue_from_operations', p), EBITDA: val('ebitda', p),
    'EBITDA margin %': val('ebitda', p) != null && val('revenue_from_operations', p) ? +((val('ebitda', p)! / val('revenue_from_operations', p)!) * 100).toFixed(1) : null }))
  const ratios: [string, (p: string) => number | null][] = [
    ['EBITDA margin', p => div(val('ebitda', p), val('revenue_from_operations', p))],
    ['EBIT margin', p => div(val('ebit', p), val('revenue_from_operations', p))],
    ['PAT margin', p => div(val('pat', p), val('revenue_from_operations', p))],
    ['Revenue growth', p => { const i = periods.indexOf(p); return i > 0 ? growth(val('revenue_from_operations', periods[i - 1]), val('revenue_from_operations', p)) : null }],
    ['PAT growth', p => { const i = periods.indexOf(p); return i > 0 ? growth(val('pat', periods[i - 1]), val('pat', p)) : null }],
  ]
  return (
    <div className="space-y-5">
      <Card title="Revenue, EBITDA and margin" solid>
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="p" tick={{ fill: 'var(--ink-3)', fontSize: 13 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fill: 'var(--ink-3)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={x => `₹${x}`} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: 'var(--ink-3)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} />
              <Tooltip contentStyle={{ background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12 }} />
              <Legend />
              <Bar yAxisId="l" dataKey="Revenue" fill="#0a84ff" radius={[6, 6, 0, 0]} />
              <Bar yAxisId="l" dataKey="EBITDA" fill="#7d5cff" radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" dataKey="EBITDA margin %" stroke="#ff9f0a" strokeWidth={2.5} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="muted text-xs">₹ crore, restated consolidated. Margin is calculated.</p>
      </Card>
      <Card title="Restated financials (₹ crore)" solid>
        <Table rows={FIN_ROWS.filter(([m]) => byMetric.has(m))} cols={[
          { key: 'm', label: 'Metric', render: ([, l]) => <b>{l}</b> },
          ...periods.map(p => ({ key: p, label: p, right: true, render: ([m]: [string, string]) => <FactValue f={byMetric.get(m)?.get(p)} /> })),
        ]} />
      </Card>
      <Card title="Calculated ratios" solid>
        <Table rows={ratios} cols={[
          { key: 'm', label: 'Ratio', render: ([l]) => <b>{l}</b> },
          ...periods.map(p => ({ key: p, label: p, right: true, render: ([, fn]: [string, (p: string) => number | null]) => {
            const x = fn(p); return <span className={x != null && x < 0 ? 'neg' : ''}>{pct(x)}</span> } })),
        ]} />
        <p className="muted text-xs mt-2">ROE / ROCE need balance-sheet equity and capital employed — extracted in Phase 5.</p>
      </Card>
    </div>
  )
}
const div = (a: number | null, b: number | null) => (a != null && b ? (a / b) * 100 : null)
const growth = (a: number | null, b: number | null) => (a != null && b != null && a > 0 ? ((b / a) - 1) * 100 : null)

function Industry({ r }: { r: CompanyRecord }) {
  const facts = r.facts?.industry ?? []
  if (!facts.length) return <Card>Industry statistics have not been extracted from the offer document yet.</Card>
  const groups = new Map<string, Fact[]>()
  for (const f of facts) { if (!groups.has(f.metric)) groups.set(f.metric, []); groups.get(f.metric)!.push(f) }
  const size = (groups.get('industry_market_size') ?? []).filter(f => fyYear(f.period)).sort((a, b) => fyYear(a.period)! - fyYear(b.period)!)
  const rev = finTable(r)
  const revM = rev.byMetric.get('revenue_from_operations')
  const histInd = size.filter(f => !f.period?.endsWith('E'))
  const fwdInd = size.filter(f => f.period?.endsWith('E'))
  const indCagr = histInd.length >= 2 ? cagr(fv(histInd[0])!, fv(histInd.at(-1))!, fyYear(histInd.at(-1)!.period)! - fyYear(histInd[0].period)!) : null
  const fwdCagr = histInd.length && fwdInd.length ? cagr(fv(histInd.at(-1))!, fv(fwdInd.at(-1))!, fyYear(fwdInd.at(-1)!.period)! - fyYear(histInd.at(-1)!.period)!) : null
  const ps = rev.periods
  const coCagr = revM && ps.length >= 2 ? cagr(fv(revM.get(ps[0])) ?? 0, fv(revM.get(ps.at(-1)!)) ?? 0, fyYear(ps.at(-1))! - fyYear(ps[0])!) : null
  return (
    <div className="space-y-5">
      <div className="glass panel p-4 text-sm ink2">Only quantitative statements disclosed in the offer document are used here. Every figure links to its page.</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label={`Industry CAGR ${histInd[0]?.period ?? ''}–${histInd.at(-1)?.period ?? ''}`} value={pct(indCagr)} sub="calculated from disclosed market size" />
        <Kpi label={`Industry CAGR to ${fwdInd.at(-1)?.period ?? '—'}`} value={pct(fwdCagr)} sub="offer-document projection" />
        <Kpi label={`Company revenue CAGR ${ps[0] ?? ''}–${ps.at(-1) ?? ''}`} value={pct(coCagr)}
          sub={coCagr != null && indCagr ? `${(coCagr / indCagr).toFixed(1)}× industry growth (different windows — compare with care)` : undefined} />
      </div>
      {[...groups.entries()].map(([metric, fs]) => (
        <Card key={metric} title={fs[0].label ?? humanize(metric)} solid>
          <Table rows={[fs]} cols={fs.map(f => ({ key: f.fact_id, label: f.period ?? '—', right: true, render: () => <FactValue f={f} /> }))} />
          <p className="muted text-xs mt-2">Source: <SourceLine s={fs[0].source} /></p>
        </Card>
      ))}
    </div>
  )
}

function Valuation({ r }: { r: CompanyRecord }) {
  const rows = valuationInputs(r)
  return (
    <Card title="Implied valuation inputs at issue price" solid>
      <p className="muted text-sm mb-3">Mechanical calculations from disclosed figures — inputs for your own model, not a view on value.</p>
      <Table rows={rows} cols={[
        { key: 'l', label: 'Metric', render: x => <b>{x.label}</b> },
        { key: 'v', label: 'Value', right: true, render: x => !x.meaningful ? <span className="muted">{x.why ?? 'Not available'}</span>
            : x.unit === 'x' ? `${x.value!.toFixed(1)}x` : crore(x.value) },
        { key: 'f', label: 'Formula', render: x => <span className="muted text-sm">{x.formula}</span> },
      ]} />
      <p className="muted text-xs mt-3">Uses final issue price where known, otherwise upper end of the price band ({inrBand(r)}).</p>
    </Card>
  )
}
const inrBand = (r: CompanyRecord) => issuePrice(r) != null ? `₹${issuePrice(r)}` : 'n/a'

function Timeline({ r }: { r: CompanyRecord }) {
  const v = useVault()
  return (
    <Card title="Lifecycle" solid>
      <ol className="relative ml-3">
        {r.events.map(e => {
          const past = daysUntil(e.date) < 0
          return (
            <li key={e.event_id} className="pl-6 pb-5 relative" style={{ borderLeft: '2px solid var(--hairline)' }}>
              <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full" style={{ background: past ? 'var(--ink-3)' : e.date_kind === 'derived' ? '#b07cff' : 'var(--accent)' }} />
              <div className="flex flex-wrap items-center gap-2">
                <b>{fmtDate(e.date)}</b>
                <span>{v.event_types[e.event_type]?.label ?? e.event_type}</span>
                <Pill tone={e.date_kind === 'actual' ? 'green' : e.date_kind === 'scheduled' ? 'blue' : 'violet'}>{e.date_kind}</Pill>
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
      <Table rows={r.lockins} empty="No lock-ins computed (needs allotment date and capital-structure figures)" cols={[
        { key: 'h', label: 'Holder', render: l => <b>{holder(l.holder_category)}</b> },
        { key: 's', label: 'Shares', right: true, render: l => <FactValue f={l.shares} /> },
        { key: 'p', label: '% post-issue', right: true, render: l => <FactValue f={l.pct_post_issue} /> },
        { key: 'st', label: 'From (allotment)', right: true, render: l => fmtDate(l.start_date) },
        { key: 'e', label: 'Expiry', right: true, render: l => <b>{fmtDate(l.expiry_date)}</b> },
        { key: 'u', label: 'Status', right: true, render: l => { const d = daysUntil(l.expiry_date), u = urgency(d); return <Pill tone={u.tone}>{d < 0 ? 'Expired' : `${d}d`}</Pill> } },
        { key: 'r', label: 'Rule', render: l => <span className="text-sm">{l.rule_id} {!l.rule_verified && <Pill tone="amber">unverified rule</Pill>}</span> },
      ]} />
      <p className="muted text-xs mt-3">Unlocked shares become eligible for sale; that does not mean they will be sold.</p>
    </Card>
  )
}

function Docs({ r }: { r: CompanyRecord }) {
  return (
    <Card title="Documents" solid>
      <Table rows={r.documents} empty="No documents registered" cols={[
        { key: 't', label: 'Type', render: d => <Pill tone="blue">{d.doc_type}</Pill> },
        { key: 'n', label: 'Document', render: d => d.url.startsWith('http') ? <a href={d.url} target="_blank" rel="noreferrer">{d.title ?? d.document_id}</a> : (d.title ?? d.document_id) },
        { key: 'f', label: 'Filed', right: true, render: d => fmtDate(d.filing_date) },
        { key: 'v', label: 'Version', right: true, render: d => `v${d.version}` },
        { key: 'p', label: 'Pages', right: true, render: d => d.pages ?? '—' },
        { key: 'h', label: 'SHA-256', render: d => <code className="text-xs muted">{d.sha256?.slice(0, 12) ?? '—'}</code> },
      ]} />
    </Card>
  )
}

function NewsTab({ r }: { r: CompanyRecord }) {
  return (
    <Card title="News & announcements" solid>
      <Table rows={r.news} empty="No news yet" cols={[
        { key: 't', label: 'Time', render: n => fmtDateTime(n.published_at) },
        { key: 'c', label: 'Type', render: n => <Pill tone={n.tier === 'official' ? 'blue' : 'slate'}>{n.category.replace(/_/g, ' ')}</Pill> },
        { key: 'h', label: 'Headline', render: n => n.url.startsWith('http') ? <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> : n.title },
        { key: 'p', label: 'Source', render: n => n.publisher ?? '—' },
      ]} />
    </Card>
  )
}

function ChangesTab({ r }: { r: CompanyRecord }) {
  const v = useVault()
  const rows = v.changes.filter(c => c.company_id === r.company.company_id)
  return (
    <Card title="Detected changes" solid>
      <Table rows={rows} empty="No changes detected" cols={[
        { key: 'd', label: 'Detected', render: c => fmtDateTime(c.detected_at) },
        { key: 'l', label: 'Change', render: c => <b>{c.label ?? c.field}</b> },
        { key: 'o', label: 'From', render: c => <s className="muted">{c.old == null ? '—' : String(c.old)}</s> },
        { key: 'n', label: 'To', render: c => <b>{String(c.new)}</b> },
        { key: 's', label: 'Source', render: c => <SourceLine s={c.source} /> },
      ]} />
    </Card>
  )
}
