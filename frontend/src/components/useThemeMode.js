import { useState, useEffect } from 'react'

// 读取 <html data-mode>，并随明暗切换实时更新，给 BlockNote 的 theme 用
export function useThemeMode() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.mode || 'dark')
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setMode(el.dataset.mode || 'dark'))
    obs.observe(el, { attributes: true, attributeFilter: ['data-mode'] })
    return () => obs.disconnect()
  }, [])
  return mode
}
