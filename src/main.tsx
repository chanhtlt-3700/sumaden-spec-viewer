import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ensureCacheVersion } from './lib/storage';
import './styles.css';

// Must run before the first render: useStored reads localStorage on mount.
ensureCacheVersion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
