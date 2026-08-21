// Validação do JWT que o Bot Framework Connector manda em toda chamada real
// pro webhook do bot (header Authorization: Bearer <token>) — é o
// equivalente, pro Teams, do secret_token do Telegram ou do HMAC do
// meta-webhook. SEM essa checagem, qualquer um que descubra a URL do
// endpoint pode forjar uma mensagem em nome de qualquer usuário.
//
// Valores abaixo (endpoint de metadata, issuer, algoritmos, nome da claim de
// serviceUrl) conferidos contra o código-fonte oficial do SDK
// (microsoft/botbuilder-js, authenticationConstants.ts e
// channelValidation.ts) em 18/08/2026 — não são um valor "de memória".
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const OPENID_METADATA_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";
const EXPECTED_ISSUER = "https://api.botframework.com";
const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512"];
// Mesma tolerância que o SDK oficial usa (ToBotFromChannelTokenValidationParameters).
const CLOCK_TOLERANCE_SECONDS = 5 * 60;

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

// Cache de módulo — reaproveitado entre invocações no mesmo isolate, mesmo
// padrão de fontesCache/wasmPronto em card.ts. `jose` já cacheia as chaves
// internamente por um tempo; isto só evita refazer o fetch do documento de
// metadata (que raramente muda) a cada chamada.
let jwksCache: RemoteJwks | null = null;

async function getJwks(): Promise<RemoteJwks> {
  if (jwksCache) return jwksCache;
  const res = await fetch(OPENID_METADATA_URL);
  if (!res.ok) throw new Error(`openid metadata do Bot Framework falhou: ${res.status}`);
  const meta = await res.json() as { jwks_uri?: string };
  if (!meta.jwks_uri) throw new Error("openid metadata do Bot Framework sem jwks_uri");
  jwksCache = createRemoteJWKSet(new URL(meta.jwks_uri));
  return jwksCache;
}

export interface ValidacaoTokenResultado {
  ok: boolean;
  /** Só presente quando ok=false — motivo pra log, nunca pra devolver ao remetente. */
  motivo?: string;
}

/**
 * Valida o Authorization: Bearer <token> de uma chamada de webhook do Teams.
 *
 * `serviceUrlDaActivity` é o campo `serviceUrl` do corpo da Activity recebida
 * — o SDK oficial confere que ele bate com a claim `serviceurl` do token,
 * exatamente pra impedir que um token válido (de OUTRA conversa/bot) seja
 * reaproveitado apontando o bot pra responder num serviceUrl diferente.
 */
export async function validarTokenBotFramework(
  authorizationHeader: string | null,
  serviceUrlDaActivity: string,
  appId: string,
): Promise<ValidacaoTokenResultado> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return { ok: false, motivo: "sem header Authorization Bearer" };
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, motivo: "token vazio" };

  try {
    const jwks = await getJwks();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: EXPECTED_ISSUER,
      audience: appId,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });

    const serviceUrlClaim = payload["serviceurl"];
    if (typeof serviceUrlClaim !== "string" || serviceUrlClaim !== serviceUrlDaActivity) {
      return { ok: false, motivo: "claim serviceurl do token não bate com a Activity" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}
