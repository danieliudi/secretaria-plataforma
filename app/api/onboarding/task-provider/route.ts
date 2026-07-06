import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertTenantSecret } from "@/lib/tenant-provisioning";

const VALID_PROVIDERS = new Set(["clickup", "notion", "trello", "google_tasks"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { provider?: unknown; token?: unknown; list_map?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `provider inválido: '${provider}'` }, { status: 400 });
  }

  let listMap: Record<string, unknown> = {};
  if (typeof body.list_map === "string" && body.list_map.trim()) {
    try {
      listMap = JSON.parse(body.list_map);
    } catch {
      return NextResponse.json({ error: "list_map não é JSON válido" }, { status: 400 });
    }
  }

  const token = provider === "google_tasks" ? "" : (typeof body.token === "string" ? body.token.trim() : "");
  if (provider !== "google_tasks" && !token) {
    return NextResponse.json({ error: "token é obrigatório pra essa plataforma" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: tenant, error: loadErr } = await admin
    .from("tenants")
    .select("id, task_provider_token_secret_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (loadErr || !tenant) {
    return NextResponse.json(
      { error: "tenant não encontrado — complete o passo de persona primeiro" },
      { status: 404 },
    );
  }

  let secretId = tenant.task_provider_token_secret_id as string | null;
  try {
    if (token) {
      secretId = await upsertTenantSecret(admin, secretId, token, `task_provider_${tenant.id}`);
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const { error } = await admin
    .from("tenants")
    .update({
      task_provider: provider,
      task_provider_list_map: listMap,
      task_provider_token_secret_id: secretId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
