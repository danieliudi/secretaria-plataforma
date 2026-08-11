// Aprovar / recusar um cadastro. Só o dono da plataforma.
//
// O efeito real deste endpoint está no backend das edge functions: sem
// `aprovado_em`, getTenantByAuthorizedPhone e consumeWhatsAppLinkCode recusam
// a mensagem e o Telegram nem resolve o tenant. Aqui só se escreve a coluna.
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { carregaDonoDaPlataforma } from "@/lib/admin-guard";

const ACOES = new Set(["aprovar", "recusar", "reverter"]);

export async function POST(request: Request) {
  const dono = await carregaDonoDaPlataforma();
  if (!dono) {
    // 404, não 403: pra quem não é dono, este endpoint não existe.
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }

  let body: { slug?: unknown; acao?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const acao = typeof body.acao === "string" ? body.acao : "";
  // Mesmo formato que slugify() gera em lib/tenant-provisioning.ts. A consulta
  // é parametrizada (sem risco de injeção), mas entrada de fora se valida por
  // formato, não por confiança em quem chama.
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return NextResponse.json({ error: "slug inválido" }, { status: 400 });
  }
  if (!ACOES.has(acao)) {
    return NextResponse.json({ error: `ação inválida: '${acao}'` }, { status: 400 });
  }

  const agora = new Date().toISOString();
  // Aprovar limpa a recusa e vice-versa: as duas colunas juntas seriam um
  // estado sem significado, e o backend só olha `aprovado_em`.
  const patch = acao === "aprovar"
    ? { aprovado_em: agora, recusado_em: null }
    : acao === "recusar"
    ? { aprovado_em: null, recusado_em: agora }
    : { aprovado_em: null, recusado_em: null };

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("tenants")
    .update({ ...patch, updated_at: agora })
    // O dono nunca pode se recusar sozinho — perderia o acesso ao próprio
    // /admin e à própria secretária, sem caminho de volta pela tela.
    .eq("slug", slug)
    .eq("is_platform_owner", false)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error(`[admin] ${acao} falhou: ${error.message}`);
    return NextResponse.json({ error: "não foi possível salvar" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "cadastro não encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, slug: data.slug, acao });
}
