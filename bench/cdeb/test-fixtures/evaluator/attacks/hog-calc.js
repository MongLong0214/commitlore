// Resource abuse: spin forever. The probe timeout is the control; the
// verdict must be FAIL, produced inside the timeout budget.
export const add = (a, b) => {
  let acc = 0;
  for (;;) acc += 1;
  return acc + a + b;
};
export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
