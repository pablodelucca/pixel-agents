import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ServerProvider } from './hooks/useServerState.js';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerProvider>
      <App />
    </ServerProvider>
  </StrictMode>,
);
