import type { AnswerBlock, AnswerToken, Citation } from './types'

// Inline tokens we care about: citation brackets [...] OR bold **...**.
// Citation parsing is unchanged from Step 3; the bold branch is purely
// additive — citations outside of bold are detected exactly as before.
const TOKEN_RE = /\[([^\]]+)\]|\*\*([^*]+)\*\*/g
const PAGE_RE = /^pp?\.\s*\S/
const LIST_LINE_RE = /^[-*]\s+/
const HEADING_RE = /^(#{1,6})\s+(.+)$/

/**
 * Parse a single citation like "<Institution>, <Section Title>, p.<page>".
 * Heuristic: first comma-separated field is the institution, last is the page
 * reference, everything between is the section title joined back with ", ".
 * This survives section titles that themselves contain commas. Institution is
 * always taken verbatim from the bracket — never substituted with a default.
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
 * Walk the inline text and produce a flat token list of plain text, **bold**,
 * and citation runs. Brackets that don't parse as citations (e.g. "[see appendix]")
 * are emitted as plain text so the answer body remains lossless.
 */
export function tokenizeAnswer(text: string): AnswerToken[] {
  const tokens: AnswerToken[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    if (match[1] !== undefined) {
      const citations = parseBracket(match[1])
      if (citations.length > 0) {
        tokens.push({ type: 'citations', items: citations })
      } else {
        tokens.push({ type: 'text', text: match[0] })
      }
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'bold', text: match[2] })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) })
  }
  return tokens
}

/**
 * Split the answer into blocks (paragraphs or bullet lists) at \n\n boundaries.
 * A block is treated as a list iff every non-empty line starts with "- " or "* ".
 * Inline parsing (citations, bold) happens later, per-block, in tokenizeAnswer.
 */
export function parseAnswerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  for (const section of text.split('\n\n')) {
    if (!section.trim()) continue
    const lines = section.split('\n').filter((l) => l.trim().length > 0)

    // Single-line section starting with #..###### → heading.
    if (lines.length === 1) {
      const m = lines[0].trim().match(HEADING_RE)
      if (m) {
        blocks.push({ type: 'heading', level: m[1].length, text: m[2] })
        continue
      }
    }

    if (lines.length > 0 && lines.every((l) => LIST_LINE_RE.test(l.trim()))) {
      const items = lines.map((l) => l.trim().replace(LIST_LINE_RE, ''))
      blocks.push({ type: 'list', items })
    } else {
      blocks.push({ type: 'paragraph', text: section })
    }
  }
  return blocks
}

/** Stable hover-linkage key shared by chips and source cards. */
export function matchKeyOf(c: { institution: string; section_title: string }): string {
  return `${c.institution}::${c.section_title}`
}
