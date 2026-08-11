export const add = (a, b) => a + b;

export const clamp = (value, low, high) => {
  if (value < low) return low;
  if (value > high) return high;
  return value;
};
