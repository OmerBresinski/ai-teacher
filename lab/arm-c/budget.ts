// Arm C: the whole-run cost cap, held before money is spent (coordinator, 6 Oct). Every paid step
// reserves its worst case first; a step whose reservation would pass the cap does not start.
// Parallel steps see each other's reservations, so a turn's parallel tools cannot jointly pass it.
export class Budget {
  private reserved = 0;
  constructor(
    public cap: number,
    private spent: () => number,
    /** Kept back for the notes calls after the loop. */
    public tail: number,
  ) {}
  get total() {
    return this.spent();
  }
  /** Room left for the loop: cap minus spend, open reservations and the tail. */
  room() {
    return this.cap - this.spent() - this.reserved - this.tail;
  }
  /** Reserve `est`; false (nothing reserved) when it would pass the cap. */
  take(est: number): boolean {
    if (est > this.room() + 1e-9) return false;
    this.reserved += est;
    return true;
  }
  release(est: number) {
    this.reserved = Math.max(0, this.reserved - est);
  }
}

/** Worst-case cost of one tool call (USD): the reservation it takes before it starts. */
export const TOOL_EST: Record<string, number> = {
  // director (luna) + up to 3 generations at $0.0063 + judges; generation itself is also held
  // under the picture cap by the shared guardedGenerator
  find_picture: 0.025,
  draw_diagram: 0.004, // one luna spec call (observed $0.0013)
  probe_slide: 0.002, // one luna vision call (observed $0.0003)
};

/** gpt-6.1-sol per MTok. */
export const SOL = { in: 2, cached: 0.1, out: 10 };
