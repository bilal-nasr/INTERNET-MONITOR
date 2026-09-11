import http from "node:http";
import https from "node:https";

export interface WanCounters {
  name: string;
  txBytes: number;
  rxBytes: number;
  running: boolean;
  disabled: boolean;
}

export interface RouterConfig {
  host: string;
  user: string;
  pass: string;
  wanInterfaceName: string;
}

interface RouterOsInterface {
  name?: string;
  "tx-byte"?: string;
  "rx-byte"?: string;
  running?: string;
  disabled?: string;
  [key: string]: string | undefined;
}

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}

/**
 * Minimal GET-JSON helper on top of node:http(s). Used instead of fetch() so
 * ROUTER_TLS_INSECURE can accept RouterOS's default self-signed certificate
 * without touching global TLS settings.
 */
function getJson(
  url: URL,
  opts: { auth: string; insecureTls: boolean; timeoutMs: number },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        auth: opts.auth,
        headers: { Accept: "application/json" },
        timeout: opts.timeoutMs,
        ...(isHttps ? { rejectUnauthorized: !opts.insecureTls } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status === 401) {
            reject(new RouterError("Router rejected the credentials (HTTP 401)"));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new RouterError(`Router responded with HTTP ${status}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new RouterError("Router returned a non-JSON response. Is the REST API enabled?"));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new RouterError(`Router did not respond within ${opts.timeoutMs} ms`));
    });
    req.on("error", (err) => {
      reject(err instanceof RouterError ? err : new RouterError(`Router request failed: ${err.message}`));
    });
    req.end();
  });
}

export async function fetchWanCounters(cfg: RouterConfig, timeoutMs = 15_000): Promise<WanCounters> {
  let url: URL;
  try {
    const base = cfg.host.replace(/\/+$/, "");
    url = new URL(`${base}/rest/interface`);
  } catch {
    throw new RouterError(`Invalid router host: ${cfg.host}`);
  }

  const data = await getJson(url, {
    auth: `${cfg.user}:${cfg.pass}`,
    insecureTls: process.env.ROUTER_TLS_INSECURE === "true",
    timeoutMs,
  });

  if (!Array.isArray(data)) {
    throw new RouterError("Unexpected response from /rest/interface (expected an array)");
  }
  const interfaces = data as RouterOsInterface[];
  const iface = interfaces.find((i) => i.name === cfg.wanInterfaceName);
  if (!iface) {
    const names = interfaces.map((i) => i.name).filter(Boolean).join(", ");
    throw new RouterError(`Interface "${cfg.wanInterfaceName}" not found. Available: ${names}`);
  }

  const txBytes = Number(iface["tx-byte"]);
  const rxBytes = Number(iface["rx-byte"]);
  if (!Number.isFinite(txBytes) || !Number.isFinite(rxBytes)) {
    throw new RouterError(`Interface "${cfg.wanInterfaceName}" has no tx-byte/rx-byte counters`);
  }

  return {
    name: iface.name ?? cfg.wanInterfaceName,
    txBytes,
    rxBytes,
    running: iface.running === "true",
    disabled: iface.disabled === "true",
  };
}
