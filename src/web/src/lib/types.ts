// Mirrors schemas/*.schema.json (kept deliberately thin; the pipeline validates, the UI renders).
export interface Source {
  source_type: string; document_id?: string | null; page?: number | null; table?: string | null
  section?: string | null; url: string; sha256?: string | null; tier?: 'primary' | 'secondary'
}
export interface Fact {
  fact_id: string; metric: string; label?: string | null; value: number | string | boolean | null; unit: string
  period?: string | null; basis?: string | null; kind: 'reported' | 'calculated'; formula?: string | null
  inputs?: string[]; source?: Source | null
  extraction?: { method: string; extracted_at: string; extractor_version?: string | null; confidence?: string } | null
  status: 'ok' | 'requires_review' | 'not_available' | 'not_meaningful' | 'superseded'; note?: string | null
}
export type Lifecycle = 'PRIVATE' | 'DRHP_FILED' | 'SEBI_OBSERVED' | 'RHP_FILED' | 'ISSUE_ANNOUNCED' | 'ISSUE_OPEN'
  | 'ISSUE_CLOSED' | 'LISTED' | 'WITHDRAWN' | 'LAPSED'
export interface Company {
  company_id: string; name: string; legal_name?: string | null; aliases: string[]
  identifiers: { cin?: string | null; isin?: string | null; nse_symbol?: string | null; bse_code?: string | null }
  sector?: string | null; industry?: string | null; segment: 'MAINBOARD' | 'SME' | 'UNKNOWN' | 'PRIVATE'; lifecycle: Lifecycle
  private_tracker?: { confidence: string; expected_timing?: string | null; sources?: Source[] } | null
  overview?: { summary: string; segments?: string[]; source?: Source } | null
  website?: string | null; ir_url?: string | null; is_sample?: boolean; updated_at: string
  drhp_status?: string | null; sources?: string[]; promoters?: string[]
  external?: boolean   // an already-listed company you pulled in by search: never shown in the IPO lists
}
export interface Offering {
  offering_id: string; company_id: string; type: string; segment: string; exchanges?: string[]
  facts: Record<string, Fact>; intermediaries?: { brlms?: string[]; registrar?: string | null
    contacts?: { name: string; role: 'BRLM' | 'REGISTRAR'; contact_person?: string | null; email?: string | null; phone?: string | null; source?: Source }[] }
  subscription?: { total_times?: number | null; as_of?: string | null } | null
}
export interface Doc {
  document_id: string; doc_type: string; title?: string | null; url: string; source?: string
  filing_date?: string | null; downloaded_at?: string | null; sha256?: string | null; pages?: number | null
  version: number; previous_version?: string | null
}
export interface Event {
  event_id: string; company_id: string; event_type: string; date: string
  date_kind: 'actual' | 'scheduled' | 'derived'; detail?: string | null; source?: Source | null; rule_id?: string | null
}
export interface Lockin {
  tranche_id: string; company_id: string; holder_category: string; shares?: Fact; pct_post_issue?: Fact
  start_date: string; expiry_date: string; rule_id: string; rule_verified: boolean
}
export interface News {
  news_id: string; company_id: string; published_at: string; title: string; url: string
  publisher?: string | null; tier: 'official' | 'media'; category: string
}
export interface Change {
  change_id: string; company_id: string; field: string; label?: string | null; old: unknown; new: unknown
  source?: Source | null; detected_at: string
}
export interface Holding {
  company_id: string; quantity: number; avg_cost: number; acquired_on: string; route: string; note?: string | null
  entry_valuation_cr?: number | null          // pre-IPO: post-money valuation at which we invested
  invested_cr?: number | null                 // pre-IPO: amount invested (when quantity/price unknown)
  latest_round_cr?: number | null             // latest private round valuation (manual)
  latest_round_on?: string | null
  currency?: string | null                    // private companies: amounts in this currency (crore for INR, million otherwise)
}
export type TrackStatus = 'INTERESTED' | 'EVALUATING' | 'IN_TALKS' | 'COMMITTED' | 'PASSED'
export interface Track { company_id: string; status: TrackStatus; note?: string | null; added_on: string; updated_on?: string }
export interface Round { date: string; label: string; post_money: number | null; price_per_share?: number | null; lead?: string | null }
export interface PrivateCo {
  company_id: string; name: string; country: string; sector?: string | null; currency: string; fx_inr?: number | null
  website?: string | null; note?: string | null; rounds: Round[]; created_on: string
}
export interface Peer { name: string; face_value?: number | null; price?: number | null; total_income?: number | null; mcap?: number | null
  pb?: number | null; pe?: number | null; eps_basic?: number | null; eps_diluted?: number | null; ronw?: number | null; nav?: number | null; source?: Source
  live?: { symbol: string; date: string; price: number; mcap_cr?: number | null; pe?: number | null; pb?: number | null } }
export interface IndustryClaim { text: string; page: number; cagr_pct?: number | null; amounts?: { value: number; unit: string }[]; years?: string[]; source?: Source }
export interface IndustrySeries { title: string; unit?: string | null; page: number; kind: 'chart' | 'table' | 'text'; periods: string[]; projected?: boolean[]; rows: { name: string; values: (number | null)[] }[]; note?: string | null; macro?: boolean; source?: Source }
export interface WebNews { title: string; url: string; publisher?: string | null; published_at?: string | null }
export interface PressValuation { currency: string; value_mn?: number; value_cr?: number; text: string; date?: string | null; title: string; url: string; publisher?: string | null }
export interface Intel { name: string; fetched_at: string; news: WebNews[]; valuations: PressValuation[] }
export interface Quote { date: string; close: number; prev_close?: number | null; open?: number | null; high?: number | null; low?: number | null
  shares?: number | null; mcap_cr?: number | null; series?: string; volume?: number | null }
export interface Market { symbol: string; quote?: Quote | null; listing?: { date: string; open?: number | null; high?: number | null; low?: number | null; close?: number | null; prev_close?: number | null } | null
  history: [string, number][]; source: string }
export interface CompanyRecord {
  company: Company; offerings: Offering[]
  facts: { financials: Fact[]; industry: Fact[]; operating?: Fact[]; peers?: Peer[]; industry_claims?: IndustryClaim[]; industry_series?: IndustrySeries[]; source_document?: string | null } | null
  documents: Doc[]; events: Event[]; lockins: Lockin[]; news: News[]; market?: Market | null
  custom?: PrivateCo
  listed?: ListedData | null   // already-listed company followed by search: profile, results, announcements
}
/** [symbol, name, isin, segment, close, mcap_cr, listed_on] — search-only universe of NSE-listed companies. */
export interface ListedData {
  fetched_at: string
  profile?: { price?: number; change_pct?: number; prev_close?: number; open?: number; day_high?: number; day_low?: number; vwap?: number
    high_52w?: number; high_52w_date?: string; low_52w?: number; low_52w_date?: string; pe?: number; sector_pe?: number; sector_index?: string
    face_value?: number; issued_shares?: number; sector?: string; industry?: string; listing_date?: string; name?: string }
  history?: [string, number][]
  results?: { period_end: string; income: number | null; pat: number | null; eps: number | null; audited?: string | null }[]
  announcements?: { id: string; published_at: string; title: string; url?: string | null; category: string }[]
}
export type ListedRow = [string, string, string | null, string | null, number | null, number | null, string | null]
export interface ListedPick { company_id: string; symbol: string; name: string; isin?: string | null; segment?: string | null; added_on: string }
export interface Vault {
  listed_index?: ListedRow[]; listed_data?: Record<string, ListedData>
  meta: { built_at: string; schema_version: number; companies: number; has_sample: boolean; repo?: string | null
    ingest?: { ran_at: string; companies: number; changes: number; log: string[]; failures: string[] } | null }
  event_types: Record<string, { label: string; group: string; order: number }>
  companies: CompanyRecord[]; changes: Change[]
  portfolio: { holdings: Holding[]; watchlist: string[]; tracking: Track[]; privates: PrivateCo[] }; review: string[]; redirects?: Record<string, string>
  private_intel?: Record<string, Intel>; sync?: { repo: string; branch: string; token: string } | null
}
