import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ensurePersistentStorage } from './services/storageService';
import './styles/tokens.css';
import './styles/base.css';

// Demande de stockage persistant au démarrage : silencieuse, sans attente, sans message.
void ensurePersistentStorage();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
