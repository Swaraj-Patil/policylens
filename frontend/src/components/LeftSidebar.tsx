const INSTITUTIONS = ['Northeastern', 'Boston University', 'Harvard'] as const

export function LeftSidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-rule bg-surface flex flex-col">
      <div className="px-5 py-5 border-b border-rule">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">PolicyLens</h1>
        <p className="text-xs text-ink-soft mt-0.5">Governance research</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-7">
        <Section label="Institution">
          {INSTITUTIONS.map((name, i) => (
            <SidebarRow key={name} active={i === 0}>
              {name}
            </SidebarRow>
          ))}
        </Section>

        <Section label="Documents">
          <SidebarRow>Faculty Handbook</SidebarRow>
        </Section>

        <Section label="Recent">
          <p className="px-2 text-xs text-ink-muted leading-relaxed">No searches yet.</p>
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
    </aside>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted mb-2">
        {label}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function SidebarRow({
  children,
  active = false,
}: {
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <div
      className={
        'px-2 py-1.5 rounded-md text-sm cursor-default select-none ' +
        (active
          ? 'bg-canvas text-ink font-medium'
          : 'text-ink-soft hover:bg-canvas hover:text-ink')
      }
    >
      {children}
    </div>
  )
}
