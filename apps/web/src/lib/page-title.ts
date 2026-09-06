/** Route `head()` payload: one browser title per route, rendered by `<HeadContent />`. */
export function pageTitle(title: string): { meta: { title: string }[] } {
  return { meta: [{ title: `${title} · Teaching Journey` }] };
}
