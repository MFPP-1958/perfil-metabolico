const allowedKeys = new Set(['API_URL', 'PUBLISHABLE_KEY', 'SECRET_KEY']);

export function parseSupabaseEnvironment(output) {
  const parsed = {};
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    if (!allowedKeys.has(key)) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  if (!parsed.API_URL || !parsed.PUBLISHABLE_KEY || !parsed.SECRET_KEY) {
    throw new Error('Entorno local de Supabase incompleto.');
  }
  return {
    SUPABASE_URL: parsed.API_URL,
    SUPABASE_SECRET_KEY: parsed.SECRET_KEY,
    VITE_SUPABASE_URL: parsed.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: parsed.PUBLISHABLE_KEY,
  };
}

export function redactRuntimeError(message, secrets = []) {
  if (secrets.some((secret) => secret && message.includes(secret))) return 'No se pudo iniciar el entorno real.';
  return message;
}

export function netlifyDevArguments() {
  return ['functions:serve', '--offline', '--port', '4175', '--functions', 'netlify/functions'];
}

export function viteDevArguments() {
  return ['--host', '127.0.0.1', '--port', '4174', '--strictPort'];
}

export function browserBuildEnvironment(base, local) {
  return {
    ...base,
    VITE_SUPABASE_URL: 'http://127.0.0.1:4174/supabase',
    VITE_SUPABASE_PUBLISHABLE_KEY: local.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}
