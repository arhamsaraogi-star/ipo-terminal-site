import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Fuse from 'fuse.js'
import { forgetSession, login, openWithSession, parseVault, recallSession, rememberSession, saltHex, type Session } from './lib/vault'
import { merge, pull, push, type SyncCfg } from './lib/sync'
import type { CompanyRecord, Vault } from './lib/types'
import { daysUntil, fmtDateTime } from './lib/format'
import { allLockins, upcomingEvents } from './lib/derive'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import CompanyPage from './pages/Company'
import Lockins from './pages/Lockins'
import Calendar from './pages/Calendar'
import { Changes, Filings, NewsPage, Review } from './pages/Feeds'
import { Listed, PrivateTracker } from './pages/Lists'
import Portfolio from './pages/Portfolio'
import AnchorDesk from './pages/AnchorDesk'
import { NewPrivatePage } from './pages/PrivateCo'
import { privateRecord, loadPf, savePf, takeLegacy, withTombstones, normalisePf, type Pf } from './lib/portfolio'

// ───────── data context ─────────
const Ctx = createContext<Vault | null>(null)
export const useVault = () => useContext(Ctx)!
const PfCtx = createContext<{ pf: Pf; setPf: (p: Pf) => void } | null>(null)
export const usePf = () => useContext(PfCtx)!

// ───────── hash router (no company names ever appear in server-visible URLs) ─────────
export function useRoute() {
  const [h, setH] = useState(() => location.hash.slice(1) || '/')
  useEffect(() => { const f = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0) }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}
export const go = (path: string) => { location.hash = path }

const VAULT_URL = `${import.meta.env.BASE_URL}vault.bin`
const META_URL = `${import.meta.env.BASE_URL}vault-meta.json`

export type SyncState = { mode: 'off' | 'syncing' | 'ok' | 'error'; at?: string; msg?: string }
const SyncCtx = createContext<{ sync: SyncState; username: string } | null>(null)
export const useSync = () => useContext(SyncCtx)!

export default function App() {
  const [vault, setVault] = useState<Vault | null>(null)
  const [buf, setBuf] = useState<ArrayBuffer | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const sessRef = useRef<Session | null>(null)
  const [username, setUsername] = useState('')
  const [updated, setUpdated] = useState<string | null>(null)
  const [pf, setPfState] = useState<Pf>(() => loadPf('__none__'))
  const pfRef = useRef(pf)
  const shaRef = useRef<string | null>(null)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const [sync, setSync] = useState<SyncState>({ mode: 'off' })
  const cfg = (vault as (Vault & { sync?: SyncCfg | null }) | null)?.sync ?? null
  const cfgRef = useRef<SyncCfg | null>(null)
  cfgRef.current = cfg

  const stamp = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const apply = (p: Pf) => { pfRef.current = p; setPfState(p); if (sessRef.current) savePf(p, sessRef.current.uid) }

  async function pushNow() {
    const s = sessRef.current, c = cfgRef.current
    if (!s || !c) return
    setSync({ mode: 'syncing' })
    try {
      for (let i = 0; i < 3; i++) {
        const r = await push(c, s, pfRef.current, shaRef.current)
        if (!r.conflict) { shaRef.current = r.sha; dirty.current = false; setSync({ mode: 'ok', at: stamp() }); return }
        const { remote, sha } = await pull(c, s)            // someone else saved first: merge, keep everything, retry
        shaRef.current = sha
        if (remote) apply(merge(pfRef.current, normalisePf(remote.pf)))
      }
      throw new Error('could not save after 3 attempts')
    } catch (e) { setSync({ mode: 'error', msg: (e as Error).message }) }
  }
  const setPf = (next: Pf) => {
    apply(withTombstones(pfRef.current, next))
    if (cfgRef.current) { dirty.current = true; clearTimeout(timer.current); timer.current = window.setTimeout(pushNow, 1200) }
  }

  async function startSession(s: Session, data: Vault, remember: boolean) {
    sessRef.current = s
    setUsername(s.username)
    if (remember) await rememberSession(s)
    let local = loadPf(s.uid)
    const legacy = takeLegacy()
    if (legacy) local = merge(local, legacy)
    apply(local)
    setVault(data)
    const c = (data as Vault & { sync?: SyncCfg | null }).sync
    if (!c) { setSync({ mode: 'off' }); return }
    cfgRef.current = c
    setSync({ mode: 'syncing' })
    try {
      const { remote, sha } = await pull(c, s)
      shaRef.current = sha
      const merged = remote ? merge(normalisePf(remote.pf), local) : local
      apply(merged)
      if (!remote || JSON.stringify(merged) !== JSON.stringify(normalisePf(remote.pf))) await pushNow()
      else setSync({ mode: 'ok', at: stamp() })
    } catch (e) { setSync({ mode: 'error', msg: (e as Error).message }) }
  }

  const view = useMemo(() => {
    if (!vault) return null
    const rd = vault.redirects ?? {}
    const fix = (id: string) => rd[id] ?? id
    const tracking = pf.tracking.map(t => ({ ...t, company_id: fix(t.company_id) }))
    return {
      ...vault, companies: [...vault.companies, ...pf.privates.map(privateRecord)],
      portfolio: { holdings: pf.holdings.map(h => ({ ...h, company_id: fix(h.company_id) })), tracking, privates: pf.privates,
        watchlist: tracking.filter(t => t.status !== 'PASSED').map(t => t.company_id) },
    }
  }, [vault, pf])

  // Live refresh: a newer build → fetch + decrypt in place; and pull portfolio changes made on other devices.
  useEffect(() => {
    if (!vault) return
    const check = async () => {
      try {
        const m = await (await fetch(`${META_URL}?t=${Date.now()}`, { cache: 'no-store' })).json()
        if (m.built_at && m.built_at !== vault.meta.built_at && sessRef.current) {
          const b = await (await fetch(`${VAULT_URL}?t=${Date.now()}`, { cache: 'no-store' })).arrayBuffer()
          setVault(await openWithSession<Vault>(parseVault(b), sessRef.current))
          setUpdated(stamp())
        }
      } catch { /* offline or mid-deploy: try again next tick */ }
      const s = sessRef.current, c = cfgRef.current
      if (s && c && !dirty.current) {
        try {
          const { remote, sha } = await pull(c, s)
          if (remote && sha !== shaRef.current && !dirty.current) { shaRef.current = sha; apply(normalisePf(remote.pf)) }
          setSync({ mode: 'ok', at: stamp() })
        } catch (e) { setSync({ mode: 'error', msg: (e as Error).message }) }
      }
    }
    const id = setInterval(check, 60_000)
    const onFocus = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onFocus) }
  }, [vault])

  useEffect(() => {
    fetch(`${VAULT_URL}?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`Vault not found (${r.status})`); return r.arrayBuffer() })
      .then(async b => {
        setBuf(b)
        const h = parseVault(b)
        const s = await recallSession(saltHex(h))
        if (s) { try { await startSession(s, await openWithSession<Vault>(h, s), false) } catch { await forgetSession() } }
      })
      .catch(e => setErr(String(e.message ?? e)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function unlock(user: string, pw: string, remember: boolean) {
    if (!buf) return
    setBusy(true); setErr('')
    try {
      const { data, session } = await login<Vault>(buf, user, pw)
      await startSession(session, data, remember)
    } catch (e) { setErr((e as Error).message.includes('Not a terminal') ? (e as Error).message : 'Unknown username or wrong password') } finally { setBusy(false) }
  }
  async function lock() {
    if (dirty.current) await pushNow()
    await forgetSession(); sessRef.current = null; shaRef.current = null
    setVault(null); setPfState(loadPf('__none__')); setSync({ mode: 'off' }); location.hash = '/'
  }

  return (
    <>
      <div className="ambient" aria-hidden><i /><i /><i /><i /></div>
      {vault
        ? <Ctx.Provider value={view}><PfCtx.Provider value={{ pf, setPf }}><SyncCtx.Provider value={{ sync, username }}><Shell onLock={lock} updated={updated} /></SyncCtx.Provider></PfCtx.Provider></Ctx.Provider>
        : <Login onUnlock={unlock} err={err} busy={busy} ready={!!buf} />}
    </>
  )
}

function Login({ onUnlock, err, busy, ready }: { onUnlock: (u: string, pw: string, r: boolean) => void; err: string; busy: boolean; ready: boolean }) {
  const [user, setUser] = useState(() => { try { return localStorage.getItem('ipo-terminal:last-user') ?? '' } catch { return '' } })
  const [pw, setPw] = useState('')
  const [remember, setRemember] = useState(true)
  const ref = useRef<HTMLInputElement>(null)
  const pref = useRef<HTMLInputElement>(null)
  useEffect(() => (user ? pref.current?.focus() : ref.current?.focus()), []) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e: FormEvent) => { e.preventDefault(); if (user && pw) { try { localStorage.setItem('ipo-terminal:last-user', user) } catch { /* noop */ } onUnlock(user, pw, remember) } }
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className={`glass glass-strong w-full max-w-[420px] p-9 fade-in ${err ? 'shake' : ''}`} key={err}>
        <div className="w-14 h-14 rounded-[18px] grid place-items-center mb-6 text-white text-2xl"
          style={{ background: 'linear-gradient(135deg,#0a84ff,#7d5cff)', boxShadow: '0 10px 30px rgba(10,132,255,.35)' }}>◆</div>
        <h1 className="display text-[30px] font-bold leading-tight">IPO Terminal</h1>
        <p className="muted mt-1 mb-7">Sign in to decrypt the terminal and your portfolio.</p>
        <input ref={ref} className="input" placeholder="Username" value={user} onChange={e => setUser(e.target.value)} autoComplete="username" aria-label="Username" autoCapitalize="none" spellCheck={false} />
        <input ref={pref} type="password" className="input mt-3" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" aria-label="Password" />
        <label className="flex items-center gap-2 mt-4 text-sm ink2 select-none">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Keep me signed in on this device
        </label>
        <button className="btn btn-primary w-full justify-center mt-6 h-11 text-[15px]" disabled={busy || !ready}>
          {busy ? 'Signing in…' : ready ? 'Sign in' : 'Loading…'}
        </button>
        {err && <p className="neg text-sm mt-4">{err}</p>}
        <p className="muted text-xs mt-6">AES-256 encrypted. Your password never leaves this browser; your portfolio syncs encrypted across your devices.</p>
      </form>
    </main>
  )
}

const NAV: { path: string; label: string; icon: string }[] = [
  { path: '/', label: 'Home', icon: '◉' },
  { path: '/anchor', label: 'Anchor Desk', icon: '⚓' },
  { path: '/ipos', label: 'IPOs', icon: '▤' },
  { path: '/listed', label: 'Listed', icon: '◆' },
  { path: '/lockins', label: 'Lock-ins', icon: '⌛' },
  { path: '/portfolio', label: 'Portfolio', icon: '★' },
  { path: '/activity', label: 'Activity', icon: '≡' },
]

function Tabbed({ base, tab, tabs }: { base: string; tab?: string; tabs: { k: string; label: string; el: JSX.Element }[] }) {
  const cur = tabs.find(t => t.k === tab) ?? tabs[0]
  return (
    <div>
      <div className="seg mb-5">{tabs.map(t => <button key={t.k} aria-pressed={cur.k === t.k} onClick={() => go(`${base}/${t.k}`)}>{t.label}</button>)}</div>
      {cur.el}
    </div>
  )
}

function Shell({ onLock, updated }: { onLock: () => void; updated: string | null }) {
  const v = useVault()
  const route = useRoute()
  const [menu, setMenu] = useState(false)
  const counts: Record<string, number> = {
    '/portfolio': v.portfolio.holdings.length,
    '/lockins': allLockins(v).filter(x => x.d >= 0 && x.d <= 30).length,
    '/ipos': upcomingEvents(v, 30, ['ISSUE_OPEN']).length,
    '/anchor': v.companies.filter(r => r.events.some(e => ['DRHP_FILED', 'UDRHP_FILED'].includes(e.event_type) && daysUntil(e.date) >= -7 && daysUntil(e.date) <= 0)).length,
  }
  useEffect(() => setMenu(false), [route])

  const [, seg, arg] = route.split('/')
  const page = (() => {
    switch ('/' + (seg ?? '')) {
      case '/': return <Dashboard />
      case '/anchor': return <AnchorDesk />
      case '/portfolio': return <Portfolio />
      case '/ipos': return <Tabbed base="/ipos" tab={arg} tabs={[
        { k: 'upcoming', label: 'Upcoming & open', el: <Pipeline mode="upcoming" /> },
        { k: 'pipeline', label: 'Full pipeline', el: <Pipeline mode="all" /> },
        { k: 'calendar', label: 'Calendar', el: <Calendar /> },
        { k: 'private', label: 'Private → IPO', el: <PrivateTracker /> }]} />
      case '/activity': return <Tabbed base="/activity" tab={arg} tabs={[
        { k: 'changes', label: 'What changed', el: <Changes /> },
        { k: 'news', label: 'News', el: <NewsPage /> },
        { k: 'filings', label: 'Filings', el: <Filings /> },
        { k: 'review', label: `Data checks${v.review.length ? ` (${v.review.length})` : ''}`, el: <Review /> }]} />
      case '/pipeline': return <Pipeline mode="all" />
      case '/upcoming': return <Pipeline mode="upcoming" />
      case '/listed': return <Listed />
      case '/private': return <PrivateTracker />
      case '/lockins': return <Lockins />
      case '/calendar': return <Calendar />
      case '/filings': return <Filings />
      case '/changes': return <Changes />
      case '/news': return <NewsPage />
      case '/review': return <Review />
      case '/new-private': return <NewPrivatePage name={arg ? decodeURIComponent(arg) : ''} />
      case '/company': return <CompanyPage id={decodeURIComponent(arg ?? '')} />
      default: return <div className="glass p-10">Not found. <a href="#/">Back to dashboard</a></div>
    }
  })()
  const active = '/' + (seg ?? '')

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className={`${menu ? 'block' : 'hidden'} lg:block fixed lg:sticky top-0 z-40 h-screen p-4 w-[280px] lg:w-auto`}>
        <div className="glass glass-strong h-full p-4 flex flex-col">
          <a href="#/" className="flex items-center gap-3 px-2 mb-6 no-underline" style={{ color: 'var(--ink)' }}>
            <span className="w-9 h-9 rounded-xl grid place-items-center text-white" style={{ background: 'linear-gradient(135deg,#0a84ff,#7d5cff)' }}>◆</span>
            <span className="display font-bold text-[18px]">IPO Terminal</span>
          </a>
          <nav className="nav flex flex-col gap-0.5 overflow-y-auto">
            {NAV.map(n => (
              <a key={n.path} href={`#${n.path}`} aria-current={active === n.path ? 'page' : undefined}>
                <span className="w-5 text-center opacity-70">{n.icon}</span>{n.label}
                {counts[n.path] ? <span className="count">{counts[n.path]}</span> : null}
              </a>
            ))}
          </nav>
          <div className="mt-auto pt-4 text-xs muted px-2">
            {v.meta.ingest ? <>Data pulled {fmtDateTime(v.meta.ingest.ran_at)} IST<br /></> : null}
            Built {fmtDateTime(v.meta.built_at)} IST<br />{v.meta.companies} companies
            {updated && <><br /><span className="pos">● Live-updated at {updated}</span></>}
            {!!v.meta.ingest?.failures.length && <><br /><a href="#/activity/review" className="warn">{v.meta.ingest.failures.length} source issue(s)</a></>}
            <SyncBadge />
            <button className="btn w-full justify-center mt-3" onClick={onLock}>Sign out</button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 p-4 lg:p-6 lg:pl-2">
        <TopBar onMenu={() => setMenu(m => !m)} />
        {v.meta.has_sample && (
          <div className="glass panel px-5 py-3 mb-5 text-sm flex gap-3 items-center" style={{ borderColor: 'rgba(245,158,11,.45)' }}>
            <span className="pill tone-amber">SAMPLE DATA</span>
            <span className="ink2">Companies marked “Demo” are fictional fixtures for testing the terminal. They disappear once live ingestion is switched on.</span>
          </div>
        )}
        <main key={route} className="page">{page}</main>
        <nav className="bottom-nav glass glass-strong" aria-label="Primary">
          {[['/', '◉', 'Home'], ['/anchor', '⚓', 'Anchor'], ['/ipos', '▤', 'IPOs'], ['/listed', '◆', 'Listed'], ['/portfolio', '★', 'Portfolio']].map(([p, i, l]) => (
            <a key={p} href={`#${p}`} aria-current={active === p ? 'page' : undefined}><span className="ico">{i}</span>{l}</a>
          ))}
        </nav>
      </div>
    </div>
  )
}

function SyncBadge() {
  const { sync, username } = useSync()
  const t = { off: ['muted', 'Sync off — saved on this device'], syncing: ['muted', 'Syncing…'], ok: ['pos', `Synced${sync.at ? ` ${sync.at}` : ''}`], error: ['warn', `Sync issue — saved on this device`] }[sync.mode]
  return <div className="mt-2"><b className="ink2">{username}</b><br /><span className={t[0]} title={sync.msg}>● {t[1]}</span></div>
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const v = useVault()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const fuse = useMemo(() => new Fuse<CompanyRecord>(v.companies, {
    threshold: 0.33, ignoreLocation: true, keys: ['company.name', 'company.legal_name', 'company.aliases', 'company.identifiers.nse_symbol',
      'company.identifiers.bse_code', 'company.identifiers.cin', 'company.identifiers.isin', 'company.sector', 'company.industry', 'company.promoters',
      'offerings.intermediaries.brlms'],
  }), [v])
  const hits = q ? fuse.search(q, { limit: 8 }) : []
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.getElementById('gsearch')?.focus() } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])
  return (
    <div className="flex items-center gap-3 mb-6 sticky top-4 z-30">
      <button className="btn lg:hidden" onClick={onMenu} aria-label="Menu">☰</button>
      <div className="relative flex-1 max-w-[560px]">
        <input id="gsearch" className="input glass !rounded-full !h-11 !pl-5" placeholder="Search company, symbol, BSE code, CIN, sector…  ⌘K"
          value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { go(`/company/${hits[0].item.company.company_id}`); setQ('') } }} />
        {open && q.trim().length > 1 && hits.length === 0 && (
          <div className="glass glass-strong absolute left-0 right-0 top-13 p-4 z-50 text-sm ink2">
            No IPO, DRHP or listing matches “{q}”.
            <a className="btn btn-primary mt-3 w-full justify-center" href={`#/new-private/${encodeURIComponent(q.trim())}`} onMouseDown={e => e.preventDefault()} onClick={() => setQ('')}>+ Add “{q.trim()}” as a private company</a>
          </div>
        )}
        {open && hits.length > 0 && (
          <div className="glass glass-strong absolute left-0 right-0 top-13 p-2 z-50">
            {hits.map(h => (
              <a key={h.item.company.company_id} href={`#/company/${h.item.company.company_id}`} onClick={() => setQ('')}
                className="flex justify-between gap-3 px-3 py-2 rounded-xl hover:bg-black/5 no-underline" style={{ color: 'var(--ink)' }}>
                <span className="font-semibold">{h.item.company.name}</span>
                <span className="muted text-sm">{h.item.custom ? 'Private · yours' : h.item.company.identifiers.nse_symbol ?? h.item.company.industry ?? ''}</span>
              </a>
            ))}
            <a href={`#/new-private/${encodeURIComponent(q.trim())}`} onClick={() => setQ('')} className="block px-3 py-2 rounded-xl text-sm no-underline muted hover:bg-black/5">+ Add “{q.trim()}” as a private company</a>
          </div>
        )}
      </div>
      <ThemeToggle />
    </div>
  )
}

function ThemeToggle() {
  const [t, setT] = useState<string>(() => { try { return localStorage.getItem('theme') ?? 'auto' } catch { return 'auto' } })
  useEffect(() => {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t
    try { localStorage.setItem('theme', t) } catch { /* noop */ }
  }, [t])
  return <button className="btn" onClick={() => setT(t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto')} title="Theme">
    {t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
  </button>
}
