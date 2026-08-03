import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Mesmo alfabeto/tamanho do gerador em secretaria-agentic (_shared/tenant.ts
// createWhatsAppLinkCode) — os dois precisam concordar no formato do código,
// mas cada repo gera o seu: este aqui MOSTRA o código (onboarding), o outro
// CONSOME (mensagem chegando no número compartilhado). Sem 0/O/1/I pra não
// confundir ao ler/digitar.
const LINK_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LINK_CODE_LENGTH = 6;
const LINK_CODE_TTL_MIN = 30;

function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += LINK_CODE_ALPHABET[Math.floor(Math.random() * LINK_CODE_ALPHABET.length)];
  }
  return code;
}

type TenantLinkRow = {
  id: string;
  whatsapp_authorized_number: string | null;
  whatsapp_link_code: string | null;
  whatsapp_link_code_expires_at: string | null;
};

/**
 * Gera (ou reaproveita, se ainda válido) o código de vínculo do WhatsApp e
 * devolve o estado atual — usado tanto pra "gerar código" (primeira vez no
 * passo 3) quanto pra "verificar se já vinculou" (botão no wizard). NUNCA
 * roda de novo o gerador se já existe um código pendente ainda não vencido:
 * isso invalidaria, sem querer, o código que a pessoa está prestes a mandar
 * pelo WhatsApp.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: tenant, error: loadErr } = await admin
    .from("tenants")
    .select("id, whatsapp_authorized_number, whatsapp_link_code, whatsapp_link_code_expires_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (loadErr || !tenant) {
    return NextResponse.json(
      { error: "tenant não encontrado — complete os passos anteriores primeiro" },
      { status: 404 },
    );
  }

  const row = tenant as TenantLinkRow;
  if (row.whatsapp_authorized_number) {
    return NextResponse.json({ linked: true });
  }

  const now = Date.now();
  const hasValidPendingCode =
    row.whatsapp_link_code &&
    row.whatsapp_link_code_expires_at &&
    new Date(row.whatsapp_link_code_expires_at).getTime() > now;

  let code = row.whatsapp_link_code;
  let expiresAt = row.whatsapp_link_code_expires_at;

  if (!hasValidPendingCode) {
    code = generateLinkCode();
    expiresAt = new Date(now + LINK_CODE_TTL_MIN * 60_000).toISOString();
    const { error: updateErr } = await admin
      .from("tenants")
      .update({ whatsapp_link_code: code, whatsapp_link_code_expires_at: expiresAt })
      .eq("id", row.id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  // Sem PLATFORM_WHATSAPP_NUMBER (número compartilhado ainda não provisionado),
  // o wizard cai pro aviso de configuração manual — o código já fica salvo e
  // pronto, então nada precisa mudar aqui quando o número existir.
  const platformNumber = process.env.PLATFORM_WHATSAPP_NUMBER || null;

  return NextResponse.json({ linked: false, code, expiresAt, platformNumber });
}
