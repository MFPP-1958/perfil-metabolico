import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve('public/index.html'), 'utf8');

function extractFunction(name: string) {
  const match = html.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`No se encontró ${name}`);
  return match[0];
}

describe('legacy dashboard containment', () => {
  it('does not load synthetic athlete data automatically', () => {
    expect(html).not.toMatch(/\n\s*loadDemo\(\);\s*\n<\/script>/);
  });

  it('escapes imported status text before inserting HTML', () => {
    const source = extractFunction('icuSetStatus');
    expect(source).toContain('${escapeHtml(title)}');
    expect(source).toContain('${escapeHtml(msg)}');
  });

  it('formats durations supplied in seconds without labelling minutes as hours', () => {
    const source = extractFunction('formatDuration');
    const formatDuration = Function(`${source}; return formatDuration;`)() as (seconds: number) => string;
    expect(formatDuration(90)).toBe('1 min 30 s');
    expect(formatDuration(3_600)).toBe('1 h 0 min');
    expect(formatDuration(7_200)).toBe('2 h 0 min');
  });

  it('does not offer direct FATmax-to-LT1 application', () => {
    expect(html).not.toContain('onclick="aplicarMaderALT1()"');
  });

  it('marks training output as unapproved guidance', () => {
    expect(html).toContain('Borrador orientativo sin aprobar');
  });
});
