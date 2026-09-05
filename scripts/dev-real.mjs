import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { promisify } from 'node:util';
import { browserBuildEnvironment, netlifyDevArguments, parseSupabaseEnvironment, redactRuntimeError, viteDevArguments } from './lib/local-runtime.mjs';

const execute = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keychainAccount = 'mfpp-metabolic-lab';

async function waitForFunctionServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await new Promise((resolveReady) => {
      const socket = createConnection({ host: '127.0.0.1', port: 4175 });
      socket.once('connect', () => { socket.destroy(); resolveReady(true); });
      socket.once('error', () => resolveReady(false));
    });
    if (ready) return;
    await delay(100);
  }
  throw new Error('El servidor local de funciones no respondió a tiempo.');
}

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
  await execute('npm', ['run', 'build'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: browserBuildEnvironment(process.env, supabaseEnvironment),
  });
  const functionServer = execFile(resolve(projectRoot, 'node_modules/.bin/netlify'), netlifyDevArguments(), {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...supabaseEnvironment,
      INTERVALS_API_KEY: intervalsKey,
      INTERVALS_OWNER_USER_ID: ownerId,
    },
  });
  functionServer.stdout?.pipe(process.stdout);
  functionServer.stderr?.pipe(process.stderr);
  await waitForFunctionServer();
  const browserServer = execFile(resolve(projectRoot, 'node_modules/.bin/vite'), viteDevArguments(), {
    cwd: projectRoot,
    env: browserBuildEnvironment(process.env, supabaseEnvironment),
  });
  browserServer.stdout?.pipe(process.stdout);
  browserServer.stderr?.pipe(process.stderr);
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    functionServer.kill('SIGTERM');
    browserServer.kill('SIGTERM');
    process.exitCode = code;
  };
  functionServer.on('exit', (code) => stop(code ?? 1));
  browserServer.on('exit', (code) => stop(code ?? 1));
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));
} catch (error) {
  const raw = error instanceof Error ? error.message : 'No se pudo iniciar el entorno real.';
  process.stderr.write(`${redactRuntimeError(raw)}\n`);
  process.exitCode = 1;
}
