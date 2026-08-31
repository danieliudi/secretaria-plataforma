// CRUD da memória editável (instruções).
//
// Toda rota resolve o tenant pela SESSÃO e filtra por `tenant_id` em cima do
// id — `instrucoes` tem RLS sem policy nenhuma (só service role), mesmo padrão
// de reunioes/despesas. Sem o filtro por tenant, quem descobrisse o uuid de uma
// instrução de outra conta poderia editar o que aquela secretária obedece.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { semDadoPessoal } from "@/lib/log-seguro";
import {
  MAX_INSTRUCOES,
  MAX_NOME,
  MAX_QUANDO_USAR,
  MAX_TEXTO,
  slugDoNome,
} from "@/lib/instrucoes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sessão → tenant aprovado. Null quando não pode mexer em nada. */
async function tenantDaSessao(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createServiceClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, aprovado_em, recusado_em, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  // Portão de acesso no BACKEND, não só na tela: conta não aprovada não escreve
  // na memória da secretária.
  if (!tenant || !tenant.aprovado_em || tenant.recusado_em || tenant.active === false) {
    return null;
  }
  return { id: tenant.id as string };
}

/** Campo de texto vindo do browser: string, aparado, com teto. */
function campo(bruto: unknown, max: number): string {
  return typeof bruto === "string" ? bruto.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const tenant = await tenantDaSessao();
  if (!tenant) return NextResponse.json({ error: "sem acesso" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nome = campo(body.nome, MAX_NOME);
  if (!nome) return NextResponse.json({ error: "Dê um nome pra instrução." }, { status: 400 });

  const slug = slugDoNome(nome);
  if (!slug) {
    return NextResponse.json(
      { error: "Esse nome não gera um identificador — use letras ou números." },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // Teto por conta: o índice inteiro entra no prompt de toda conversa, então
  // não pode crescer sem limite. Acima disso o caminho é busca semântica, não
  // um teto maior.
  const { count, error: contErr } = await admin
    .from("instrucoes")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id);
  if (contErr) {
    return NextResponse.json({ error: semDadoPessoal(contErr.message) }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_INSTRUCOES) {
    return NextResponse.json(
      { error: `Você chegou no limite de ${MAX_INSTRUCOES} instruções. Apague ou junte alguma antes de criar outra.` },
      { status: 409 },
    );
  }

  const { data, error } = await admin
    .from("instrucoes")
    .insert({
      tenant_id: tenant.id,
      slug,
      nome,
      quando_usar: campo(body.quando_usar, MAX_QUANDO_USAR),
      texto: campo(body.texto, MAX_TEXTO),
      origem: "escrita",
      // Nasce desligada mesmo quando quem cria é o usuário: ele revisa o texto
      // e liga no mesmo fluxo, e assim não existe caminho nenhum que ative uma
      // instrução sem alguém ter olhado pra ela ativa.
      ativo: false,
    })
    .select("id, slug")
    .maybeSingle();

  if (error) {
    // 23505 = unique(tenant_id, slug). Dois nomes diferentes podem gerar o
    // mesmo slug ("Como eu escrevo!" e "como eu escrevo"), e o erro cru não
    // diria isso pra ninguém.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Você já tem uma instrução com esse nome." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: semDadoPessoal(error.message) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id, slug: data?.slug ?? slug });
}

export async function PATCH(request: Request) {
  const tenant = await tenantDaSessao();
  if (!tenant) return NextResponse.json({ error: "sem acesso" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.nome !== undefined) {
    const nome = campo(body.nome, MAX_NOME);
    if (!nome) return NextResponse.json({ error: "O nome não pode ficar vazio." }, { status: 400 });
    patch.nome = nome;
    // `slug` NÃO muda ao renomear: ele é como o modelo pede a instrução, e uma
    // que ela já aprendeu a abrir tem que continuar abrindo depois de um
    // ajuste de título.
  }
  if (body.quando_usar !== undefined) patch.quando_usar = campo(body.quando_usar, MAX_QUANDO_USAR);
  if (body.texto !== undefined) patch.texto = campo(body.texto, MAX_TEXTO);
  if (body.ativo !== undefined) patch.ativo = body.ativo === true;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nada pra mudar" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("instrucoes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .select("slug, ativo")
    .maybeSingle();

  if (error) {
    // O CHECK `instrucao_ativa_completa` barra ativar sem gatilho ou sem texto.
    // Traduzir aqui evita mostrar erro de constraint pra quem só clicou num
    // botão.
    if (error.message.includes("instrucao_ativa_completa")) {
      return NextResponse.json(
        { error: "Pra ativar, preencha o “quando usar” e o texto." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: semDadoPessoal(error.message) }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "instrução não encontrada" }, { status: 404 });

  return NextResponse.json({ ok: true, slug: data.slug, ativo: data.ativo });
}

export async function DELETE(request: Request) {
  const tenant = await tenantDaSessao();
  if (!tenant) return NextResponse.json({ error: "sem acesso" }, { status: 401 });

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const admin = createServiceClient();
  const { error } = await admin
    .from("instrucoes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenant.id);
  if (error) {
    return NextResponse.json({ error: semDadoPessoal(error.message) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
