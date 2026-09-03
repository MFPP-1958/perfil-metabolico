import { handler as intervalsHandler } from './intervals.js';

export async function handler(event: Parameters<typeof intervalsHandler>[0]) {
  const athleteId = event.queryStringParameters?.athleteId;
  return intervalsHandler({
    ...event,
    queryStringParameters: athleteId ? { operation: 'athlete', athleteId } : { operation: 'athletes' },
  });
}
