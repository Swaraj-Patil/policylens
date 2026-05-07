export type SourceInfo = {
  institution: string
  section_title: string
  page_start: number
  page_end: number
  flesch_kincaid_grade: number | null
}

export type QueryResponse = {
  answer: string
  institution: string
  question: string
  sources: SourceInfo[]
}

export type Citation = {
  institution: string
  section_title: string
  page_ref: string // raw page text, e.g. "p.77" or "pp.77-78"
}

export type AnswerToken =
  | { type: 'text'; text: string }
  | { type: 'citations'; items: Citation[] }
