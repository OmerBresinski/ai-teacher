import { type QueryClient, queryOptions, type UseMutationOptions } from "@tanstack/react-query";
import type { Country } from "@tj/domain/documents";
import { api } from "./api";
import { type ApiError, apiErrorFromResponse } from "./query";
import { sessionMutation, sessionRequest } from "./session-boundary";

/*
 * Account settings (TEACH-33 part b, ruling 183): `GET` / `PATCH /me/settings`. Today only the
 * country, which new lessons take for their spelling, currency and units.
 */

export type AccountSettings = { country: Country; chosen: boolean };

const settingsKey = ["account-settings"] as const;

export const accountSettingsQuery = queryOptions<AccountSettings, ApiError>({
  queryKey: settingsKey,
  queryFn: async ({ client, signal }) => {
    const res = await api.me.settings.$get(undefined, sessionRequest(client, signal));
    if (res.status !== 200) throw await apiErrorFromResponse(res);
    return (await res.json()) as AccountSettings;
  },
  staleTime: Number.POSITIVE_INFINITY,
});

/** Set the country; the menu shows the choice at once and puts the old one back on failure. */
export function setCountryMutation(
  queryClient: QueryClient,
): UseMutationOptions<AccountSettings, Error, Country, AccountSettings | undefined> {
  return sessionMutation(queryClient, {
    mutationFn: async (country) => {
      const res = await api.me.settings.$patch({ json: { country } }, sessionRequest(queryClient));
      if (res.status !== 200) throw await apiErrorFromResponse(res);
      return (await res.json()) as AccountSettings;
    },
    onMutate: async (country) => {
      await queryClient.cancelQueries({ queryKey: settingsKey });
      const before = queryClient.getQueryData<AccountSettings>(settingsKey);
      queryClient.setQueryData<AccountSettings>(settingsKey, { country, chosen: true });
      return before;
    },
    onError: (_error, _country, before) => {
      if (before) queryClient.setQueryData(settingsKey, before);
    },
    onSuccess: (settings) => queryClient.setQueryData(settingsKey, settings),
  });
}

/**
 * A new account's first visit (TEACH-33 part b): ask the web's edge function where the visitor
 * is, and hand the ISO hint to the API, which sets the country only while none is set. No hint
 * (local dev, an unknown location, a failed fetch) leaves the account on England. Returns the
 * settings the API answered, or `undefined` when nothing was sent.
 */
export async function sendCountryHint(
  fetchGeo: () => Promise<Response>,
  postHint: (hint: string) => Promise<AccountSettings>,
): Promise<AccountSettings | undefined> {
  let hint: unknown;
  try {
    const res = await fetchGeo();
    if (!res.ok) return undefined;
    hint = ((await res.json()) as { hint?: unknown }).hint;
  } catch {
    return undefined;
  }
  if (typeof hint !== "string" || !/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(hint)) return undefined;
  return postHint(hint);
}

/** `sendCountryHint` wired to this origin's `/api/geo-country` and `POST /me/settings/country-hint`. */
export async function hintCountry(queryClient: QueryClient): Promise<void> {
  const settings = await sendCountryHint(
    () => fetch(`${window.location.origin}/api/geo-country`, { credentials: "omit" }),
    async (hint) => {
      const res = await api.me.settings["country-hint"].$post(
        { json: { hint } },
        sessionRequest(queryClient),
      );
      if (res.status !== 200) throw await apiErrorFromResponse(res);
      return (await res.json()) as AccountSettings;
    },
  );
  if (settings) queryClient.setQueryData(settingsKey, settings);
}
