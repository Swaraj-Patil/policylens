import type { AnswerToken, Citation } from './types'

const BRACKET_RE = /\[([^\]]+)\]/g
const PAGE_RE = /^pp?\.\s*\S/

/**
 * Parse a single citation like "Northeastern, (1) Academic Freedom, p.77".
 * Heuristic: first comma-separated field is the institution, last is the page
 * reference, everything between is the section title joined back with ", ".
 * This survives section titles that themselves contain commas.
 */
function parseSingleCitation(raw: string): Citation | null {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 3) return null

  const institution = parts[0]
  const pageRef = parts[parts.length - 1]
  if (!PAGE_RE.test(pageRef)) return null

  const sectionTitle = parts.slice(1, -1).join(', ')
  return { institution, section_title: sectionTitle, page_ref: pageRef }
}

/** A single bracket may carry multiple semicolon-separated citations. */
function parseBracket(content: string): Citation[] {
  return content
    .split(';')
    .map((s) => parseSingleCitation(s.trim()))
    .filter((c): c is Citation => c !== null)
}

/**
 * Walk the answer text and produce a flat list of tokens. Brackets that don't
 * parse as citations (e.g. "[see appendix]") are emitted as plain text so the
 * answer body remains lossless.
 */
export function tokenizeAnswer(text: string): AnswerToken[] {
  const tokens: AnswerToken[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  BRACKET_RE.lastIndex = 0
  while ((match = BRACKET_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    const citations = parseBracket(match[1])
    if (citations.length > 0) {
      tokens.push({ type: 'citations', items: citations })
    } else {
      tokens.push({ type: 'text', text: match[0] })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) })
  }
  return tokens
}

/** Stable hover-linkage key shared by chips and source cards. */
export function matchKeyOf(c: { institution: string; section_title: string }): string {
  return `${c.institution}::${c.section_title}`
}
