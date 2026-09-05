import { describe, expect, it } from 'vitest';
import { browserBuildEnvironment, netlifyDevArguments, parseSupabaseEnvironment, redactRuntimeError, viteDevArguments } from '../../scripts/lib/local-runtime.mjs';

describe('secure local runtime', () => {
  it('maps local Supabase values without exposing the secret to Vite', () => {
    const env = parseSupabaseEnvironment('API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="public"\nSECRET_KEY="secret"');
    expect(env).toMatchObject({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SECRET_KEY: 'secret',
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'public',
    });
    expect(env).not.toHaveProperty('VITE_SUPABASE_SECRET_KEY');
  });

  it('rejects incomplete output and ignores unrelated local services', () => {
    expect(() => parseSupabaseEnvironment('API_URL="http://127.0.0.1:54321"')).toThrow('Entorno local de Supabase incompleto.');
    expect(parseSupabaseEnvironment('API_URL="url"\nPUBLISHABLE_KEY="public"\nSECRET_KEY="secret"\nDB_URL="private-database"')).toEqual({
      SUPABASE_URL: 'url',
      SUPABASE_SECRET_KEY: 'secret',
      VITE_SUPABASE_URL: 'url',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'public',
    });
  });

  it('removes credentials from runtime errors', () => {
    expect(redactRuntimeError('request failed with secret-value', ['secret-value'])).toBe('No se pudo iniciar el entorno real.');
    expect(redactRuntimeError('Supabase no está iniciado.', ['secret-value'])).toBe('Supabase no está iniciado.');
  });

  it('runs only the Netlify functions server behind the local browser proxy', () => {
    expect(netlifyDevArguments()).toEqual(['functions:serve', '--offline', '--port', '4175', '--functions', 'netlify/functions']);
    expect(viteDevArguments()).toEqual(['--host', '127.0.0.1', '--port', '4174', '--strictPort']);
  });

  it('passes only public Supabase variables into the browser build', () => {
    const browser = browserBuildEnvironment({ PATH: '/bin' }, {
      SUPABASE_URL: 'url', SUPABASE_SECRET_KEY: 'secret', VITE_SUPABASE_URL: 'url', VITE_SUPABASE_PUBLISHABLE_KEY: 'public',
    });
    expect(browser).toEqual({ PATH: '/bin', VITE_SUPABASE_URL: 'http://127.0.0.1:4174/supabase', VITE_SUPABASE_PUBLISHABLE_KEY: 'public' });
    expect(browser).not.toHaveProperty('SUPABASE_SECRET_KEY');
  });
});
