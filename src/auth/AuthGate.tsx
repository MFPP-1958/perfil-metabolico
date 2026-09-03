import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { browserAuth } from './supabase';

export interface AuthSession {
  accessToken: string;
  user: { id: string; email: string };
}

export interface AuthAdapter {
  getSession(): Promise<AuthSession | null>;
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;
  signInWithOtp(email: string): Promise<void>;
  signOut(): Promise<void>;
}

export function AuthGate({ children, auth = browserAuth }: { children: ReactNode; auth?: AuthAdapter }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    const unsubscribe = auth.onAuthStateChange((next) => {
      if (active) {
        setSession(next);
        setLoading(false);
      }
    });
    void auth.getSession()
      .then((next) => active && setSession(next))
      .catch(() => active && setMessage('No se pudo comprobar la sesión.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth]);

  if (loading) return <div className="auth-status" role="status">Comprobando la sesión…</div>;

  if (!session) {
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await auth.signInWithOtp(String(form.get('email') ?? '').trim());
        setMessage('Enlace enviado. Revisa tu correo profesional.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo enviar el enlace.');
      }
    }
    return (
      <main className="login-shell">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="trace-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <p className="product-name">MFPP Metabolic Lab</p>
          <h1 id="login-title">Acceso profesional</h1>
          <p>Datos fisiológicos y sesiones de tus ciclistas en un entorno privado.</p>
          <form onSubmit={submit}>
            <label htmlFor="professional-email">Correo profesional</label>
            <input id="professional-email" name="email" type="email" autoComplete="email" required />
            <button type="submit">Enviar enlace de acceso</button>
          </form>
          {message && <p className="form-message" role="status">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="session-root">
      <div className="account-bar">
        <span>{session.user.email}</span>
        <button type="button" className="text-button" onClick={() => void auth.signOut()}>Cerrar sesión</button>
      </div>
      {children}
    </div>
  );
}
