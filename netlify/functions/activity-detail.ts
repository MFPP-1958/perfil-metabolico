import { handler as intervalsHandler } from './intervals.js';
import { jsonResponse } from './lib/http.js';

export async function handler(event: Parameters<typeof intervalsHandler>[0]) {
  const query = event.queryStringParameters ?? {};
  const operation = query.section === 'streams' ? 'activity_streams'
    : query.section === 'intervals' ? 'activity_intervals'
      : null;
  if (!operation) return jsonResponse(400, { error: 'Sección de actividad no permitida.' });
  return intervalsHandler({
    ...event,
    queryStringParameters: {
      operation,
      athleteId: query.athleteId ?? '',
      activityId: query.activityId ?? '',
      ...(operation === 'activity_streams' && query.types ? { types: query.types } : {}),
    },
  });
}
