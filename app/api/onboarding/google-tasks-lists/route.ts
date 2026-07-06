// Busca as listas reais do Google Tasks do tenant, pra ele escolher pelo nome
// em vez de precisar achar o ID sozinho (o Google não expõe isso na tela pra
// quem não é programador).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readTenantSecret } from "@/lib/tenant-provisioning";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: tenant, error: loadErr } = await admin
    .from("tenants")
    .select("google_refresh_token_secret_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (loadErr || !tenant?.google_refresh_token_secret_id) {
    return NextResponse.json({ error: "Google ainda não conectado" }, { status: 400 });
  }

  try {
    const refreshToken = await readTenantSecret(admin, tenant.google_refresh_token_secret_id);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return NextResponse.json({ error: `Google recusou o token: ${tokenData.error ?? tokenRes.status}` }, { status: 502 });
    }

    const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const listsData = await listsRes.json();
    if (!listsRes.ok) {
      return NextResponse.json({ error: `Google Tasks recusou a busca: ${listsRes.status}` }, { status: 502 });
    }

    const lists = (listsData.items ?? []).map((l: { id: string; title: string }) => ({ id: l.id, name: l.title, path: l.title }));
    return NextResponse.json({ lists });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
