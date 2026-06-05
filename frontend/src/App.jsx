import { useState } from 'react'
import Overview from './pages/Overview'
import Write from './pages/Write'
import EssayDetail from './pages/EssayDetail'
import Portrait from './pages/Portrait'
import DraftVault from './pages/DraftVault'
import './App.css'

export default function App() {
  const [page, setPage] = useState('overview')
  const [selectedId, setSelectedId] = useState(null)
  const [writePrefill, setWritePrefill] = useState(null)

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
        <span className="nav-logo">✍️ 文字时光机</span>
        <div className="nav-links">
          <button className={page === 'overview' ? 'active' : ''} onClick={() => navigate('overview')}>总览</button>
          <button className={page === 'portrait' ? 'active' : ''} onClick={() => navigate('portrait')}>写作画像</button>
          <button className={page === 'vault' ? 'active' : ''} onClick={() => navigate('vault')}>半成品仓库</button>
          <button className={page === 'write' ? 'active' : ''} onClick={() => navigateToWrite()}>写作</button>
        </div>
      </nav>

      <main className="main">
        {page === 'overview' && <Overview onSelect={(id) => navigate('detail', id)} onWrite={() => navigateToWrite()} />}
        {page === 'portrait' && <Portrait />}
        {page === 'vault' && <DraftVault onWrite={(prefill) => navigateToWrite(prefill)} />}
        {page === 'write' && <Write onSaved={() => navigate('overview')} prefill={writePrefill} onBack={writePrefill ? () => navigate('vault') : null} />}
        {page === 'detail' && <EssayDetail id={selectedId} onBack={() => navigate('overview')} />}
      </main>
    </div>
  )
}
