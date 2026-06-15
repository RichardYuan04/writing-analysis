import { useState, useEffect } from 'react'
import Overview from './pages/Overview'
import Write from './pages/Write'
import EssayDetail from './pages/EssayDetail'
import Portrait from './pages/Portrait'
import DraftVault from './pages/DraftVault'
import Settings from './pages/Settings'
import { DEFAULT_FAMILY, DEFAULT_MODE } from './themes'
import './App.css'

export default function App() {
  const [page, setPage] = useState('overview')
  const [selectedId, setSelectedId] = useState(null)
  const [writePrefill, setWritePrefill] = useState(null)
  // 主题两维：色系 + 明暗（明暗兼容旧的 wtm-theme 键）
  const [family, setFamily] = useState(() => localStorage.getItem('wtm-family') || DEFAULT_FAMILY)
  const [mode, setMode] = useState(
    () => localStorage.getItem('wtm-mode') || localStorage.getItem('wtm-theme') || DEFAULT_MODE
  )

  useEffect(() => {
    const r = document.documentElement
    r.dataset.family = family
    r.dataset.mode = mode
    localStorage.setItem('wtm-family', family)
    localStorage.setItem('wtm-mode', mode)
  }, [family, mode])
  const toggleMode = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'))

  const navigate = (p, id = null) => {
    setPage(p)
    setSelectedId(id)
  }

  const navigateToWrite = (prefill = null) => {
    setWritePrefill(prefill)
    navigate('write')
  }

  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-logo">文字时光机</span>
        <div className="nav-links">
          <button className={page === 'overview' ? 'active' : ''} onClick={() => navigate('overview')}>总览</button>
          <button className={page === 'portrait' ? 'active' : ''} onClick={() => navigate('portrait')}>写作画像</button>
          <button className={page === 'vault' ? 'active' : ''} onClick={() => navigate('vault')}>半成品仓库</button>
          <button className={page === 'write' ? 'active' : ''} onClick={() => navigateToWrite()}>写作</button>
          <button className="theme-toggle" onClick={toggleMode} title="切换明暗">
            {mode === 'dark' ? '☀ 白昼' : '☾ 夜晚'}
          </button>
          <button
            className={`nav-gear ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
            title="设置"
            aria-label="设置"
          >⚙</button>
        </div>
      </nav>

      <main className={`main ${page === 'write' ? 'main--wide' : ''}`}>
        {page === 'overview' && <Overview onSelect={(id) => navigate('detail', id)} onWrite={() => navigateToWrite()} />}
        {page === 'portrait' && <Portrait />}
        {page === 'vault' && <DraftVault onWrite={(prefill) => navigateToWrite(prefill)} />}
        {page === 'write' && <Write onSaved={() => navigate('overview')} prefill={writePrefill} onBack={writePrefill ? () => navigate('vault') : null} />}
        {page === 'detail' && <EssayDetail id={selectedId} onBack={() => navigate('overview')} />}
        {page === 'settings' && (
          <Settings family={family} mode={mode} onFamily={setFamily} onMode={setMode} />
        )}
      </main>
    </div>
  )
}
