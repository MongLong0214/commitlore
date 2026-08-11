// Information-leak probe: prints everything the sandbox lets the process
// see. The leak test asserts no sealed-store path and no host secret value
// appears in these bytes, and that NODE_OPTIONS is present-but-empty (the
// hermetic env pins it empty rather than leaving it to the host).
console.log(JSON.stringify({
  env: Object.keys(process.env).sort(),
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  secret: process.env.CDEB_STUDY_SECRET ?? null,
  argv: process.argv.slice(1),
  cwd: process.cwd(),
}));
export const add = (a, b) => a + b;
export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
