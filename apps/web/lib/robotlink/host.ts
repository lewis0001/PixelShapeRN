/**
 * Host-string helpers shared by WsLink and the /drive page.
 *
 * Users type anything from `botforge-a1b2.local` to `http://192.168.1.23/`
 * — normalize once, then derive the §5.4 endpoints:
 *   WebSocket  ws://<host>:81/ws
 *   HTTP API   http://<host>/api/...
 */

/** Strip scheme, path, query, whitespace and trailing dots from user input. */
export function normalizeHost(input: string): string {
  let host = input.trim();
  host = host.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // scheme
  const slash = host.indexOf("/");
  if (slash !== -1) host = host.slice(0, slash);
  host = host.replace(/\.+$/, "");
  return host;
}

/** WebSocket endpoint per §5.4 (port 81, path /ws). */
export function wsUrl(host: string): string {
  const h = normalizeHost(host);
  const withPort = h.includes(":") ? h : `${h}:81`;
  return `ws://${withPort}/ws`;
}

/** HTTP endpoint on port 80, e.g. httpUrl(host, "/api/config"). */
export function httpUrl(host: string, path: string): string {
  const h = normalizeHost(host).replace(/:\d+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `http://${h}${p}`;
}
