import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import RemoteApp from './RemoteApp.tsx';

async function main() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RemoteApp />
    </StrictMode>,
  );
}

main().catch(console.error);