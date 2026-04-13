import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PrivyProvider } from './components/providers/PrivyProvider.js';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider>
      <App />
    </PrivyProvider>
  </StrictMode>,
);
