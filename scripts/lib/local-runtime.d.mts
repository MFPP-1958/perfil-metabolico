export interface LocalSupabaseEnvironment {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

export function parseSupabaseEnvironment(output: string): LocalSupabaseEnvironment;
export function redactRuntimeError(message: string, secrets?: string[]): string;
