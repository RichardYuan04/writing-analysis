import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 不启用 StrictMode：BlockNote/Mantine 编辑器在 React 19 StrictMode 双挂载下可能重复初始化，去掉更稳
createRoot(document.getElementById('root')).render(<App />)
