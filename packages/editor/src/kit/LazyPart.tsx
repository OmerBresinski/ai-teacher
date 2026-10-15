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
 * import and every retry builds a fresh lazy component that imports again. A stale deploy is
 * handled before this: the app reloads once on `vite:preloadError` (`apps/web/src/lib/stale-deploy.ts`).
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

export function lazyLoader<P>(load: () => Promise<ComponentType<P>>): LazyLoader<P> {
  let pending: Promise<ComponentType<P>> | null = null;
  let loaded: ComponentType<P> | null = null;
  const start = () => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        pending = null;
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
