import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { num } from '../lib/format'
import type { IndustrySeries } from '../lib/types'

// categorical slots in fixed order (validated palette, dark-surface steps)
const HUES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']

const yearOf = (p: string) => {
  const m = p.match(/(\d{4})|(?:CY|FY|F)'?(\d{2})/i)
  return m ? (m[1] ? +m[1] : 2000 + +m[2]) : null
}

/** Re-order a series chronologically (some tables print newest first). */
function chrono(s: IndustrySeries) {
  const idx = s.periods.map((_, i) => i).sort((a, b) => (yearOf(s.periods[a]) ?? 0) - (yearOf(s.periods[b]) ?? 0) || Number(s.projected?.[a]) - Number(s.projected?.[b]))
  return {
    periods: idx.map(i => s.periods[i]), projected: idx.map(i => !!s.projected?.[i]),
    rows: s.rows.map(r => ({ name: r.name, values: idx.map(i => r.values[i]) })),
  }
}

/** CAGR between the first and last printed values (calculated here, labelled as such). */
export function seriesCagr(periods: string[], values: (number | null)[], projected: boolean[], onlyActual = false) {
  const pts = periods.map((p, i) => ({ y: yearOf(p), v: values[i], proj: projected[i] })).filter(x => x.v != null && x.y != null && (!onlyActual || !x.proj))
  if (pts.length < 2) return null
  const a = pts[0], b = pts[pts.length - 1]
  const n = b.y! - a.y!
  if (n <= 0 || a.v! <= 0 || b.v! <= 0) return null
  return { pct: (Math.pow(b.v! / a.v!, 1 / n) - 1) * 100, a, b }
}

/** Forecast CAGR: from the last actual (non-projected) value to the last projected value. Null if nothing is projected. */
export function forecastCagr(periods: string[], values: (number | null)[], projected: boolean[]) {
  const pts = periods.map((p, i) => ({ p, y: yearOf(p), v: values[i], proj: projected[i] })).filter(x => x.v != null && x.y != null && x.v > 0)
  const act = pts.filter(x => !x.proj), fut = pts.filter(x => x.proj)
  if (!act.length || !fut.length) return null
  const a = act[act.length - 1], b = fut[fut.length - 1]
  const n = b.y! - a.y!
  if (n <= 0) return null
  return { pct: (Math.pow(b.v! / a.v!, 1 / n) - 1) * 100, a, b }
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? num(v, 0) : Math.abs(v) >= 10 ? num(v, 1) : num(v, 2))

function ChartCard({ s, pdf }: { s: IndustrySeries; pdf?: string }) {
  const c = chrono(s)
  const single = c.rows.length === 1
  const rows = c.rows.filter(r => !/^total$/i.test(r.name.trim())).slice(0, 6)
  const total = c.rows.find(r => /^total$/i.test(r.name.trim()))
  const main = single ? c.rows[0] : total ?? rows[0]
  const fc = main ? forecastCagr(c.periods, main.values, c.projected) : null
  const hist = main ? seriesCagr(c.periods, main.values, c.projected, true) : null
  const data = c.periods.map((p, i) => {
    const o: Record<string, number | string | boolean | null> = { p, proj: c.projected[i] }
    for (const r of single ? c.rows : rows) o[r.name] = r.values[i]
    return o
  })
  const tip = { contentStyle: { background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12, fontSize: 12 }, formatter: (x: unknown, n: unknown) => [fmt(Number(x)) + (s.unit ? ` ${s.unit}` : ''), single ? 'Value' : String(n)] as [string, string] }
  const href = s.source?.url?.startsWith('http') ? `${s.source.url}#page=${s.page}` : pdf ? `${pdf}#page=${s.page}` : undefined
  return (
    <div className="glass panel p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold leading-snug text-[15px]">{s.title}</div>
          <div className="muted text-xs mt-0.5">{[s.unit, `${c.periods[0]}–${c.periods[c.periods.length - 1]}`, !single && rows.length ? `${rows.length} series` : null].filter(Boolean).join(' · ')}</div>
        </div>
        {fc ? <div className="text-right shrink-0"><div className={`display text-[20px] font-semibold ${fc.pct >= 0 ? 'pos' : 'neg'}`}>{fc.pct >= 0 ? '+' : ''}{fc.pct.toFixed(1)}%</div>
          <div className="muted text-[11px]">forecast CAGR {fc.a.p}–{fc.b.p}</div></div>
          : hist && <div className="text-right shrink-0 muted text-[11px] leading-tight">historical<br />{hist.pct >= 0 ? '+' : ''}{hist.pct.toFixed(1)}% a year</div>}
      </div>
      <div className="h-[190px] mt-2">
        <ResponsiveContainer>
          {single ? (
            <BarChart data={data} margin={{ top: 18, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="p" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--ink-3)', fontSize: 10 }} axisLine={false} tickLine={false} width={44} tickFormatter={v => fmt(Number(v))} />
              <Tooltip {...tip} cursor={{ fill: 'var(--hairline)' }} />
              <Bar dataKey={c.rows[0].name} radius={[4, 4, 0, 0]} maxBarSize={34} label={data.length <= 8 ? { position: 'top', fill: 'var(--ink-2)', fontSize: 10, formatter: (v: unknown) => (v == null ? '' : fmt(Number(v))) } : false}>
                {data.map((d, i) => <Cell key={i} fill={HUES[0]} fillOpacity={d.proj ? 0.45 : 1} />)}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="p" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--ink-3)', fontSize: 10 }} axisLine={false} tickLine={false} width={44} tickFormatter={v => fmt(Number(v))} />
              <Tooltip {...tip} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} iconType="plainline" />
              {rows.map((r, i) => <Line key={r.name} dataKey={r.name} stroke={HUES[i]} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 text-[11px] muted">
        <span>{c.projected.some(Boolean) ? 'Faded = estimate / projection · ' : ''}{s.kind === 'text' ? 'from statement' : s.kind === 'table' ? 'from table' : 'from chart labels'}</span>
        {href ? <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted">p.{s.page}</a> : <span>p.{s.page}</span>}
      </div>
      {s.note && <div className="muted text-[11px] mt-1">{s.note}</div>}
    </div>
  )
}

export function IndustryCharts({ series }: { series: IndustrySeries[] }) {
  const [showMacro, setShowMacro] = useState(false)
  const sector = series.filter(s => !s.macro)
  const macro = series.filter(s => s.macro)
  const headline = sector.map(s => {
    const c = chrono(s); const r = c.rows.find(x => /^total$/i.test(x.name.trim())) ?? c.rows[0]
    const g = r ? forecastCagr(c.periods, r.values, c.projected) : null
    const score = (c.projected.some(Boolean) ? 3 : 0) + (/₹|rs|us\$|usd|bn|mn|cr|lakh|tonne|tpa|units|sq/i.test(`${s.unit ?? ''} ${s.title}`) ? 2 : 0)
      + (s.kind !== 'text' ? 1 : 0) + Math.min(c.periods.length, 8) * 0.1 - (/share|%|growth|change|y-o-y|yoy/i.test(`${s.unit ?? ''} ${s.title}`) ? 2 : 0)
    return g && g.b.y! - g.a.y! >= 2 ? { s, g, score } : null
  }).filter(Boolean).sort((a, b) => b!.score - a!.score).slice(0, 4) as { s: IndustrySeries; g: NonNullable<ReturnType<typeof forecastCagr>> }[]
  const hasFc = (s: IndustrySeries) => { const c = chrono(s); return c.rows.some(r => forecastCagr(c.periods, r.values, c.projected)) }
  const ordered = [...sector.filter(hasFc), ...sector.filter(s => !hasFc(s))]
  return (
    <div className="space-y-5">
      {!!headline.length && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {headline.map(({ s, g }, i) => (
            <div key={i} className="glass p-4">
              <div className="eyebrow line-clamp-2">{s.title}</div>
              <div className={`display text-[30px] font-semibold mt-1 ${g.pct >= 0 ? 'pos' : 'neg'}`}>{g.pct >= 0 ? '+' : ''}{g.pct.toFixed(1)}%</div>
              <div className="muted text-xs">forecast CAGR {g.a.p}–{g.b.p} · {fmt(g.a.v!)} → {fmt(g.b.v!)}{s.unit ? ` ${s.unit}` : ''}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {ordered.map((s, i) => <ChartCard key={i} s={s} />)}
      </div>
      {!!macro.length && (
        <div>
          <button className="btn" onClick={() => setShowMacro(x => !x)}>{showMacro ? 'Hide' : 'Show'} economy backdrop ({macro.length})</button>
          {showMacro && <div className="grid md:grid-cols-2 gap-4 mt-4">{macro.map((s, i) => <ChartCard key={i} s={s} />)}</div>}
        </div>
      )}
      <p className="muted text-xs">Rebuilt from the data labels, tables and statements printed in the offer document's Industry Overview (commissioned report). Forecast CAGR = from the last actual year to the last projected year (E / P / F), calculated here from the printed values; charts with forecasts come first.</p>
    </div>
  )
}
