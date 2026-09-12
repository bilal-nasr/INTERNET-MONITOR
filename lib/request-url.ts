/**
 * The address this deployment is reached on, for links that leave the app:
 * a password reset mail, a share link shown on the settings page.
 *
 * APP_URL wins when the operator set one, since that is the address they want
 * in front of people; otherwise the address the request arrived on, honouring
 * a reverse proxy's forwarded headers. Never a trailing slash.
 */
export function publicBaseUrl(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}
