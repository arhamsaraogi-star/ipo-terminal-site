import { useEffect, useRef, useState } from 'react'
import { usePf } from '../App'
import { TRACK, setTrack } from '../lib/portfolio'
import type { TrackStatus } from '../lib/types'
import { Pill } from './ui'

/** One button to track anything: Interested → Evaluating → In talks → Committed / Passed, with a private note. */
export function TrackButton({ id, compact = false }: { id: string; compact?: boolean }) {
  const { pf, setPf } = usePf()
  const cur = pf.tracking.find(t => t.company_id === id)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(cur?.note ?? '')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const pick = (s: TrackStatus | null) => { setPf(setTrack(pf, id, s, note)); if (!s) setOpen(false) }
  return (
    <div ref={ref} className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button className={`btn ${cur ? '' : ''}`} onClick={() => { setNote(cur?.note ?? ''); setOpen(o => !o) }} aria-expanded={open}>
        {cur ? <><span style={{ color: '#f5a623' }}>◉</span> {compact ? TRACK[cur.status].label : `Tracking · ${TRACK[cur.status].label}`}</> : '◎ Track'}
      </button>
      {open && (
        <div className="pop glass glass-strong right-0 top-11 w-[290px] p-3 space-y-2" style={{ color: 'var(--ink)' }}>
          <div className="eyebrow">Track this company</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(TRACK) as TrackStatus[]).map(s => (
              <button key={s} className="btn !h-8 !px-3 text-sm" aria-pressed={cur?.status === s} style={cur?.status === s ? { background: 'var(--accent)', color: '#fff' } : undefined} onClick={() => pick(s)}>{TRACK[s].label}</button>
            ))}
          </div>
          <textarea className="input !h-20 py-2 text-sm" placeholder="Private note (why, who to call, target size…)" value={note}
            onChange={e => setNote(e.target.value)} onBlur={() => cur && setPf(setTrack(pf, id, cur.status, note))} />
          <div className="flex justify-between items-center">
            {cur ? <button className="btn !h-8 text-sm" onClick={() => pick(null)}>Stop tracking</button> : <span className="muted text-xs">Pick a status to start</span>}
            <button className="btn !h-8 text-sm" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TrackPill({ id }: { id: string }) {
  const { pf } = usePf()
  const t = pf.tracking.find(x => x.company_id === id)
  return t ? <Pill tone={TRACK[t.status].tone}>{TRACK[t.status].label}</Pill> : null
}
