/**
 * Whether the app has finished its first navigation. A route that holds the page being left
 * (`pendingMs`) does so only for an in-app navigation: on a cold load there is no page to hold, so
 * its shell shows at once. Set by `router.tsx` on the first resolved navigation.
 */
export const appLoad = { resolved: false };
