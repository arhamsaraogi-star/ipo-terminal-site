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
  sector?: string | null; industry?: string | null; segment: 'MAINBOARD' | 'SME' | 'UNKNOWN'; lifecycle: Lifecycle
  private_tracker?: { confidence: string; expected_timing?: string | null; sources?: Source[] } | null
  overview?: { summary: string; segments?: string[]; source?: Source } | null
  website?: string | null; ir_url?: string | null; is_sample?: boolean; updated_at: string
  drhp_status?: string | null; sources?: string[]; promoters?: string[]
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
export interface Holding { company_id: string; quantity: number; avg_cost: number; acquired_on: string; route: string; note?: string | null }
export interface CompanyRecord {
  company: Company; offerings: Offering[]; facts: { financials: Fact[]; industry: Fact[]; operating?: Fact[] } | null
  documents: Doc[]; events: Event[]; lockins: Lockin[]; news: News[]
}
export interface Vault {
  meta: { built_at: string; schema_version: number; companies: number; has_sample: boolean; repo?: string | null
    ingest?: { ran_at: string; companies: number; changes: number; log: string[]; failures: string[] } | null }
  event_types: Record<string, { label: string; group: string; order: number }>
  companies: CompanyRecord[]; changes: Change[]
  portfolio: { holdings: Holding[]; watchlist: string[] }; review: string[]
}
