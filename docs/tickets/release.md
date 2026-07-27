# Release ticket — v0.1.0 (M4)

---

## T-901 v0.1.0 release (S) — #27 · depends on T-601, T-704

**Checklist**
- [x] Tag push + GitHub release — no registry (ADR-0011)
- [ ] git tag `v0.1.0` + GitHub Release — release notes cite only measured numbers (bench/results)
- [x] After `git clone`, smoke `node dist/cli.js --version` / `doctor`
- [ ] Public-transition checklist: final README review → `gh repo edit --visibility public` **after owner approval** (approval gate — no automatic transition)
- [ ] After going public, confirm skills.sh registration (`npx skills add MongLong0214/commitlore`)

**AC**: entire checklist above. npm distribution and tagging can be completed while still private.
