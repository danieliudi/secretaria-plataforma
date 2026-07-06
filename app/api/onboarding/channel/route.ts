import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertTenantSecret } from "@/lib/tenant-provisioning";

const VALID_CHANNELS = new Set(["whatsapp", "telegram", "both"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { channel_preference?: unknown; telegram_bot_token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const channelPreference = typeof body.channel_preference === "string" ? body.channel_preference : "";
  if (!VALID_CHANNELS.has(channelPreference)) {
    return NextResponse.json({ error: `canal inválido: '${channelPreference}'` }, { status: 400 });
  }

  const wantsTelegram = channelPreference === "telegram" || channelPreference === "both";
  const telegramToken = wantsTelegram && typeof body.telegram_bot_token === "string"
    ? body.telegram_bot_token.trim()
    : "";

  const admin = createServiceClient();
  const { data: tenant, error: loadErr } = await admin
    .from("tenants")
    .select("id, telegram_bot_token_secret_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (loadErr || !tenant) {
    return NextResponse.json(
      { error: "tenant não encontrado — complete os passos anteriores primeiro" },
      { status: 404 },
    );
  }

  let telegramSecretId = tenant.telegram_bot_token_secret_id as string | null;
  try {
    if (telegramToken) {
      telegramSecretId = await upsertTenantSecret(admin, telegramSecretId, telegramToken, `telegram_bot_${tenant.id}`);
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const { error } = await admin
    .from("tenants")
    .update({
      channel_preference: channelPreference,
      telegram_bot_token_secret_id: telegramSecretId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
