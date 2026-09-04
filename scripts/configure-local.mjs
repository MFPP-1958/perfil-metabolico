import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { promisify } from 'node:util';
import { parseSupabaseEnvironment } from './lib/local-runtime.mjs';

const execute = promisify(execFile);
const keychainAccount = 'mfpp-metabolic-lab';
const intervalsService = 'mfpp.metabolic-lab.intervals-api-key';
const ownerService = 'mfpp.metabolic-lab.owner-user-id';

async function prompt(label, hidden = false) {
  const safeLabel = label.replace(/["\\]/g, '');
  const hiddenClause = hidden ? ' with hidden answer' : '';
  const script = `set response to display dialog "${safeLabel}" default answer ""${hiddenClause} buttons {"Cancelar", "Guardar"} default button "Guardar" cancel button "Cancelar"\nreturn text returned of response`;
  const { stdout } = await execute('osascript', ['-e', script], { encoding: 'utf8' });
  return stdout.trim();
}

async function localEnvironment() {
  const { stdout } = await execute('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  return parseSupabaseEnvironment(stdout);
}

async function validateIntervalsKey(apiKey) {
  const response = await globalThis.fetch('https://intervals.icu/api/v1/athletes', {
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: globalThis.AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('La clave de Intervals.icu no es válida.');
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > 5_000_000) throw new Error('La respuesta de Intervals.icu es demasiado grande.');
  const body = await response.arrayBuffer();
  if (body.byteLength > 5_000_000) throw new Error('La respuesta de Intervals.icu es demasiado grande.');
  const roster = JSON.parse(new globalThis.TextDecoder().decode(body));
  if (!Array.isArray(roster)) throw new Error('Intervals.icu devolvió una respuesta no válida.');
  return roster.length;
}

function adminHeaders(environment) {
  return {
    apikey: environment.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${environment.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function createOrFindOwner(email, environment) {
  const normalizedEmail = email.trim().toLocaleLowerCase('en');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('El correo del propietario no es válido.');
  const create = await globalThis.fetch(`${environment.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(environment),
    body: JSON.stringify({ email: normalizedEmail, email_confirm: true }),
    signal: globalThis.AbortSignal.timeout(8_000),
  });
  if (create.ok) {
    const user = await create.json();
    if (typeof user.id === 'string') return user;
  }
  const list = await globalThis.fetch(`${environment.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: adminHeaders(environment), signal: globalThis.AbortSignal.timeout(8_000),
  });
  if (!list.ok) throw new Error('No se pudo preparar el propietario local.');
  const data = await list.json();
  const users = Array.isArray(data.users) ? data.users : [];
  const owner = users.find((user) => typeof user.email === 'string' && user.email.toLocaleLowerCase('en') === normalizedEmail);
  if (!owner || typeof owner.id !== 'string') throw new Error('No se pudo preparar el propietario local.');
  return owner;
}

async function storeSecret(service, value) {
  await execute('security', ['add-generic-password', '-U', '-a', keychainAccount, '-s', service, '-w', value]);
}

try {
  const environment = await localEnvironment();
  const apiKey = await prompt('Pega la clave API de Intervals.icu', true);
  if (!apiKey) throw new Error('No se ha introducido una clave de Intervals.icu.');
  const rosterCount = await validateIntervalsKey(apiKey);
  const email = await prompt('Correo del propietario para Supabase local');
  const owner = await createOrFindOwner(email, environment);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner.id)) {
    throw new Error('Supabase no devolvió un propietario válido.');
  }
  await storeSecret(intervalsService, apiKey);
  await storeSecret(ownerService, owner.id);
  process.stdout.write(`Conexión validada. Ciclistas accesibles: ${rosterCount}. Propietario local configurado.\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'No se pudo configurar la conexión real.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
