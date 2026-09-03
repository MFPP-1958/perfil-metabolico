import { afterEach, describe, expect, it, vi } from 'vitest';
import process from 'node:process';
import { listAuthorizedAthleteIds } from '../../netlify/functions/lib/authorization.js';

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  if (originalUrl == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
  if (originalKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalKey;
});

describe('server athlete roles', () => {
  it('adds the coach-role predicate for write authorization', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'dummy-key';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    await listAuthorizedAthleteIds('coach-1', fetchImpl, 'coach');
    expect(fetchImpl.mock.calls[0][0]).toContain('role=eq.coach');
  });
});
