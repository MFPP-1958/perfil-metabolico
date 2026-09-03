import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LactateSprintWizard } from './LactateSprintWizard';

it('does not label an incomplete protocol as VLa max', () => {
  render(<LactateSprintWizard initial={{ baselineLactate: 1.1, sprintDurationSeconds: 15, alacticTimeSeconds: 3, samples: [{ minute: 1, lactate: 7 }] }} />);
  expect(screen.getByText('Protocolo incompleto')).toBeVisible();
  expect(screen.queryByText('VLa máx estimada')).not.toBeInTheDocument();
});
