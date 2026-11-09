import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Imported for its side effects: points Monaco at the bundled copy instead of a CDN.
import './lib/monaco';
import { installAuthHooks } from './store/auth';
import { initTheme } from './store/theme';
import './styles/global.css';

// Theme is applied before the first paint so there is no flash of the wrong one.
initTheme();
installAuthHooks();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
