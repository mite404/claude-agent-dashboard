import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import Dashboard from './components/Dashboard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
    <Toaster position="bottom-right" theme="dark" richColors />
  </StrictMode>,
)
