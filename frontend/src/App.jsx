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
  // 总览页日期筛选：提到 App 层，离开/返回总览页时不丢失
  const [ovStart, setOvStart] = useState('')
  const [ovEnd, setOvEnd] = useState('')
  // 进入设置页前所在的页面（用于设置页「返回」回退）
  const [prevPage, setPrevPage] = useState('overview')
  const [prevId, setPrevId] = useState(null)
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

  // 打开设置页：先记住当前页面，便于之后回退
  const openSettings = () => {
    if (page !== 'settings') {
      setPrevPage(page)
      setPrevId(selectedId)
    }
    navigate('settings')
  }
  const backFromSettings = () => navigate(prevPage, prevId)

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
            onClick={openSettings}
            title="设置"
            aria-label="设置"
          >
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </nav>

      <main className={`main ${page === 'write' ? 'main--wide' : ''}`}>
        {page === 'overview' && (
          <Overview
            onSelect={(id) => navigate('detail', id)}
            onWrite={() => navigateToWrite()}
            startDate={ovStart}
            endDate={ovEnd}
            onRange={(s, e) => { setOvStart(s); setOvEnd(e) }}
          />
        )}
        {page === 'portrait' && <Portrait />}
        {page === 'vault' && <DraftVault onWrite={(prefill) => navigateToWrite(prefill)} />}
        {page === 'write' && <Write onSaved={() => navigate('overview')} prefill={writePrefill} onBack={writePrefill ? () => navigate('vault') : null} />}
        {page === 'detail' && <EssayDetail id={selectedId} onBack={() => navigate('overview')} />}
        {page === 'settings' && (
          <Settings family={family} mode={mode} onFamily={setFamily} onMode={setMode} onBack={backFromSettings} />
        )}
      </main>
    </div>
  )
}
