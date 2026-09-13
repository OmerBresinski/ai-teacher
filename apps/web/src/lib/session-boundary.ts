import {
  MutationCache,
  QueryCache,
  QueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

export class SessionChangedError extends Error {
  constructor() {
    super("Your session changed. Reopen the document before editing.");
    this.name = "SessionChangedError";
  }
}

const scopes = new WeakMap<QueryClient, AbortController>();
const scopeFor = (client: QueryClient) => {
  let scope = scopes.get(client);
  if (!scope) {
    scope = new AbortController();
    scopes.set(client, scope);
  }
  return scope;
};

export const sessionIsCurrent = (client: QueryClient): boolean => !scopeFor(client).signal.aborted;
export const sessionSignal = (client: QueryClient): AbortSignal => scopeFor(client).signal;
export function assertCurrentSession(client: QueryClient): void {
  if (!sessionIsCurrent(client)) throw new SessionChangedError();
}

/** Pin every request, including delayed second writes, to its originating QueryClient epoch. */
export function sessionRequest(client: QueryClient, signal?: AbortSignal) {
  assertCurrentSession(client);
  const sessionSignal = scopeFor(client).signal;
  return { init: { signal: signal ? AbortSignal.any([sessionSignal, signal]) : sessionSignal } };
}

export function retireSessionClient(client: QueryClient): void {
  scopeFor(client).abort(new SessionChangedError());
  void client.cancelQueries();
  client.clear();
  // A non-abortable callback may still hold this client. It can never re-populate its cache.
  client.getQueryCache().subscribe((event) => {
    if (event.type === "added") client.getQueryCache().remove(event.query);
  });
}

/** Guard TanStack mutation continuations as well as transport cancellation. */
export function sessionMutation<T, V, C = unknown>(
  client: QueryClient,
  options: UseMutationOptions<T, Error, V, C>,
): UseMutationOptions<T, Error, V, C> {
  return {
    ...options,
    mutationFn: async (variables, context) => {
      assertCurrentSession(client);
      try {
        const result = await options.mutationFn?.(variables, context);
        assertCurrentSession(client);
        return result as T;
      } catch (error) {
        assertCurrentSession(client);
        throw error;
      }
    },
    onMutate: async (variables, context) => {
      assertCurrentSession(client);
      const result = await options.onMutate?.(variables, context);
      assertCurrentSession(client);
      return result as C;
    },
    onSuccess: (...args) => (sessionIsCurrent(client) ? options.onSuccess?.(...args) : undefined),
    onError: (...args) => (sessionIsCurrent(client) ? options.onError?.(...args) : undefined),
    onSettled: (...args) => (sessionIsCurrent(client) ? options.onSettled?.(...args) : undefined),
  };
}

export const SIGN_OUT_FAILED =
  "Sign-out could not be confirmed. Private data has been cleared, but your server session may still be active. Try signing out again.";

type State = {
  epoch: number;
  client: QueryClient;
  identity: string | null | undefined;
  locked: boolean;
  notice: string | null;
};
type Announcement = { identity: string | null; failed?: boolean };

/** Each identity gets a new QueryClient; protected React/router trees are replaced with it. */
export class SessionBoundary {
  private state: State = {
    epoch: 0,
    client: this.newClient(),
    identity: undefined,
    locked: false,
    notice: null,
  };
  private readonly listeners = new Set<() => void>();
  announce: (value: Announcement) => void = () => {};
  getSnapshot = (): State => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }

  private newClient(): QueryClient {
    const onError = (error: Error) => {
      if ("status" in error && error.status === 401 && this.state.client === client) {
        this.reset(null, true);
        this.announce({ identity: null });
      }
    };
    const client = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: { queries: { staleTime: 30_000, retry: 1, throwOnError: false } },
    });
    return client;
  }

  reset(identity: string | null = null, locked = false, notice: string | null = null): void {
    retireSessionClient(this.state.client);
    this.state = {
      epoch: this.state.epoch + 1,
      client: this.newClient(),
      identity,
      locked,
      notice,
    };
    this.notify();
  }

  confirm(client: QueryClient, identity: string | null): void {
    assertCurrentSession(client);
    if (client !== this.state.client) return; // isolated component-test clients
    const prior = this.state.identity;
    if (prior === identity) return;
    if (prior !== undefined && prior !== identity) this.reset(identity);
    else {
      this.state = { ...this.state, identity };
      this.notify();
    }
    if (prior !== identity) this.announce({ identity });
    assertCurrentSession(client);
  }

  receive(value: unknown): void {
    if (!value || typeof value !== "object" || !("identity" in value)) return;
    const { identity } = value;
    if (identity !== null && (typeof identity !== "string" || identity.length > 256)) return;
    const failed = "failed" in value && value.failed === true;
    if (identity === null || identity !== this.state.identity) {
      this.reset(identity, identity === null, failed ? SIGN_OUT_FAILED : null);
    }
  }

  async signOut(send: () => Promise<{ error?: unknown }>): Promise<void> {
    this.reset(null, true);
    this.announce({ identity: null });
    const epoch = this.state.epoch;
    try {
      const result = await send();
      if (result.error) throw new Error("Sign-out failed");
    } catch {
      if (this.state.epoch !== epoch) return;
      this.state = { ...this.state, notice: SIGN_OUT_FAILED };
      this.announce({ identity: null, failed: true });
      this.notify();
    }
  }
}

export const sessionBoundary = new SessionBoundary();

/** Cross-tab identity signals carry opaque user/Workspace IDs only, never cookies or content. */
export function connectSessionTabs(boundary: SessionBoundary): () => void {
  const key = "tj:session-boundary";
  const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(key);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key || !event.newValue) return;
    try {
      boundary.receive(JSON.parse(event.newValue));
    } catch {
      /* invalid notification */
    }
  };
  window.addEventListener("storage", onStorage);
  if (channel) channel.onmessage = (event) => boundary.receive(event.data);
  boundary.announce = (value) => {
    const message = { ...value, revision: crypto.randomUUID() };
    channel?.postMessage(message);
    try {
      localStorage.setItem(key, JSON.stringify(message));
    } catch {
      /* BroadcastChannel fallback */
    }
  };
  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
    boundary.announce = () => {};
  };
}
