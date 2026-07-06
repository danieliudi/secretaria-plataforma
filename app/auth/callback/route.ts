// Callback do OAuth do Google (via Supabase Auth). Troca o `code` pela
// sessão, garante a linha do tenant (auth_user_id) e — se veio um
// provider_refresh_token do Google (só vem no login que pediu
// access_type=offline) — grava no Vault e liga em
// tenants.google_refresh_token_secret_id.
//
// IMPORTANTE: o app Google OAuth usado aqui (configurado no Supabase Auth →
// Providers → Google) precisa ser o MESMO client_id/client_secret já usado
// pelas edge functions (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET) — um refresh
// token só é válido pra trocar por access_token sob o client que o emitiu.
// Ver README.md.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureTenantForUser, upsertTenantSecret } from "@/lib/tenant-provisioning";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("[auth/callback] exchangeCodeForSession falhou:", error?.message);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const { user, provider_refresh_token } = data.session;
  const admin = createServiceClient();

  try {
    const seedName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";
    const tenant = await ensureTenantForUser(admin, user.id, seedName);

    if (provider_refresh_token) {
      const { data: row } = await admin
        .from("tenants")
        .select("google_refresh_token_secret_id")
        .eq("id", tenant.id)
        .single();
      const secretId = await upsertTenantSecret(
        admin,
        row?.google_refresh_token_secret_id ?? null,
        provider_refresh_token,
        `google_refresh_${tenant.id}`,
      );
      await admin
        .from("tenants")
        .update({ google_refresh_token_secret_id: secretId, updated_at: new Date().toISOString() })
        .eq("id", tenant.id);
    }
  } catch (err) {
    // Login já aconteceu (sessão válida) — não bloqueia o usuário por causa
    // de um erro no provisionamento; ele cai no onboarding e pode tentar de
    // novo (ex: reconectar Google) por lá.
    console.error("[auth/callback] provisionamento do tenant falhou:", String(err));
  }

  return NextResponse.redirect(`${origin}/onboarding`);
}
