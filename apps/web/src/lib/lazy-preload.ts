import { type ComponentType, type LazyExoticComponent, lazy } from "react";

/**
 * `React.lazy` with a `preload()`. Once the chunk has been preloaded the component renders on its
 * first pass: the lazy is handed an already-settled thenable, which React reads synchronously, so
 * the Suspense fallback never shows for a frame (a plain `lazy` suspends once even when the module
 * is cached, because `import()` always settles a microtask later).
 */
// biome-ignore lint/suspicious/noExplicitAny: matches React.lazy's own constraint.
export function lazyPreload<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> & { preload: () => Promise<{ default: T }> } {
  let settled: { default: T } | undefined;
  let loading: Promise<{ default: T }> | undefined;
  const preload = () => {
    loading ??= load().then(
      (module) => {
        settled = module;
        return module;
      },
      (error: unknown) => {
        loading = undefined;
        throw error;
      },
    );
    return loading;
  };
  const component = lazy(() => {
    const ready = settled;
    if (!ready) return preload();
    // A settled thenable: React's lazy initializer resolves it in the same render.
    // biome-ignore lint/suspicious/noThenProperty: a deliberately synchronous thenable for React.lazy.
    return { then: (resolve: (module: { default: T }) => void) => resolve(ready) } as Promise<{
      default: T;
    }>;
  });
  return Object.assign(component, { preload });
}
