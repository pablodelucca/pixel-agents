import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';

async function main() {
  if (import.meta.env.DEV) {
    const { initBrowserMock } = await import('./browserMock.js');
    await initBrowserMock();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main().catch(console.error);
