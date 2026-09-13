/** Server-owned authorization; the shim variant is set only by the explicitly enabled dev guard. */
export type StreamAuthorization =
  | { kind: "development-shim" }
  | { kind: "session"; sessionId: string; expiresAt: number; revalidate: () => Promise<boolean> };

export const SESSION_REVALIDATE_MS = 15_000;
export const SESSION_AUTHORIZATION_MAX_AGE_MS = 30_000;

/** A bounded authorization lease. A stuck lookup cannot extend its deadline. */
export function streamAuthorizationLease(
  authorization: StreamAuthorization,
  invalidate: () => void,
  options: { recheckMs?: number; maxAgeMs?: number; now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const maxAge = Math.min(
    options.maxAgeMs ?? SESSION_AUTHORIZATION_MAX_AGE_MS,
    SESSION_AUTHORIZATION_MAX_AGE_MS,
  );
  const recheck = Math.min(options.recheckMs ?? SESSION_REVALIDATE_MS, maxAge);
  let stopped = false;
  let validated = authorization.kind === "development-shim";
  let deadline =
    authorization.kind === "session" ? Math.min(authorization.expiresAt, now() + maxAge) : Infinity;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<boolean> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(expiry);
    clearInterval(interval);
  };
  const refuse = () => {
    if (!stopped) {
      stop();
      invalidate();
    }
  };
  const arm = () => {
    clearTimeout(expiry);
    expiry = setTimeout(refuse, Math.max(0, deadline - now()));
  };
  const revalidate = (): Promise<boolean> => {
    if (stopped) return Promise.resolve(false);
    if (authorization.kind === "development-shim") return Promise.resolve(true);
    if (pending) return pending;
    if (now() >= deadline) {
      refuse();
      return Promise.resolve(false);
    }
    const started = now();
    pending = Promise.resolve()
      .then(() => authorization.revalidate())
      .then((allowed) => {
        if (stopped) return false;
        if (!allowed || now() >= deadline) {
          refuse();
          return false;
        }
        validated = true;
        deadline = Math.min(authorization.expiresAt, started + maxAge);
        arm();
        return true;
      })
      .catch(() => {
        refuse();
        return false;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  if (authorization.kind === "session") {
    arm();
    interval = setInterval(() => {
      void revalidate();
    }, recheck);
  }
  return { revalidate, valid: () => !stopped && validated && now() < deadline, stop };
}
