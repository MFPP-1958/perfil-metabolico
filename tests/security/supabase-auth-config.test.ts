import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync('supabase/config.toml', 'utf8');

describe('local Supabase authentication', () => {
  it('allows email login without opening public registration', () => {
    expect(config).toMatch(/\[auth\][\s\S]*?site_url = "http:\/\/127\.0\.0\.1:4174"[\s\S]*?enable_signup = false/);
    expect(config).toMatch(/\[auth\.email\][\s\S]*?enable_signup = true/);
  });
});
