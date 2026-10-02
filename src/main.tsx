import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from './config';

// J1 : point d'entrée minimal pour que le build tourne. Le shell (routes, providers) arrive au J2.
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <main>{APP_NAME}</main>
    </StrictMode>,
  );
}
