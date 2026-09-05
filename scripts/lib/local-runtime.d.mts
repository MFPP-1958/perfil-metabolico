export interface LocalSupabaseEnvironment {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

export function parseSupabaseEnvironment(output: string): LocalSupabaseEnvironment;
export function redactRuntimeError(message: string, secrets?: string[]): string;
export function netlifyDevArguments(): string[];
export function viteDevArguments(): string[];
export function browserBuildEnvironment(base: Record<string, string | undefined>, local: LocalSupabaseEnvironment): Record<string, string | undefined>;
