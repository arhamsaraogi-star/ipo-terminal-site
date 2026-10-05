import { useVault } from '../App'
import { fmtDateTime } from '../lib/format'
import { intelKey } from '../lib/portfolio'
import type { PressValuation } from '../lib/types'
import { Card } from './ui'

export const pressText = (v: PressValuation) =>
  v.currency === 'INR' ? `₹${(v.value_cr ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} cr` : `${v.currency} ${(v.value_mn! >= 1000 ? `${(v.value_mn! / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} bn` : `${v.value_mn!.toLocaleString('en-US', { maximumFractionDigits: 0 })} mn`)}`

/** Google News headlines + valuation mentions for a company, fetched by the refresh job for names members track. */
export function WebIntel({ name, onUse, pending }: { name: string; onUse?: (v: PressValuation) => void; pending?: boolean }) {
  const v = useVault()
  const it = v.private_intel?.[intelKey(name)]
  if (!it) return pending === false ? null : (
    <Card title="In the news" solid><p className="muted text-sm">Searching the web for “{name}” — news and any press-reported valuations appear after the next refresh (usually within 15 minutes).</p></Card>
  )
  return (
    <div className="grid xl:grid-cols-[1.4fr_1fr] gap-5">
      <Card title="In the news" solid>
        {it.news.length ? (
          <ul className="space-y-3">
            {it.news.slice(0, 10).map((n, i) => (
              <li key={i} className="min-w-0">
                <div className="muted text-xs">{[n.publisher, n.published_at && fmtDateTime(n.published_at)].filter(Boolean).join(' · ')}</div>
                <a href={n.url} target="_blank" rel="noreferrer" className="font-medium no-underline line-clamp-2" style={{ color: 'var(--ink)' }}>{n.title}</a>
              </li>
            ))}
          </ul>
        ) : <p className="muted text-sm">No recent headlines found.</p>}
        <p className="muted text-xs mt-3">Google News · checked {fmtDateTime(it.fetched_at)}</p>
      </Card>
      <Card title="Valuations in the press" solid>
        {it.valuations.length ? (
          <ul className="space-y-3">
            {it.valuations.map((x, i) => (
              <li key={i} className="flex gap-3 items-start justify-between">
                <div className="min-w-0">
                  <div className="display text-[20px] font-semibold">{pressText(x)}</div>
                  <a href={x.url} target="_blank" rel="noreferrer" className="text-sm ink2 line-clamp-2">{x.title}</a>
                  <div className="muted text-xs">{[x.publisher, x.date && fmtDateTime(x.date)].filter(Boolean).join(' · ')}</div>
                </div>
                {onUse && <button className="btn !h-8 text-sm shrink-0" onClick={() => onUse(x)}>Use as mark</button>}
              </li>
            ))}
          </ul>
        ) : <p className="muted text-sm">No valuation figure found in recent headlines.</p>}
        <p className="muted text-xs mt-3">Figures quoted in headlines — check the article before relying on them.</p>
      </Card>
    </div>
  )
}
