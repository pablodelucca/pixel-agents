import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';

async function main() {
  if (import.meta.env.DEV || __BROWSER_MOCK__) {
    try {
      const { initBrowserMock } = await import('./browserMock.js');
      await initBrowserMock();
    } catch (err) {
      console.error('[BrowserMock] Asset loading failed:', err);
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main().catch(console.error);
