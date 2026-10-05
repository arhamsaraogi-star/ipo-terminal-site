import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { go, usePf, useVault } from '../App'
import { Card, Delta, Pill } from '../components/ui'
import { TrackButton } from '../components/Track'
import { holdingMarks } from '../lib/derive'
import { fmtDate, pct } from '../lib/format'
import { fmtCur, slug, toCr, unitLabel } from '../lib/portfolio'
import type { CompanyRecord, Holding, PrivateCo, Round } from '../lib/types'

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED', 'JPY', 'CNY', 'HKD', 'AUD', 'CAD', 'CHF']
const ROUND_LABELS = ['Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E+', 'Pre-IPO', 'Secondary', 'Bridge', 'Internal mark', 'Fund NAV mark']
const num = (x: string) => (x.trim() ? Number(x.replace(/[,₹$\s]/g, '')) : null)
const today = () => new Date().toISOString().slice(0, 10)

/** Add or edit any private company in the world, its funding rounds, and (optionally) your investment. */
export function PrivateForm({ existing, initialName = '', onDone }: { existing?: PrivateCo; initialName?: string; onDone?: () => void }) {
  const { pf, setPf } = usePf()
  const [name, setName] = useState(existing?.name ?? initialName)
  const [country, setCountry] = useState(existing?.country ?? 'India')
  const [sector, setSector] = useState(existing?.sector ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? 'INR')
  const [fx, setFx] = useState(existing?.fx_inr ? String(existing.fx_inr) : '')
  const [website, setWebsite] = useState(existing?.website ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [rounds, setRounds] = useState<{ date: string; label: string; val: string; pps: string; lead: string }[]>(
    (existing?.rounds ?? []).map(r => ({ date: r.date, label: r.label, val: r.post_money != null ? String(r.post_money) : '', pps: r.price_per_share != null ? String(r.price_per_share) : '', lead: r.lead ?? '' })))
  const held = existing ? pf.holdings.find(h => h.company_id === existing.company_id) : undefined
  const [inv, setInv] = useState({ on: !!held || !existing, date: held?.acquired_on ?? today(), amount: held?.invested_cr != null ? String(held.invested_cr) : '',
    val: held?.entry_valuation_cr != null ? String(held.entry_valuation_cr) : '', qty: held?.quantity ? String(held.quantity) : '', pps: held?.avg_cost ? String(held.avg_cost) : '' })
  const [err, setErr] = useState('')
  const u = unitLabel(currency)

  const save = () => {
    if (name.trim().length < 2) return setErr('Enter the company name.')
    if (currency !== 'INR' && !num(fx)) return setErr(`Enter the ${currency}→INR rate so the portfolio can total in rupees (e.g. 84 for USD).`)
    const id = existing?.company_id ?? `pvt-${slug(name)}-${Date.now().toString(36).slice(-4)}`
    const rs: Round[] = rounds.filter(r => r.date && (num(r.val) || num(r.pps))).map(r => ({ date: r.date, label: r.label || 'Round', post_money: num(r.val), price_per_share: num(r.pps), lead: r.lead || null }))
    const p: PrivateCo = { company_id: id, name: name.trim(), country: country.trim() || '—', sector: sector.trim() || null, currency, fx_inr: currency === 'INR' ? null : num(fx),
      website: website.trim() || null, note: note.trim() || null, rounds: rs, created_on: existing?.created_on ?? today() }
    let holdings = pf.holdings.filter(h => h.company_id !== id)
    if (inv.on && (num(inv.amount) || (num(inv.qty) && num(inv.pps)))) {
      const h: Holding = { company_id: id, route: 'PRE_IPO', acquired_on: inv.date, quantity: num(inv.qty) ?? 0, avg_cost: num(inv.pps) ?? 0,
        invested_cr: num(inv.amount), entry_valuation_cr: num(inv.val), currency }
      if (!h.entry_valuation_cr && !h.avg_cost) return setErr('Add your entry valuation (or price per share) so returns can be marked.')
      holdings = [...holdings, h]
    } else if (held && !inv.on) {
      holdings = pf.holdings.filter(h => h.company_id !== id)
    } else if (held) holdings = pf.holdings
    p.rounds = rs.sort((a, b) => a.date.localeCompare(b.date))
    setPf({ ...pf, privates: [...pf.privates.filter(x => x.company_id !== id), p], holdings })
    onDone ? onDone() : go(`/company/${id}`)
  }

  const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="text-sm block">{t}<div className="mt-1">{children}</div></label>
  return (
    <div className="space-y-5">
      <Card title={existing ? `Edit ${existing.name}` : 'Add a private company'} solid>
        <p className="muted text-sm mb-4">Any unlisted company, anywhere. Private to your login (encrypted, synced across your devices). Amounts in {currency === 'INR' ? '₹ crore' : `${currency} millions`}.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <L t="Company name *"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Zepto, Databricks" autoFocus /></L>
          <L t="Country"><input className="input" value={country} onChange={e => setCountry(e.target.value)} /></L>
          <L t="Sector"><input className="input" value={sector} onChange={e => setSector(e.target.value)} placeholder="e.g. Quick commerce" /></L>
          <L t="Currency"><select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></L>
          {currency !== 'INR' && <L t={`₹ per 1 ${currency}`}><input className="input" value={fx} onChange={e => setFx(e.target.value)} inputMode="decimal" placeholder={currency === 'USD' ? '84' : ''} /></L>}
          <L t="Website"><input className="input" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" /></L>
        </div>
        <div className="mt-3"><L t="Notes"><textarea className="input !h-20 py-2" value={note} onChange={e => setNote(e.target.value)} placeholder="Thesis, contacts, IPO timing…" /></L></div>
      </Card>

      <Card title="Funding rounds & marks" action={<button className="btn" onClick={() => setRounds([...rounds, { date: today(), label: 'Series A', val: '', pps: '', lead: '' }])}>+ Add round</button>} solid>
        {!rounds.length && <p className="muted text-sm">Add each priced round (or an internal mark). Your position is marked to the latest one.</p>}
        <div className="space-y-2">
          {rounds.map((r, i) => {
            const set = (k: string, v: string) => setRounds(rounds.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
            return (
              <div key={i} className="grid grid-cols-2 md:grid-cols-[150px_150px_1fr_1fr_1fr_auto] gap-2 items-end">
                <L t="Date"><input className="input" type="date" value={r.date} onChange={e => set('date', e.target.value)} /></L>
                <L t="Round"><input className="input" list="round-labels" value={r.label} onChange={e => set('label', e.target.value)} /></L>
                <L t={`Post-money (${u})`}><input className="input" value={r.val} onChange={e => set('val', e.target.value)} inputMode="decimal" /></L>
                <L t={`Price / share (${currency})`}><input className="input" value={r.pps} onChange={e => set('pps', e.target.value)} inputMode="decimal" placeholder="optional" /></L>
                <L t="Lead investor"><input className="input" value={r.lead} onChange={e => set('lead', e.target.value)} placeholder="optional" /></L>
                <button className="btn" onClick={() => setRounds(rounds.filter((_, j) => j !== i))} aria-label="Remove round">✕</button>
              </div>
            )
          })}
        </div>
        <datalist id="round-labels">{ROUND_LABELS.map(l => <option key={l} value={l} />)}</datalist>
      </Card>

      <Card title="Our investment" action={<label className="text-sm flex items-center gap-2"><input type="checkbox" checked={inv.on} onChange={e => setInv({ ...inv, on: e.target.checked })} /> We hold this</label>} solid>
        {inv.on ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <L t="Date invested"><input className="input" type="date" value={inv.date} onChange={e => setInv({ ...inv, date: e.target.value })} /></L>
            <L t={`Amount invested (${u})`}><input className="input" value={inv.amount} onChange={e => setInv({ ...inv, amount: e.target.value })} inputMode="decimal" /></L>
            <L t={`Entry post-money (${u})`}><input className="input" value={inv.val} onChange={e => setInv({ ...inv, val: e.target.value })} inputMode="decimal" /></L>
            <L t="Shares (optional)"><input className="input" value={inv.qty} onChange={e => setInv({ ...inv, qty: e.target.value })} inputMode="numeric" /></L>
            <L t={`Price / share (${currency}, optional)`}><input className="input" value={inv.pps} onChange={e => setInv({ ...inv, pps: e.target.value })} inputMode="decimal" /></L>
          </div>
        ) : <p className="muted text-sm">Tick “We hold this” to add the position to the portfolio. Otherwise the company is just tracked.</p>}
      </Card>

      <div className="flex gap-2 items-center flex-wrap">
        <button className="btn btn-primary" onClick={save}>{existing ? 'Save changes' : 'Add company'}</button>
        {existing && <button className="btn" onClick={() => { if (confirmDelete()) { setPf({ ...pf, privates: pf.privates.filter(x => x.company_id !== existing.company_id), holdings: pf.holdings.filter(h => h.company_id !== existing.company_id), tracking: pf.tracking.filter(t => t.company_id !== existing.company_id) }); go('/portfolio') } }}>Delete company</button>}
        <button className="btn" onClick={() => (onDone ? onDone() : history.back())}>Cancel</button>
        {err && <span className="neg text-sm">{err}</span>}
      </div>
    </div>
  )
}
// inline two-step delete (no browser dialogs)
let armed = 0
function confirmDelete() { const now = Date.now(); if (now - armed < 4000) return true; armed = now; alertInline(); return false }
function alertInline() { const el = document.activeElement as HTMLButtonElement | null; if (el) { const t = el.textContent; el.textContent = 'Click again to delete'; setTimeout(() => { el.textContent = t }, 4000) } }

export function NewPrivatePage({ name }: { name?: string }) {
  return <PrivateForm initialName={name ?? ''} />
}

/** Company page for a private company you added. */
export function PrivateView({ r }: { r: CompanyRecord }) {
  const v = useVault()
  const p = r.custom!
  const [edit, setEdit] = useState(false)
  const h = v.portfolio.holdings.find(x => x.company_id === p.company_id)
  const marks = h ? holdingMarks(r, h) : null
  const last = p.rounds[p.rounds.length - 1]
  const first = p.rounds.find(x => x.post_money)
  const growth = first && last?.post_money && first.post_money && last.date > first.date
    ? (Math.pow(last.post_money / first.post_money, 1 / Math.max((Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 864e5), 0.25)) - 1) * 100 : null
  if (edit) return <PrivateForm existing={p} onDone={() => setEdit(false)} />
  const best = marks?.marks[marks.marks.length - 1]
  const pts = [...p.rounds.filter(x => x.post_money).map(x => ({ date: x.date, label: x.label, v: x.post_money, entry: false })),
    ...(h?.entry_valuation_cr ? [{ date: h.acquired_on, label: 'Our entry', v: h.entry_valuation_cr, entry: true }] : [])].sort((a, b) => a.date.localeCompare(b.date))
  const data = pts.map(x => ({ ...x, d: fmtDate(x.date, false) }))
  return (
    <div className="space-y-5">
      <header className="glass glass-strong p-5 md:p-6 fade-in">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Pill tone="violet">Private</Pill><Pill tone="slate">{p.country}</Pill>{p.sector && <Pill tone="slate">{p.sector}</Pill>}
              {h && <Pill tone="amber">★ In portfolio</Pill>}<Pill tone="slate">Added by you</Pill>
            </div>
            <h1 className="display text-[28px] md:text-[36px] font-bold leading-tight">{p.name}</h1>
            {p.website && <a className="muted text-sm" href={p.website} target="_blank" rel="noreferrer">{p.website.replace(/^https?:\/\//, '')}</a>}
          </div>
          <div className="flex gap-2 flex-wrap"><button className="btn btn-primary" onClick={() => setEdit(true)}>Edit / add round</button><TrackButton id={p.company_id} /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <div><div className="eyebrow">Latest valuation</div><div className="display text-[22px] font-semibold">{fmtCur(last?.post_money, p.currency)}</div><div className="muted text-xs">{last ? `${last.label} · ${fmtDate(last.date)}` : 'no rounds yet'}</div></div>
          <div><div className="eyebrow">Valuation CAGR</div><div className="display text-[22px] font-semibold"><Delta v={growth} /></div><div className="muted text-xs">first → latest round</div></div>
          <div><div className="eyebrow">Our multiple</div><div className={`display text-[22px] font-semibold ${best?.multiple != null ? (best.multiple >= 1 ? 'pos' : 'neg') : ''}`}>{best?.multiple != null ? `${best.multiple.toFixed(2)}x` : '—'}</div><div className="muted text-xs">{best?.cagr != null ? `${pct(best.cagr)} a year` : h ? 'needs a later round' : 'not held'}</div></div>
          <div><div className="eyebrow">Our cost</div><div className="display text-[22px] font-semibold">{h ? fmtCur(h.invested_cr, p.currency) : '—'}</div><div className="muted text-xs">{h ? `since ${fmtDate(h.acquired_on)}` : ''}{p.currency !== 'INR' && h?.invested_cr ? ` · ₹${toCr(h.invested_cr, p.currency, p.fx_inr)?.toFixed(1)} cr` : ''}</div></div>
        </div>
      </header>
      {p.note && <Card solid><p className="ink2 whitespace-pre-wrap">{p.note}</p></Card>}
      <Card title={`Valuation by round (${unitLabel(p.currency)})`} solid>
        {data.length ? (
          <div className="h-[260px]"><ResponsiveContainer>
            <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--ink-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
              <Tooltip contentStyle={{ background: 'var(--glass-solid)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(x) => [fmtCur(Number(x), p.currency), 'Post-money']} labelFormatter={(l, pl) => `${l} · ${pl?.[0]?.payload?.d ?? ''}`} />
              <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={48} label={{ position: 'top', fill: 'var(--ink-2)', fontSize: 11, formatter: (x: unknown) => fmtCur(Number(x), p.currency).replace(/ (cr|mn)$/, '') }}>
                {data.map((d, i) => <Cell key={i} fill={d.entry ? '#f5a623' : '#3987e5'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer></div>
        ) : <p className="muted">No rounds yet — press “Edit / add round”.</p>}
        <div className="tbl-wrap mt-3"><table className="tbl">
          <thead><tr><th>Date</th><th>Round</th><th className="r">Post-money</th><th className="r">Price / share</th><th>Lead</th>{h && <th className="r">vs our entry</th>}</tr></thead>
          <tbody>{[...p.rounds].reverse().map((x, i) => { const m = marks?.marks.find(mm => mm.date === x.date && mm.label === x.label); return (
            <tr key={i}><td data-label="Date" className="td-primary">{fmtDate(x.date)}</td><td data-label="Round">{x.label}</td><td data-label="Post-money" className="r">{fmtCur(x.post_money, p.currency)}</td>
              <td data-label="Price / share" className="r">{x.price_per_share ?? '—'}</td><td data-label="Lead">{x.lead ?? '—'}</td>
              {h && <td data-label="vs our entry" className="r">{m?.multiple != null ? <b className={m.multiple >= 1 ? 'pos' : 'neg'}>{m.multiple.toFixed(2)}x</b> : <span className="muted">before entry</span>}</td>}</tr>) })}</tbody>
        </table></div>
      </Card>
      <p className="muted text-xs">Private to your login — synced encrypted across your devices. Orange bar = your entry valuation.</p>
    </div>
  )
}
