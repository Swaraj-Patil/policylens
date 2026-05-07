import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { useApp } from '../state'
import { ResizeHandle } from './ResizeHandle'

const INSTITUTIONS = [
  { key: 'Northeastern', label: 'Northeastern University' },
  { key: 'Boston University', label: 'Boston University' },
  { key: 'Harvard', label: 'Harvard University' },
] as const

type Props = {
  width: number
  minWidth: number
  maxWidth: number
  setWidth: Dispatch<SetStateAction<number>>
}

export function LeftSidebar({ width, minWidth, maxWidth, setWidth }: Props) {
  const { institution, setInstitution, history, runQuery, clearHistory } = useApp()

  // Show only the current institution's history. Other institutions' entries
  // are still in localStorage; switching institution swaps the visible list.
  const scopedHistory = useMemo(
    () => history.filter((e) => e.institution === institution),
    [history, institution],
  )

  function handleResize(dx: number) {
    setWidth((w) => Math.max(minWidth, Math.min(maxWidth, w + dx)))
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="shrink-0 border-r border-rule bg-surface flex flex-col relative"
    >
      <div className="px-5 py-5 border-b border-rule">
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
          {INSTITUTIONS.map(({ key, label }) => (
            <SidebarRow
              key={key}
              active={institution === key}
              onClick={() => setInstitution(key)}
            >
              {label}
            </SidebarRow>
          ))}
        </Section>

        <Section
          label="Documents"
          action={<span className="text-[10px] text-ink-muted/70">Coming soon</span>}
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
                className="text-[10px] text-ink-muted hover:text-ink-soft transition-colors cursor-pointer"
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
                className="block w-full text-left px-2 py-1.5 rounded-md text-sm text-ink-soft hover:bg-canvas hover:text-ink transition-colors truncate cursor-pointer focus:outline-none focus-visible:bg-canvas focus-visible:text-ink"
              >
                {entry.query}
              </button>
            ))
          )}
        </Section>
      </nav>

      <div className="px-3 py-3 border-t border-rule">
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

      <ResizeHandle edge="right" onDelta={handleResize} />
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
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
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
}: {
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={
          'block w-full text-left px-2 py-1.5 rounded-md text-sm select-none cursor-pointer transition-colors focus:outline-none focus-visible:bg-canvas focus-visible:text-ink ' +
          (active
            ? 'bg-highlight text-ink font-semibold'
            : 'text-ink-soft hover:bg-canvas hover:text-ink')
        }
      >
        {children}
      </button>
    )
  }
  return (
    <div className="px-2 py-1.5 rounded-md text-sm cursor-default select-none text-ink-muted/85">
      {children}
    </div>
  )
}
