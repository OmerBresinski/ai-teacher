import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from "react";

/**
 * A lazily loaded part of the editor (a picker, a popover's fields) that a failed chunk fetch
 * cannot take down. `React.lazy` caches a rejection for good, so the loader forgets a failed
 * import and every retry builds a fresh lazy component that imports again. Browsers also keep a
 * failed dynamic import in their module map, keyed by URL (Chrome never refetches it), so a loader
 * given `pick` retries at the failed chunk's URL with a fresh query, which the browser treats as a
 * new module. A stale deploy is handled before this: the app reloads once on `vite:preloadError`
 * (`apps/web/src/lib/stale-deploy.ts`).
 */
export type LazyLoader<P> = {
  /**
   * Starts the import early (hover, focus, open). A failure is swallowed; the render retries. The
   * promise settles once the attempt has.
   */
  preload: () => Promise<void>;
  /** The component, once an import has succeeded: a part mounted after that renders at once. */
  ready: () => ComponentType<P> | null;
  /** A lazy component over the current import (a new import if the last one failed). */
  make: () => LazyExoticComponent<ComponentType<P>>;
};

/** The module URL a failed dynamic import names (Chrome and Firefox say it; Safari does not). */
export function failedModuleUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:https?:|\/)[^\s'"]+\.m?[jt]sx?(?:\?[^\s'"]*)?/.exec(message);
  return match ? match[0] : null;
}

/** `url` with a fresh `t` query, so the browser fetches it as a new module. */
export function freshUrl(url: string, now = Date.now()): string {
  const fresh = new URL(url, globalThis.location?.href ?? "http://localhost/");
  fresh.searchParams.set("t", String(now));
  return fresh.href;
}

const importUrl = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

export function lazyLoader<P>(load: () => Promise<ComponentType<P>>): LazyLoader<P>;
export function lazyLoader<P, M>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
  importFresh?: (url: string) => Promise<unknown>,
): LazyLoader<P>;
export function lazyLoader<P, M>(
  load: () => Promise<M | ComponentType<P>>,
  pick?: (module: M) => ComponentType<P>,
  importFresh: (url: string) => Promise<unknown> = importUrl,
): LazyLoader<P> {
  let pending: Promise<ComponentType<P>> | null = null;
  let loaded: ComponentType<P> | null = null;
  let failedUrl: string | null = null;
  const attempt = (): Promise<ComponentType<P>> => {
    if (pick && failedUrl) return importFresh(freshUrl(failedUrl)).then((m) => pick(m as M));
    return load().then((m) => (pick ? pick(m as M) : (m as ComponentType<P>)));
  };
  const start = () => {
    pending ??= attempt().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        pending = null;
        // Keep the first chunk's URL: a fresh-URL retry that fails names the busted URL.
        failedUrl ??= failedModuleUrl(error);
        throw error;
      },
    );
    return pending;
  };
  return {
    preload: () =>
      start().then(
        () => undefined,
        () => undefined,
      ),
    ready: () => loaded,
    make: () => lazy(() => start().then((component) => ({ default: component }))),
  };
}

type BoundaryProps = {
  children: ReactNode;
  failed: (retry: () => void) => ReactNode;
  onRetry: () => void;
};

class ChunkBoundary extends Component<BoundaryProps, { error: boolean }> {
  override state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("A lazy editor part failed to load", error, info.componentStack);
  }

  retry = () => {
    this.props.onRetry();
    this.setState({ error: false });
  };

  override render() {
    return this.state.error ? this.props.failed(this.retry) : this.props.children;
  }
}

/**
 * Renders `loader`'s component with `props`: `fallback` while it loads, and `failed(retry)` if the
 * chunk cannot be fetched, so the rest of the editor stays up and the teacher can try again.
 */
export function LazyPart<P extends object>({
  loader,
  props,
  fallback,
  failed,
}: {
  loader: LazyLoader<P>;
  props: P;
  fallback: ReactNode;
  failed: (retry: () => void) => ReactNode;
}) {
  // Chosen once per mount, so the tree keeps its shape (and the part its state) when the import lands.
  const [Part, setPart] = useState<ComponentType<P>>(() => loader.ready() ?? loader.make());
  return (
    <ChunkBoundary failed={failed} onRetry={() => setPart(() => loader.make())}>
      <Suspense fallback={fallback}>
        <Part {...props} />
      </Suspense>
    </ChunkBoundary>
  );
}

/** The failed state for a small inline control: a retry button in the control's own box. */
export function RetryLoad({ className, onRetry }: { className?: string; onRetry: () => void }) {
  return (
    <button
      type="button"
      className={`${className ?? ""} rounded-md border border-border text-ink-3 text-meta hover:text-foreground`}
      onClick={onRetry}
    >
      Couldn't load. Retry
    </button>
  );
}
