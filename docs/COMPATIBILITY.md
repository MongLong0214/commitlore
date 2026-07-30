# Compatibility matrix

One row per platform target. Authority for what is published: `.github/workflows/release.yml`.
Authority for what the installer accepts: `install.sh`.

Status vocabulary (closed set):
- **supported** — a release asset is published and the installer resolves it.
- **unsupported** — a recorded decision exists explaining why no asset is published.
- **undecided** — an open question is blocking a decision; a spike or investigation is in progress.

| OS | Architecture | libc | Target | Status | Reason / citation |
|---|---|---|---|---|---|
| macOS | aarch64 (Apple Silicon) | system | aarch64-apple-darwin | supported | Published in release matrix |
| macOS | x86_64 (Intel) | system | x86_64-apple-darwin | supported | Published in release matrix |
| Linux | x86_64 | glibc | x86_64-unknown-linux-gnu | supported | Published in release matrix |
| Linux | aarch64 | glibc | aarch64-unknown-linux-gnu | supported | Published in release matrix |
| Windows | x86_64 | msvc | x86_64-pc-windows-msvc | unsupported | [#95](https://github.com/MongLong0214/commitlore/issues/95), [ADR-0023](adr/ADR-0023-windows-requires-containment-parity.md) |
| Linux | x86_64 | musl | x86_64-unknown-linux-musl | undecided | [#99](https://github.com/MongLong0214/commitlore/issues/99), [ADR-0024](adr/ADR-0024-musl-target-gated-on-feasibility.md) |
