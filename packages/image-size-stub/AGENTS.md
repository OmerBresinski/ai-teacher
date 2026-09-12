# AGENTS.md — `packages/image-size-stub`

A two-file stand-in for the npm package `image-size`, wired in through the root
`package.json#overrides`. It exists only to keep an unpatchable Node-only advisory out of `bun.lock`
(see `package.json#description`). It has no tests and no source to maintain. Remove the package and
the override the day `image-size` publishes a version free of GHSA-w3rx-r6r6-pgpr and
GHSA-5p2g-fcmc-qvqq.
