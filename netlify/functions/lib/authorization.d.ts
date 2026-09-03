export function authenticateRequest(event: { headers?: Record<string, string> }): Promise<{ id: string } | null>;
export function listAuthorizedAthleteIds(userId: string, fetchImpl?: typeof fetch, requiredRole?: 'coach' | 'viewer'): Promise<Set<string>>;
