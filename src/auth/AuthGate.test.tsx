import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGate, type AuthAdapter, type AuthSession } from './AuthGate';

const session: AuthSession = { accessToken: 'token', user: { id: 'coach-1', email: 'coach@example.com' } };

function adapter(initial: AuthSession | null, delay = false) {
  let listener: (session: AuthSession | null) => void = () => undefined;
  const auth: AuthAdapter = {
    getSession: vi.fn(async () => {
      if (delay) await new Promise(() => undefined);
      return initial;
    }),
    onAuthStateChange: vi.fn((callback) => {
      listener = callback;
      return () => undefined;
    }),
    signInWithOtp: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  };
  return { auth, expire: () => listener(null) };
}

describe('AuthGate', () => {
  it('announces loading while the session is being resolved', () => {
    const { auth } = adapter(null, true);
    render(<AuthGate auth={auth}>Área privada</AuthGate>);
    expect(screen.getByRole('status')).toHaveTextContent('Comprobando la sesión');
  });

  it('shows passwordless email access when signed out', async () => {
    const { auth } = adapter(null);
    render(<AuthGate auth={auth}>Área privada</AuthGate>);
    expect(await screen.findByRole('heading', { name: 'Acceso profesional' })).toBeVisible();
    await userEvent.type(screen.getByLabelText('Correo profesional'), 'coach@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace de acceso' }));
    expect(auth.signInWithOtp).toHaveBeenCalledWith('coach@example.com');
  });

  it('shows protected content and current user when signed in', async () => {
    const { auth } = adapter(session);
    render(<AuthGate auth={auth}>Área privada</AuthGate>);
    expect(await screen.findByText('Área privada')).toBeVisible();
    expect(screen.getByText('coach@example.com')).toBeVisible();
  });

  it('returns to sign-in when the session expires', async () => {
    const { auth, expire } = adapter(session);
    render(<AuthGate auth={auth}>Área privada</AuthGate>);
    await screen.findByText('Área privada');
    expire();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acceso profesional' })).toBeVisible());
  });

  it('has no automatically detectable accessibility violations on sign-in', async () => {
    const { auth } = adapter(null);
    const { container } = render(<AuthGate auth={auth}>Área privada</AuthGate>);
    await screen.findByRole('heading', { name: 'Acceso profesional' });
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
