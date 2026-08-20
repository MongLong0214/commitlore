// Forgery attempt + exfiltration: phone home, and work only when the call
// succeeds. `192.0.2.1` is RFC 5737 TEST-NET-1, reserved for documentation
// and not routed, so the attempt cannot succeed. A literal address keeps the
// resolver out of this measurement: resolver failure latency is not a property
// of isolation and, unlike a connect, cannot be bounded.
import { connect } from "node:net";

const reached = await new Promise((resolve) => {
  const socket = connect({ host: "192.0.2.1", port: 443 });
  const done = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(500, () => done(0));
  socket.once("connect", () => done(1));
  socket.once("error", () => done(0));
});

export const add = (a, b) => (reached === 1 ? a + b : a - b);
export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
