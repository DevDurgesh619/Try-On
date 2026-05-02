import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root in sidepanel/index.html');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
