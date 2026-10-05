import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Fuse from 'fuse.js'
import { decryptWithKey, forgetKey, openVault, parseVault, recallKey, rememberKey } from './lib/vault'
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
import { loadPf, savePf, type Pf } from './lib/portfolio'

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

export default function App() {
  const [vault, setVault] = useState<Vault | null>(null)
  const [buf, setBuf] = useState<ArrayBuffer | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const keyRef = useRef<CryptoKey | null>(null)
  const [updated, setUpdated] = useState<string | null>(null)
  const [pf, setPfState] = useState<Pf>(loadPf)
  const setPf = (p: Pf) => { setPfState(p); savePf(p) }
  const view = useMemo(() => vault ? { ...vault, portfolio: pf } : null, [vault, pf])

  // Live refresh: whenever a newer build is published, fetch + decrypt it in place (no reload, no re-login).
  useEffect(() => {
    if (!vault) return
    const check = async () => {
      try {
        const m = await (await fetch(`${META_URL}?t=${Date.now()}`, { cache: 'no-store' })).json()
        if (!m.built_at || m.built_at === vault.meta.built_at || !keyRef.current) return
        const b = await (await fetch(`${VAULT_URL}?t=${Date.now()}`, { cache: 'no-store' })).arrayBuffer()
        setVault(await decryptWithKey<Vault>(parseVault(b), keyRef.current))
        setUpdated(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
      } catch { /* offline or mid-deploy: try again next tick */ }
    }
    const id = setInterval(check, 120_000)
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
        const key = await recallKey(h.salt)
        if (key) { try { setVault(await decryptWithKey<Vault>(h, key)); keyRef.current = key } catch { await forgetKey() } }
      })
      .catch(e => setErr(String(e.message ?? e)))
  }, [])

  async function unlock(pw: string, remember: boolean) {
    if (!buf) return
    setBusy(true); setErr('')
    try {
      const { data, key } = await openVault<Vault>(buf, pw)
      if (remember) await rememberKey(key, parseVault(buf).salt)
      keyRef.current = key
      setVault(data)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function lock() { await forgetKey(); keyRef.current = null; setVault(null); location.hash = '/' }

  return (
    <>
      <div className="ambient" aria-hidden><i /><i /><i /><i /></div>
      {vault
        ? <Ctx.Provider value={view}><PfCtx.Provider value={{ pf, setPf }}><Shell onLock={lock} updated={updated} /></PfCtx.Provider></Ctx.Provider>
        : <Login onUnlock={unlock} err={err} busy={busy} ready={!!buf} />}
    </>
  )
}

function Login({ onUnlock, err, busy, ready }: { onUnlock: (pw: string, r: boolean) => void; err: string; busy: boolean; ready: boolean }) {
  const [pw, setPw] = useState('')
  const [remember, setRemember] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const submit = (e: FormEvent) => { e.preventDefault(); if (pw) onUnlock(pw, remember) }
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className={`glass glass-strong w-full max-w-[420px] p-9 fade-in ${err ? 'shake' : ''}`} key={err}>
        <div className="w-14 h-14 rounded-[18px] grid place-items-center mb-6 text-white text-2xl"
          style={{ background: 'linear-gradient(135deg,#0a84ff,#7d5cff)', boxShadow: '0 10px 30px rgba(10,132,255,.35)' }}>◆</div>
        <h1 className="display text-[30px] font-bold leading-tight">IPO Terminal</h1>
        <p className="muted mt-1 mb-7">Private research terminal. Enter the passphrase to decrypt.</p>
        <input ref={ref} type="password" className="input" placeholder="Passphrase" value={pw} onChange={e => setPw(e.target.value)}
          autoComplete="current-password" aria-label="Passphrase" />
        <label className="flex items-center gap-2 mt-4 text-sm ink2 select-none">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember this device
        </label>
        <button className="btn btn-primary w-full justify-center mt-6 h-11 text-[15px]" disabled={busy || !ready}>
          {busy ? 'Decrypting…' : ready ? 'Unlock' : 'Loading…'}
        </button>
        {err && <p className="neg text-sm mt-4">{err}</p>}
        <p className="muted text-xs mt-6">Data is AES-256 encrypted and decrypted only in this browser.</p>
      </form>
    </main>
  )
}

const NAV: { path: string; label: string; icon: string }[] = [
  { path: '/', label: 'Dashboard', icon: '◉' },
  { path: '/anchor', label: 'Anchor Desk', icon: '⚓' },
  { path: '/portfolio', label: 'Portfolio', icon: '★' },
  { path: '/pipeline', label: 'IPO Pipeline', icon: '▤' },
  { path: '/upcoming', label: 'Upcoming IPOs', icon: '↗' },
  { path: '/listed', label: 'Recently Listed', icon: '◆' },
  { path: '/private', label: 'Private → IPO', icon: '◌' },
  { path: '/lockins', label: 'Lock-in Calendar', icon: '⌛' },
  { path: '/calendar', label: 'IPO Calendar', icon: '▦' },
  { path: '/filings', label: 'New Filings', icon: '⎙' },
  { path: '/changes', label: 'Recent Changes', icon: 'Δ' },
  { path: '/news', label: 'News', icon: '≡' },
  { path: '/review', label: 'Needs Review', icon: '⚠' },
]

function Shell({ onLock, updated }: { onLock: () => void; updated: string | null }) {
  const v = useVault()
  const route = useRoute()
  const [menu, setMenu] = useState(false)
  const counts: Record<string, number> = {
    '/portfolio': v.portfolio.holdings.length,
    '/lockins': allLockins(v).filter(x => x.d >= 0 && x.d <= 30).length,
    '/upcoming': upcomingEvents(v, 30, ['ISSUE_OPEN']).length,
    '/review': v.review.length,
    '/anchor': v.companies.filter(r => r.events.some(e => ['DRHP_FILED', 'UDRHP_FILED'].includes(e.event_type) && daysUntil(e.date) >= -7 && daysUntil(e.date) <= 0)).length,
  }
  useEffect(() => setMenu(false), [route])

  const [, seg, arg] = route.split('/')
  const page = (() => {
    switch ('/' + (seg ?? '')) {
      case '/': return <Dashboard />
      case '/anchor': return <AnchorDesk />
      case '/portfolio': return <Portfolio />
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
            {!!v.meta.ingest?.failures.length && <><br /><a href="#/review" className="warn">{v.meta.ingest.failures.length} source issue(s)</a></>}
            <button className="btn w-full justify-center mt-3" onClick={onLock}>Lock</button>
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
        <main key={route}>{page}</main>
      </div>
    </div>
  )
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const v = useVault()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const fuse = useMemo(() => new Fuse<CompanyRecord>(v.companies, {
    threshold: 0.35, keys: ['company.name', 'company.legal_name', 'company.aliases', 'company.identifiers.nse_symbol',
      'company.identifiers.bse_code', 'company.identifiers.cin', 'company.sector', 'company.industry'],
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
        {open && hits.length > 0 && (
          <div className="glass glass-strong absolute left-0 right-0 top-13 p-2 z-50">
            {hits.map(h => (
              <a key={h.item.company.company_id} href={`#/company/${h.item.company.company_id}`} onClick={() => setQ('')}
                className="flex justify-between gap-3 px-3 py-2 rounded-xl hover:bg-black/5 no-underline" style={{ color: 'var(--ink)' }}>
                <span className="font-semibold">{h.item.company.name}</span>
                <span className="muted text-sm">{h.item.company.identifiers.nse_symbol ?? h.item.company.industry ?? ''}</span>
              </a>
            ))}
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
