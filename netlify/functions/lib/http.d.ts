export function jsonResponse(statusCode: number, body: unknown, headers?: Record<string, string>): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};
