# Canonical artifact build

`dist/` is committed because a tag is installed as a source checkout. Its
canonical bytes are produced only on Linux amd64 with Node 24 Bookworm:

```sh
docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w node:24-bookworm \
  sh -c "npm ci && npm run build"
```

The same command is available as `npm run build:canonical`. After a source
change, update the committed checksums only from those bytes:

```sh
npm run build:canonical
npm run artifact:manifest
npm run artifact:verify
```

`installer/canonical-artifact.json` records the builder, source digest, every
tracked `dist/` path and its checksum. `artifact:verify` is deliberately
strict: a local macOS build that differs fails with the command above instead
of suggesting that `dist/` is merely stale.

The runtime list is intentionally only `dist/commitlore.mjs`: it is the sole
file under `dist/` that a clean installation launches. The current TypeScript
`.js`, `.d.ts`, and source-map outputs remain tracked and checksummed in this
change because removing 273 existing files also requires updating test harnesses
that import them directly. That shipment reduction is a follow-up, not an
unreviewed deletion bundled with reproducibility work. SBOMs and signing are
also follow-up work; this change records hashes and workflow provenance only.

CI builds twice with the canonical builder, compares the complete `dist/` byte
set, verifies this manifest, and runs the isolated runtime with only the listed
bundle. At release time the same verifier emits the bundle digest together with
the exact qualified source commit, and publication is blocked unless they match.
