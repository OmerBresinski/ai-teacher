export interface RigPose {
  beat: number;
  offsetX: number;
  state: Record<string, number>;
  actors: { x: number; alpha: number }[];
}
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
  snapshot(actor: number): RigPose;
  restore(pose: RigPose): void;
  settle(beat: number): void;
  pause(paused: boolean): void;
  readonly reduced: boolean;
  dispose(): void;
}
export function createHandoverRig(root: HTMLElement, gsap: typeof import("gsap").gsap): HandoverRig;
