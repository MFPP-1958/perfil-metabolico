export function handler(event: {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
