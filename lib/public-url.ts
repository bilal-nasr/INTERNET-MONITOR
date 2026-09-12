/**
 * The address this deployment is reached at. APP_URL when the operator set
 * one, since that is the address they want in emails and scripts; otherwise
 * the address the request arrived on, honouring a reverse proxy's forwarded
 * headers. Two entry points because a Route Handler has a Request and a
 * Server Component has only next/headers.
 */
export function publicBaseUrlFromHeaders(
  get: (name: string) => string | null,
  fallbackOrigin = "http://localhost:3000",
): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const fallback = new URL(fallbackOrigin);
  const proto = get("x-forwarded-proto")?.split(",")[0].trim() || fallback.protocol.replace(":", "");
  const host = get("x-forwarded-host")?.split(",")[0].trim() || get("host") || fallback.host;
  return `${proto}://${host}`;
}

export function publicBaseUrl(request: Request): string {
  return publicBaseUrlFromHeaders((name) => request.headers.get(name), new URL(request.url).origin);
}
