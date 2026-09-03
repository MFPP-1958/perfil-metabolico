import { createClient, type Session } from '@supabase/supabase-js';
import type { AuthAdapter, AuthSession } from './AuthGate';

function mapSession(session: Session | null): AuthSession | null {
  if (!session) return null;
  return {
    accessToken: session.access_token,
    user: { id: session.user.id, email: session.user.email ?? 'Cuenta profesional' },
  };
}

export function createBrowserAuth(): AuthAdapter {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !publishableKey) {
    return {
      getSession: async () => null,
      onAuthStateChange: () => () => undefined,
      signInWithOtp: async () => {
        throw new Error('Configura las variables públicas de Supabase para iniciar sesión.');
      },
      signOut: async () => undefined,
    };
  }
  const client = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return {
    getSession: async () => {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return mapSession(data.session);
    },
    onAuthStateChange: (callback) => {
      const { data } = client.auth.onAuthStateChange((_event, current) => callback(mapSession(current)));
      return () => data.subscription.unsubscribe();
    },
    signInWithOtp: async (email) => {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
    },
    signOut: async () => {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
  };
}

export const browserAuth = createBrowserAuth();

export async function getAccessToken(auth: AuthAdapter = browserAuth): Promise<string> {
  const session = await auth.getSession();
  if (!session) throw new Error('La sesión ha caducado.');
  return session.accessToken;
}
