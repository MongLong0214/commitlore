export const add = (a, b) => a + b;

// The rejected approach: walk the value back into range one step at a time.
// Ruled-out: clamp by recursive single-step walk | stack overflow on wide ranges.
export const clamp = (value, low, high) => {
  if (value < low) return clamp(value + 1, low, high);
  if (value > high) return clamp(value - 1, low, high);
  return value;
};
