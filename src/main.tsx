import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import type { AuthAdapter } from './auth/AuthGate';
import './styles/global.css';

const root = document.getElementById('app');
if (!root) throw new Error('No se encontró la raíz de la aplicación.');

const e2eAuth: AuthAdapter | undefined = import.meta.env.DEV && import.meta.env.VITE_E2E_MODE === 'true' ? {
  getSession: async () => ({ accessToken: 'local-e2e-token', user: { id: 'e2e-coach', email: 'entrenador@prueba.local' } }),
  onAuthStateChange: () => () => undefined,
  signInWithOtp: async () => undefined,
  signOut: async () => undefined,
} : undefined;

createRoot(root).render(<StrictMode><App auth={e2eAuth} /></StrictMode>);
