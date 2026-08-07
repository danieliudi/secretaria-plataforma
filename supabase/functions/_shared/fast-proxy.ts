import type { Decision, ReflexResult } from "./types.ts";

const FAST_TIMEOUT_MS = 25_000;
const FALLBACK_MESSAGE =
  "Tive um problema técnico — tenta de novo daqui a pouco.";

export interface FastCallParams {
  text: string;
  decision: Decision;
  /** Identificador do remetente (e.g., remoteJid do WhatsApp). Opcional. */
  from?: string;
  /** Timeout em ms. Default FAST_TIMEOUT_MS. Entrega async usa valor maior. */
  timeoutMs?: number;
  /** Slug do tenant (já resolvido pelo webhook) — /fast usa pra carregar as credenciais certas nas tools. */
  tenantSlug?: string;
}

export interface FastProxyDeps {
  fetch: typeof fetch;
  env: (key: string) => string | undefined;
}

export function defaultFastProxyDeps(): FastProxyDeps {
  return {
    fetch,
    env: (k) => Deno.env.get(k),
  };
}

export async function callFastEndpoint(
  params: FastCallParams,
  deps: FastProxyDeps = defaultFastProxyDeps(),
): Promise<ReflexResult> {
  const url = deps.env("SUPABASE_URL");
  const apikey = deps.env("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) throw new Error("SUPABASE_URL not set");
  if (!apikey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

  const target = `${url}/functions/v1/fast`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? FAST_TIMEOUT_MS,
  );

  try {
    const res = await deps.fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apikey,
        "Authorization": `Bearer ${apikey}`,
      },
      body: JSON.stringify({
        text: params.text,
        decision: params.decision,
        from: params.from,
        tenant_slug: params.tenantSlug,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[fast-proxy] /fast retornou ${res.status}: ${body.slice(0, 200)}`,
      );
      return { ok: false, message: FALLBACK_MESSAGE };
    }

    return (await res.json()) as ReflexResult;
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) {
      console.error(`[fast-proxy] /fast timeout`);
    } else {
      console.error(`[fast-proxy] /fast erro: ${err}`);
    }
    return { ok: false, message: FALLBACK_MESSAGE };
  }
}
