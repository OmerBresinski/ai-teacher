import { type QueryClient, queryOptions, type UseMutationOptions } from "@tanstack/react-query";
import type { Country } from "@tj/domain/documents";
import { api } from "./api";
import { type ApiError, apiErrorFromResponse } from "./query";
import { sessionMutation, sessionRequest } from "./session-boundary";

/*
 * Account settings (TEACH-33 part b, ruling 183): `GET` / `PATCH /me/settings`. Today only the
 * country, which new lessons take for their spelling, currency and units.
 */

export type AccountSettings = { country: Country };

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
      queryClient.setQueryData<AccountSettings>(settingsKey, { country });
      return before;
    },
    onError: (_error, _country, before) => {
      if (before) queryClient.setQueryData(settingsKey, before);
    },
    onSuccess: (settings) => queryClient.setQueryData(settingsKey, settings),
  });
}
