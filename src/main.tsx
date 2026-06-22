import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { useReplayStore } from './store/useReplayStore'

if (typeof window !== 'undefined') {
  (window as any).__REPLAY_STORE__ = useReplayStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
