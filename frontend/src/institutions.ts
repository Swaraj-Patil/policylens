/**
 * Single source of truth for institutional identity. Sidebar dot, active-row
 * wash, search composer accent, active-answer left border, and the icon-rail
 * monogram all read from this table — keeps a small palette consistent across
 * surfaces without theming the whole app per institution.
 */
export type InstitutionDef = {
  /** Stable key used by the backend and across context. */
  key: string
  /** Long display label used in body copy (sidebar rows, source headers). */
  label: string
  /** 2-char monogram used in the collapsed icon-rail and small badges. */
  short: string
  /** 6px identity dot — visible at rest. */
  tintDot: string
  /** Soft background wash for the active-row state in the sidebar. */
  tintBg: string
  /** Slightly more saturated version of the dot, used for accents that need
   *  to read against white surfaces (composer focus ring, active borders). */
  tintAccent: string
}

export const INSTITUTIONS: readonly InstitutionDef[] = [
  {
    key: 'Northeastern',
    label: 'Northeastern University',
    short: 'NE',
    tintDot: '#C8102E',
    tintBg: 'rgba(200, 16, 46, 0.07)',
    tintAccent: 'rgba(200, 16, 46, 0.55)',
  },
  {
    key: 'Boston University',
    label: 'Boston University',
    short: 'BU',
    tintDot: '#8C0F0F',
    tintBg: 'rgba(140, 15, 15, 0.07)',
    tintAccent: 'rgba(140, 15, 15, 0.55)',
  },
  {
    key: 'Harvard',
    label: 'Harvard University',
    short: 'HV',
    tintDot: '#A41E22',
    tintBg: 'rgba(164, 30, 34, 0.07)',
    tintAccent: 'rgba(164, 30, 34, 0.55)',
  },
] as const

export function institutionByKey(key: string): InstitutionDef | undefined {
  return INSTITUTIONS.find((i) => i.key === key)
}
