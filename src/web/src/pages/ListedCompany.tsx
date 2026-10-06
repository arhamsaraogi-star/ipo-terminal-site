import { useVault, usePf, go } from '../App'
import { Card, PageHead } from '../components/ui'
import { listedId, pickFromRow, screenerUrl, setTrack } from '../lib/portfolio'
import { crore, inr } from '../lib/format'

/** Search result for an already-listed company that is not in the IPO pipeline. Nothing is tracked until you ask. */
export default function ListedCompany({ symbol }: { symbol: string }) {
  const v = useVault()
  const { pf, setPf } = usePf()
  const row = v.listed_index?.find(r => r[0] === symbol)
  const mine = (pf.listed ?? []).some(x => x.company_id === listedId(symbol))
  if (!row && !mine) return <PageHead title="Company not found" sub="It is not in the exchange list in this build." />
  const r = row ?? [symbol, symbol, null, null, null, null, null] as const
  const add = (track: boolean) => {
    const pick = pickFromRow(r as Parameters<typeof pickFromRow>[0])
    let next = { ...pf, listed: [...(pf.listed ?? []).filter(x => x.company_id !== pick.company_id), pick] }
    if (track) next = setTrack(next, pick.company_id, 'INTERESTED')
    setPf(next)
    go(`/company/${pick.company_id}`)
  }
  return (
    <div className="space-y-5">
      <PageHead title={r[1]} sub={`NSE: ${r[0]}${r[2] ? ` · ${r[2]}` : ''}${r[3] ? ` · ${r[3] === 'SME' ? 'SME' : 'Mainboard'}` : ''} · already listed`} />
      <Card solid>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><div className="eyebrow">Last close</div><div className="display text-[28px] font-semibold">{r[4] != null ? inr(r[4], 2) : '—'}</div></div>
          <div><div className="eyebrow">Market cap</div><div className="display text-[28px] font-semibold">{r[5] != null ? crore(r[5]) : '—'}</div></div>
          <div><div className="eyebrow">Listed on</div><div className="display text-[28px] font-semibold">{r[6] ?? '—'}</div></div>
        </div>
        <p className="muted text-sm mt-4">This company is not part of the IPO pipeline, so it appears nowhere else in the terminal. Track it or add it to your portfolio and it becomes a normal record, with its news followed from then on.</p>
        <div className="flex gap-2 flex-wrap mt-4">
          <button className="btn btn-primary" onClick={() => add(true)}>◎ Track and follow news</button>
          <button className="btn" onClick={() => add(false)}>★ Add to portfolio…</button>
          <a className="btn" href={screenerUrl(r[0])} target="_blank" rel="noreferrer">Screener ↗</a>
        </div>
      </Card>
    </div>
  )
}
