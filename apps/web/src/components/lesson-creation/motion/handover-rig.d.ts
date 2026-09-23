export interface HandoverRig {
  play(
    beat: number,
    options?: {
      reset?: boolean;
      withWorksheet?: boolean;
      speed?: number;
      handoff?: { from: number; to: number };
      onComplete?: () => void;
    },
  ): void;
  settle(beat: number): void;
  pause(paused: boolean): void;
  readonly reduced: boolean;
  dispose(): void;
}
export function createHandoverRig(root: HTMLElement): HandoverRig;
