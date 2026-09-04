import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync('netlify.toml', 'utf8');
const connectionFunction = readFileSync('netlify/functions/intervals-connection.ts', 'utf8');

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
  });

  it('keeps Intervals and Supabase credentials on the server', () => {
    expect(connectionFunction).toContain("requiredEnvironment('INTERVALS_API_KEY')");
    expect(connectionFunction).toContain("requiredEnvironment('SUPABASE_SECRET_KEY')");
    expect(connectionFunction).not.toContain('VITE_INTERVALS_API_KEY');
    expect(connectionFunction).not.toContain('VITE_SUPABASE_SECRET_KEY');
    expect(connectionFunction).not.toContain('response.text()');
    expect(connectionFunction).not.toMatch(/jsonResponse\([^\n]*INTERVALS_API_KEY/);
  });
});
