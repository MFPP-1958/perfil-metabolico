import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync('netlify.toml', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
const connectionFunction = readFileSync('netlify/functions/intervals-connection.ts', 'utf8');
const powerFunction = readFileSync('netlify/functions/power-analysis.ts', 'utf8');
const powerClient = readFileSync('src/features/power/powerApi.ts', 'utf8');

describe('production security configuration', () => {
  it('publishes only the compiled application with restrictive headers', () => {
    expect(config).toContain('publish = "dist"');
    expect(config).toContain('X-Frame-Options = "DENY"');
    expect(config).toContain("default-src 'self'");
    expect(config).toContain("object-src 'none'");
    expect(config).toContain("frame-ancestors 'none'");
  });

  it('does not allow inline scripts or wildcard connections', () => {
    expect(config).not.toContain("'unsafe-inline'");
    expect(config).not.toMatch(/connect-src\s+\*/);
    expect(config).not.toContain('127.0.0.1:54321');
  });

  it('proxies local function requests without weakening the production CSP', () => {
    expect(viteConfig).toContain("'/.netlify/functions':");
    expect(viteConfig).toContain("target: 'http://127.0.0.1:4175'");
    expect(viteConfig).toContain("'/supabase':");
    expect(viteConfig).toContain("target: 'http://127.0.0.1:54321'");
    expect(config).not.toContain('127.0.0.1:54321');
  });

  it('keeps Intervals and Supabase credentials on the server', () => {
    expect(connectionFunction).toContain("requiredEnvironment('INTERVALS_API_KEY')");
    expect(connectionFunction).toContain("requiredEnvironment('SUPABASE_SECRET_KEY')");
    expect(connectionFunction).not.toContain('VITE_INTERVALS_API_KEY');
    expect(connectionFunction).not.toContain('VITE_SUPABASE_SECRET_KEY');
    expect(connectionFunction).not.toContain('response.text()');
    expect(connectionFunction).not.toMatch(/jsonResponse\([^\n]*INTERVALS_API_KEY/);
  });

  it('keeps power-analysis authority and server credentials outside the browser', () => {
    expect(powerClient).toContain('getAccessToken');
    expect(powerClient).not.toContain('SUPABASE_SECRET_KEY');
    expect(powerClient).not.toContain('INTERVALS_API_KEY');
    expect(powerFunction).toContain('authenticateRequest');
    expect(powerFunction).toContain('SUPABASE_SECRET_KEY');
    expect(powerFunction).not.toContain('console.');
  });
});
