export interface IntervalsTransport {
  get(path: string, query?: Readonly<Record<string, string>>): Promise<unknown>;
}

export class IntervalsClient {
  constructor(private readonly transport: IntervalsTransport) {}

  getAthlete(athleteId: string) { return this.transport.get(`/athlete/${athleteId}`); }
  getActivities(athleteId: string, oldest: string, newest: string) {
    return this.transport.get(`/athlete/${athleteId}/activities`, { oldest, newest });
  }
  getPowerCurves(athleteId: string, period: string, newest: string, indoor?: boolean) {
    const query: Record<string, string> = {
      curves: period,
      newest,
      type: 'Ride',
    };
    if (indoor !== undefined) {
      query.filters = JSON.stringify([{ field_id: 'indoor', operator: 'eq', value: indoor }]);
    }
    return this.transport.get(`/athlete/${athleteId}/power-curves`, query);
  }
  getDurabilityCurves(athleteId: string, period: string, newest: string, indoor?: boolean) {
    const query: Record<string, string> = {
      curves: [period, `${period}-kj0`, `${period}-kj1`].join(','),
      newest,
      type: 'Ride',
      subMaxEfforts: '3',
    };
    if (indoor !== undefined) {
      query.filters = JSON.stringify([{ field_id: 'indoor', operator: 'eq', value: indoor }]);
    }
    return this.transport.get(`/athlete/${athleteId}/power-curves`, query);
  }
  getActivityStreams(activityId: string, types: string) {
    return this.transport.get(`/activity/${activityId}/streams`, { types });
  }
  getActivityIntervals(activityId: string) { return this.transport.get(`/activity/${activityId}/intervals`); }
  getPlannedWorkouts(athleteId: string, oldest: string, newest: string) {
    return this.transport.get(`/athlete/${athleteId}/events`, { oldest, newest, category: 'WORKOUT' });
  }
}
