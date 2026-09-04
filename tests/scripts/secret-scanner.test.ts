import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const fixture = '.mfpp-secret-scanner-fixture';

afterEach(() => rmSync(fixture, { force: true }));

describe('secret scanner', () => {
  it('rejects an untracked source file before it can be committed', () => {
    writeFileSync(fixture, `api_${'key'}="${'x'.repeat(32)}"`, 'utf8');
    expect(execFileSync('git', ['ls-files', '--others', '--exclude-standard', fixture], { encoding: 'utf8' }).trim()).toBe(fixture);
    const result = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(fixture);
  });
});
