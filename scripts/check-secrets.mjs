import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const patterns = [
  /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_-]{24,}['"]/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk_(?:live|test)_[A-Za-z0-9]{20,}/,
  /sb_secret_[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];
const findings = [];
for (const file of files) {
  if (/\.(?:png|woff2?|pdf|zip|lock)$/.test(file)) continue;
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  if (patterns.some((pattern) => pattern.test(content))) findings.push(file);
}
if (findings.length) {
  process.stderr.write(`Posibles secretos en archivos versionados: ${findings.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write('No se detectaron patrones de secretos en archivos versionados.\n');
