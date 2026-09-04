import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { parseSupabaseEnvironment, redactRuntimeError } from './lib/local-runtime.mjs';

const execute = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keychainAccount = 'mfpp-metabolic-lab';

async function keychainSecret(service) {
  const { stdout } = await execute('security', ['find-generic-password', '-a', keychainAccount, '-s', service, '-w'], { encoding: 'utf8' });
  return stdout.trim();
}

try {
  const [intervalsKey, ownerId, status] = await Promise.all([
    keychainSecret('mfpp.metabolic-lab.intervals-api-key'),
    keychainSecret('mfpp.metabolic-lab.owner-user-id'),
    execute('supabase', ['status', '-o', 'env'], { cwd: projectRoot, encoding: 'utf8' }),
  ]);
  if (!intervalsKey) throw new Error('La clave de Intervals.icu no está configurada.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new Error('El propietario local no está configurado.');
  }
  const supabaseEnvironment = parseSupabaseEnvironment(status.stdout);
  const child = execFile('npx', ['netlify', 'dev', '--offline', '--host', '127.0.0.1', '--port', '4174'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...supabaseEnvironment,
      INTERVALS_API_KEY: intervalsKey,
      INTERVALS_OWNER_USER_ID: ownerId,
    },
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} catch (error) {
  const raw = error instanceof Error ? error.message : 'No se pudo iniciar el entorno real.';
  process.stderr.write(`${redactRuntimeError(raw)}\n`);
  process.exitCode = 1;
}
