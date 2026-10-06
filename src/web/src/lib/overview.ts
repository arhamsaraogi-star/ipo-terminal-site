// Does a stored "about the company" text actually describe the business? (Mirrors the pipeline's check, so text saved by an
// older extractor — a definitions page, a non-GAAP disclaimer — is never shown as if it were the company description.)
const BOILER = /forward[- ]looking|should be read|qualified in its entirety|restated financial|unless (the context|otherwise)|risk factors|non-?gaap|\bind ?as\b|\bifrs\b|\bgaap\b|supplemental measures|performance indicators|this (draft )?(red herring )?prospectus|presentation of (financial|industry)|certain conventions|definitions? and abbreviations/i
const SIGNAL = /\b(we are|we have been|we operate|we manufacture|we provide|we offer|we design|we engage|is engaged in|are engaged in|is (a|an|one of|among|the)\b|are (a|an|one of|among|the)\b|incorporated in \d{4}|business of|manufactur\w+|leading|largest)/i

export function goodOverview(text?: string | null): text is string {
  if (!text || text.length < 120) return false
  const head = text.slice(0, 500)
  return !BOILER.test(head) && SIGNAL.test(head)
}
