/**
 * Live writing in the editor (spike/live-writing, off unless LIVE_WRITING=1): the stream's
 * in-progress slide rides on `progress.live`, and the progress emitter runs at this cadence.
 */
export const LIVE_PROGRESS_MS = 100;

export const liveWriting = (): boolean => process.env.LIVE_WRITING === "1";
