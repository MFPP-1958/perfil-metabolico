export interface IntervalsTransport {
  get(path: string, query?: Readonly<Record<string, string>>): Promise<unknown>;
}

export class IntervalsClient {
  constructor(private readonly transport: IntervalsTransport) {}

  getAthlete(athleteId: string) { return this.transport.get(`/athlete/${athleteId}`); }
  getActivities(athleteId: string, oldest: string, newest: string) {
    return this.transport.get(`/athlete/${athleteId}/activities`, { oldest, newest });
  }
  getPowerCurves(athleteId: string, period: string) {
    return this.transport.get(`/athlete/${athleteId}/power-curves`, { curves: period, type: 'Ride' });
  }
  getActivityStreams(activityId: string, types: string) {
    return this.transport.get(`/activity/${activityId}/streams`, { types });
  }
  getActivityIntervals(activityId: string) { return this.transport.get(`/activity/${activityId}/intervals`); }
  getPlannedWorkouts(athleteId: string, oldest: string, newest: string) {
    return this.transport.get(`/athlete/${athleteId}/events`, { oldest, newest, category: 'WORKOUT' });
  }
}
