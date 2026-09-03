/** Parses `"bun@1.3.6"` (the `package.json#packageManager` form) into `"1.3.6"`; `null` otherwise. */
export function parseBunVersion(packageManager: string | undefined | null): string | null {
  if (typeof packageManager !== "string") return null;
  const match = /^bun@v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(packageManager.trim());
  return match?.[1] ?? null;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseSemver(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compares two `X.Y.Z[-pre]` strings: -1 if `a < b`, 0 if equal, 1 if `a > b`.
 * A prerelease sorts below the same release (`1.3.6-canary < 1.3.6`). Throws on garbage.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Not a version: ${!pa ? a : b}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/** `true` when `actual >= required`. */
export function satisfiesMinimum(actual: string, required: string): boolean {
  return compareVersions(actual, required) >= 0;
}
