import { LeftSidebar } from './components/LeftSidebar'
import { CenterPanel } from './components/CenterPanel'
import { RightInspector } from './components/RightInspector'

function App() {
  return (
    <div className="flex h-full bg-canvas text-ink">
      <LeftSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <CenterPanel />
      </main>
      <RightInspector />
    </div>
  )
}

export default App
