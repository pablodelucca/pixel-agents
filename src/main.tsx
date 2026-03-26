import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PrivyProvider } from './components/providers/PrivyProvider.js';
import { ServerProvider } from './hooks/useServerState.js';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider>
      <ServerProvider>
        <App />
      </ServerProvider>
    </PrivyProvider>
  </StrictMode>,
);
