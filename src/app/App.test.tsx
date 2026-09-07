import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../auth/AuthGate';
import type { AthleteApi } from '../features/athletes/athleteApi';
import { App } from './App';

const athleteId = '96a0a55f-bf3a-41d0-a2df-567548bff081';

describe('application analysis context', () => {
  it('renders one global context bar and keeps its cyclist across routes', async () => {
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    const auth: AuthAdapter = {
      getSession: vi.fn().mockResolvedValue({ accessToken: 'token', user: { id: 'coach-1', email: 'coach@example.com' } }),
      onAuthStateChange: vi.fn().mockReturnValue(() => undefined),
      signInWithOtp: vi.fn(),
      signOut: vi.fn(),
    };
    const api: AthleteApi = {
      list: vi.fn().mockResolvedValue([{ id: athleteId, intervalsId: 'i202', name: 'Jaume Santamaria' }]),
      load: vi.fn().mockResolvedValue({ id: athleteId, intervalsId: 'i202', name: 'Jaume Santamaria', observations: [] }),
    };

    render(<App auth={auth} athleteApi={api} />);
    await screen.findByRole('option', { name: 'Jaume Santamaria' });
    const selector = screen.getByLabelText('Ciclista activo');
    await userEvent.selectOptions(selector, athleteId);
    await userEvent.click(screen.getByRole('link', { name: 'Potencia' }));

    expect(screen.getAllByLabelText('Ciclista activo')).toHaveLength(1);
    expect(screen.getByLabelText('Ciclista activo')).toHaveValue(athleteId);
    expect(screen.getByRole('heading', { name: 'Potencia y duración' })).toBeVisible();
  });
});
