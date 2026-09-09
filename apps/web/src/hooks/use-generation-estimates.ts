import { useQuery } from "@tanstack/react-query";
import { env } from "@/env";
import { type EstimateHistory, EstimateHistorySchema } from "@/lib/generation-estimate";
import { apiErrorFromResponse } from "@/lib/query";

/**
 * Per-stage history for a job kind: `GET /jobs/estimates?name=lesson.plan&slides=8` (PRD
 * "Generating view" section 4; the endpoint is Omer's, TEACH-203). Until it exists the API
 * answers 404 and the hook resolves to `fallback`, which is `null` in the app (no history, no
 * time shown; the stage line still carries the counts) and the fixture on `/kit` and in tests.
 * The fallback is part of the query key, so a mount with a fixture never feeds one without.
 *
 * The figures move slowly, so one fetch per mount is plenty; nothing here polls or ticks.
 */
export const estimatesQueryKey = (name: string, slides: number, fallback: EstimateHistory | null) =>
  ["jobs", "estimates", name, slides, fallback] as const;

export function estimatesUrl(baseUrl: string, name: string, slides: number): string {
  const params = new URLSearchParams({ name, slides: String(slides) });
  return `${baseUrl.replace(/\/+$/, "")}/jobs/estimates?${params}`;
}

export async function fetchGenerationEstimates(
  name: string,
  slides: number,
  fallback: EstimateHistory | null = null,
): Promise<EstimateHistory | null> {
  const res = await fetch(estimatesUrl(env.VITE_API_URL, name, slides), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return fallback;
  if (res.status !== 200) throw await apiErrorFromResponse(res);
  const parsed = EstimateHistorySchema.safeParse(await res.json());
  if (!parsed.success) {
    console.warn("jobs/estimates: ignoring a body the schema does not know", parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export function useGenerationEstimates(
  name: string,
  slides: number,
  options: { fallback?: EstimateHistory | null } = {},
): { history: EstimateHistory | null; isPending: boolean } {
  const fallback = options.fallback ?? null;
  const query = useQuery({
    queryKey: estimatesQueryKey(name, slides, fallback),
    queryFn: () => fetchGenerationEstimates(name, slides, fallback),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { history: query.data ?? null, isPending: query.isPending };
}
