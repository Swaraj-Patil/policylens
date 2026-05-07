import { useMemo, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { useApp } from '../state'
import { INSTITUTIONS } from '../institutions'
import { ResizeHandle } from './ResizeHandle'

const RAIL_WIDTH = 56

type Props = {
  width: number
  minWidth: number
  maxWidth: number
  animate: boolean
  setWidth: Dispatch<SetStateAction<number>>
  onResetWidth: () => void
  /** Briefly enables width transition on drag-release so the final clamp
   *  interpolates instead of jumping. */
  onDragEnd?: () => void
  /** Icon-rail mode for very narrow viewports. */
  collapsed?: boolean
}

export function LeftSidebar({
  width,
  minWidth,
  maxWidth,
  animate,
  setWidth,
  onResetWidth,
  onDragEnd,
  collapsed = false,
}: Props) {
  const { institution, setInstitution, history, runQuery, clearHistory } = useApp()

  const scopedHistory = useMemo(
    () => history.filter((e) => e.institution === institution),
    [history, institution],
  )

  function handleResize(dx: number) {
    setWidth((w) => Math.max(minWidth, Math.min(maxWidth, w + dx)))
  }

  if (collapsed) {
    return <CollapsedSidebar institution={institution} onSelect={setInstitution} />
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className={
        'shrink-0 border-r border-rule/70 bg-surface/95 flex flex-col relative ' +
        (animate ? 'transition-[width] duration-200 ease-out' : '')
      }
    >
      <div className="px-5 py-5 border-b border-rule/70">
        <div className="flex items-center gap-3">
          <img
            src="/icon.png"
            alt=""
            aria-hidden
            width={40}
            height={40}
            className="w-10 h-10 rounded-md shrink-0"
          />
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight text-ink leading-tight">
              Policy<span className="text-accent">Lens</span>
            </h1>
            <p className="text-xs text-ink-soft mt-0.5 leading-tight">Governance research</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-7">
        <Section label="Institution">
          {INSTITUTIONS.map((inst) => (
            <SidebarRow
              key={inst.key}
              active={institution === inst.key}
              onClick={() => setInstitution(inst.key)}
              tintDot={inst.tintDot}
              tintBg={inst.tintBg}
            >
              {inst.label}
            </SidebarRow>
          ))}
        </Section>

        <Section
          label="Documents"
          action={<span className="text-[10px] text-ink-muted/70 tracking-wider">Coming soon</span>}
        >
          <SidebarRow>Faculty Handbook</SidebarRow>
        </Section>

        <Section
          label="Recent"
          action={
            scopedHistory.length > 0 ? (
              <button
                type="button"
                onClick={() => clearHistory(institution)}
                className="text-[10px] text-ink-muted hover:text-ink-soft transition-colors duration-150 cursor-pointer tracking-wider"
                title={`Clear ${institution} history`}
              >
                Clear
              </button>
            ) : null
          }
        >
          {scopedHistory.length === 0 ? (
            <p className="px-2 text-xs text-ink-muted/85 leading-relaxed italic">
              Your recent searches will appear here.
            </p>
          ) : (
            scopedHistory.map((entry) => (
              <button
                key={entry.timestamp}
                type="button"
                onClick={() => runQuery(entry.query)}
                title={entry.query}
                className="block w-full text-left px-2 py-1.5 rounded-md text-sm text-ink-soft hover:bg-canvas hover:text-ink transition-colors duration-150 truncate cursor-pointer focus:outline-none focus-visible:bg-canvas focus-visible:text-ink"
              >
                {entry.query}
              </button>
            ))
          )}
        </Section>
      </nav>

      <div className="px-3 py-3 border-t border-rule/70">
        <button
          type="button"
          disabled
          className="w-full text-left text-xs text-ink-muted px-3 py-2 rounded-md border border-rule bg-canvas/50 cursor-not-allowed"
          title="Cross-institution comparison is not yet available"
        >
          Compare across institutions
          <span className="block text-[10px] text-ink-muted/70 mt-0.5">Coming soon</span>
        </button>
      </div>

      <ResizeHandle
        edge="right"
        onDelta={handleResize}
        onReset={onResetWidth}
        onDragEnd={onDragEnd}
      />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Collapsed (icon-rail) variant — shown at <900px viewports.
// ---------------------------------------------------------------------------

function CollapsedSidebar({
  institution,
  onSelect,
}: {
  institution: string
  onSelect: (name: string) => void
}) {
  return (
    <aside
      style={{ width: `${RAIL_WIDTH}px` }}
      className="shrink-0 border-r border-rule/70 bg-surface/95 flex flex-col items-center py-4 gap-4"
    >
      <img
        src="/icon.png"
        alt="PolicyLens"
        width={36}
        height={36}
        className="w-9 h-9 rounded-md shrink-0"
        title="PolicyLens"
      />
      <div className="w-full border-t border-rule/70" />
      <div className="flex flex-col items-center gap-1 w-full">
        {INSTITUTIONS.map((inst) => {
          const active = institution === inst.key
          return (
            <button
              key={inst.key}
              type="button"
              onClick={() => onSelect(inst.key)}
              title={inst.label}
              aria-pressed={active}
              className={
                'group relative flex items-center justify-center w-10 h-10 rounded-md cursor-pointer ' +
                'transition-colors duration-150 ' +
                (active ? '' : 'hover:bg-canvas')
              }
              style={active ? { backgroundColor: inst.tintBg } : undefined}
            >
              <span
                aria-hidden
                className="block w-2.5 h-2.5 rounded-full transition-transform duration-150 group-hover:scale-110"
                style={{
                  backgroundColor: inst.tintDot,
                  opacity: active ? 1 : 0.55,
                }}
              />
              <span
                aria-hidden
                className="absolute left-1 right-1 -bottom-0.5 text-center font-mono text-[8px] uppercase tracking-wider text-ink-muted/70 select-none"
              >
                {inst.short}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function Section({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="px-2 mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
          {label}
        </h2>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function SidebarRow({
  children,
  active = false,
  onClick,
  tintDot,
  tintBg,
}: {
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
  tintDot?: string
  tintBg?: string
}) {
  if (onClick) {
    const style: CSSProperties | undefined =
      active && tintBg ? { backgroundColor: tintBg } : undefined
    return (
      <button
        type="button"
        onClick={onClick}
        style={style}
        className={
          'flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-sm select-none cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:bg-canvas focus-visible:text-ink ' +
          (active
            ? 'text-ink font-semibold'
            : 'text-ink-soft hover:bg-canvas hover:text-ink')
        }
      >
        {tintDot && (
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: tintDot, opacity: active ? 1 : 0.55 }}
          />
        )}
        <span className="truncate">{children}</span>
      </button>
    )
  }
  return (
    <div className="px-2 py-1.5 rounded-md text-sm cursor-default select-none text-ink-muted/85">
      {children}
    </div>
  )
}
