// Provisionamento da linha de tenant no primeiro login. Único lugar que CRIA
// uma linha em `tenants` — o resto do app (onboarding, API routes) só lê/
// atualiza uma linha que já existe, casada pelo auth_user_id verificado.
import type { SupabaseClient } from "@supabase/supabase-js";

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/@.*/, "") // email → só a parte antes do @
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "tenant";
}

/** Gera um slug único (sufixo numérico se já existir). */
async function uniqueSlugFor(admin: SupabaseClient, seed: string): Promise<string> {
  const base = slugify(seed);
  let candidate = base;
  for (let i = 1; i < 100; i++) {
    const { data, error } = await admin
      .from("tenants")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw new Error(`checagem de slug falhou: ${error.message}`);
    if (!data) return candidate;
    candidate = `${base}-${i + 1}`;
  }
  throw new Error(`não foi possível gerar slug único a partir de '${seed}'`);
}

export interface EnsureTenantResult {
  id: string;
  slug: string;
}

/**
 * Garante que existe uma linha em `tenants` pro auth_user_id. Idempotente —
 * chamado a cada login (não só o primeiro); se já existe, só devolve.
 */
export async function ensureTenantForUser(
  admin: SupabaseClient,
  userId: string,
  seedName: string,
): Promise<EnsureTenantResult> {
  const { data: existing, error: loadErr } = await admin
    .from("tenants")
    .select("id, slug")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (loadErr) throw new Error(`tenants lookup falhou: ${loadErr.message}`);
  if (existing) return existing as EnsureTenantResult;

  const slug = await uniqueSlugFor(admin, seedName || userId);
  const { data: created, error: createErr } = await admin
    .from("tenants")
    .insert({ auth_user_id: userId, slug, nome: seedName || "" })
    .select("id, slug")
    .single();
  if (createErr) throw new Error(`tenants insert falhou: ${createErr.message}`);
  return created as EnsureTenantResult;
}

/** Grava (cria ou atualiza) um segredo do tenant no Vault via as RPCs de tenant_secret_*. */
export async function upsertTenantSecret(
  admin: SupabaseClient,
  existingSecretId: string | null,
  secret: string,
  name: string,
): Promise<string> {
  if (existingSecretId) {
    const { error } = await admin.rpc("tenant_secret_update", {
      p_id: existingSecretId,
      p_secret: secret,
    });
    if (error) throw new Error(`tenant_secret_update falhou: ${error.message}`);
    return existingSecretId;
  }
  const { data, error } = await admin.rpc("tenant_secret_create", {
    p_secret: secret,
    p_name: name,
  });
  if (error) throw new Error(`tenant_secret_create falhou: ${error.message}`);
  return data as string;
}
