import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import './index.css';
import Dashboard from './components/Dashboard';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(
  <StrictMode>
    <Dashboard />
    <Toaster position="bottom-right" theme="dark" richColors />
  </StrictMode>,
);
