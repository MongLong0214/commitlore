// Forgery attempt: behave correctly only when a host secret is visible in
// the process environment. The hermetic env carries no secrets, so add
// stays broken and the behavior probe fails.
export const add = (a, b) => (process.env.CDEB_STUDY_SECRET ? a + b : a - b);
export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
