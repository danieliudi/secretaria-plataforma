import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { carregaDonoDaPlataforma } from "@/lib/admin-guard";
import AdminLista, { type CadastroAdmin, type FalhaEntrega, type UsoAdmin } from "./lista";
import { semDadoPessoal } from "@/lib/log-seguro";
import { custoUsd, PRECOS } from "@/lib/precos-modelo";

// Server Component: carrega tudo com a service role DEPOIS de confirmar que
// quem pediu é o dono da plataforma. O e-mail vem de auth.users (não existe em
// `tenants`), então precisa da API de admin do Supabase Auth.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const dono = await carregaDonoDaPlataforma();
  // 404 e não "acesso negado": pra quem não é dono, esta página não existe.
  if (!dono) notFound();

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id, slug, nome, cargo, frentes, channel_preference, auth_user_id, is_platform_owner, google_refresh_token_secret_id, whatsapp_authorized_number, telegram_authorized_chat_id, aprovado_em, recusado_em, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[admin] listagem falhou: ${semDadoPessoal(error.message)}`);
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-16">
        <h1 className="text-xl font-semibold text-foreground">Não conseguimos carregar a lista</h1>
        <p className="text-[13.5px] text-muted">Recarrega a página? Se persistir, o motivo está no log do servidor.</p>
      </main>
    );
  }

  const linhas = (data ?? []) as Array<Record<string, unknown>>;

  // O e-mail é o único dado que não mora em `tenants`. Uma chamada só,
  // casando por auth_user_id — evita N consultas numa lista que cresce.
  const emails = new Map<string, string>();
  try {
    const { data: usuarios } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of usuarios?.users ?? []) {
      if (u.email) emails.set(u.id, u.email);
    }
  } catch (err) {
    console.error(`[admin] listUsers falhou, seguindo sem e-mail: ${semDadoPessoal(err)}`);
  }

  const cadastros: CadastroAdmin[] = linhas.map((t) => ({
    slug: String(t.slug),
    nome: (t.nome as string | null) ?? "",
    cargo: (t.cargo as string | null) ?? "",
    frentes: ((t.frentes as string[] | null) ?? []).join(", "),
    email: emails.get(String(t.auth_user_id)) ?? "",
    canal: (t.channel_preference as string | null) ?? "",
    dono: Boolean(t.is_platform_owner),
    googleConectado: Boolean(t.google_refresh_token_secret_id),
    canalVinculado: Boolean(t.whatsapp_authorized_number) || Boolean(t.telegram_authorized_chat_id),
    aprovadoEm: (t.aprovado_em as string | null) ?? null,
    recusadoEm: (t.recusado_em as string | null) ?? null,
    criadoEm: String(t.created_at),
  }));

  // Entrega quebrada nas últimas 24h. A pergunta que isto responde é a que
  // ninguém estava fazendo: "tem alguém que a Mia não está conseguindo
  // alcançar?". Em 01/09/2026 a resposta era sim, havia dias, e a única pista
  // era log de cron — que ninguém abre.
  //
  // Só linhas que JÁ falharam ao menos uma vez e ainda não foram entregues:
  // `tentativas > 0` + `sent_at` nulo. É um conjunto naturalmente pequeno
  // (lembrete que entrega de primeira nunca entra), então dá pra agrupar aqui
  // sem repetir o problema de teto de linhas que o uso_por_tenant já teve.
  const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: falhasRows, error: falhasErro } = await admin
    .from("scheduled_reminders")
    .select("tenant_id, desistiu_em, ultimo_erro, fire_at, tentativas")
    .gt("tentativas", 0)
    .is("sent_at", null)
    .order("fire_at", { ascending: false })
    .limit(200);
  if (falhasErro) {
    console.error(`[admin] falhas de entrega: ${semDadoPessoal(falhasErro.message)}`);
  }

  type LinhaFalha = {
    tenant_id: string | null;
    desistiu_em: string | null;
    ultimo_erro: string | null;
    fire_at: string;
    tentativas: number;
  };
  const entregaPorTenant = new Map<string, FalhaEntrega>();
  for (const f of (falhasRows ?? []) as LinhaFalha[]) {
    // Desistência velha já é história: some da tela depois de 24h em vez de
    // virar um alerta permanente que ninguém consegue limpar.
    if (f.desistiu_em && f.desistiu_em < desde24h) continue;
    if (!f.tenant_id) continue;
    const atual = entregaPorTenant.get(f.tenant_id) ??
      { naoEntregues: 0, desistidos: 0, ultimaTentativaEm: f.fire_at, ultimoErro: null };
    atual.naoEntregues += 1;
    if (f.desistiu_em) atual.desistidos += 1;
    // As linhas vêm ordenadas por fire_at desc, então a PRIMEIRA de cada
    // tenant é a mais recente — é dela que sai o erro que a tela mostra.
    if (atual.ultimoErro === null) atual.ultimoErro = f.ultimo_erro;
    entregaPorTenant.set(f.tenant_id, atual);
  }
  for (const c of cadastros) {
    const id = linhas.find((t) => String(t.slug) === c.slug)?.id;
    const falha = id ? entregaPorTenant.get(String(id)) : undefined;
    if (falha) c.entrega = falha;
  }

  const nomeDono = linhas.find((t) => t.auth_user_id === dono.authUserId)?.nome as string | null;
  const primeiroNome = (nomeDono ?? "").trim().split(/\s+/)[0] ?? "";

  // Uso de TODOS os tenants no mês, já agregado no banco (uso_por_tenant).
  // Só contagem de chamada e tokens — nunca conteúdo de mensagem.
  //
  // A agregação é da FUNCTION, não daqui: antes esta página baixava uma linha
  // por chamada e somava em JS, o que carregava o teto silencioso de 1000
  // linhas do supabase-js — no mês em que o volume passasse disso, o número
  // ficaria menor que a realidade sem erro nenhum. Ver a migration.
  const inicioDoMes = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { data: usoRows, error: usoErro } = await admin.rpc("uso_por_tenant", { p_desde: inicioDoMes });
  if (usoErro) {
    console.error(`[admin] uso_por_tenant falhou: ${semDadoPessoal(usoErro.message)}`);
  }

  // Reuniões transcritas no mês. Fonte SEPARADA de uso_modelo de propósito:
  // transcrição é cobrada por hora de áudio, não por token, e forçar isso nas
  // colunas de token mentiria no significado. As duas somas se encontram aqui,
  // no painel — que é onde a pergunta "quanto esse usuário custou" é feita.
  const { data: reuniaoRows, error: reuniaoErro } = await admin.rpc("custo_reunioes_por_tenant", {
    p_desde: inicioDoMes,
  });
  if (reuniaoErro) {
    console.error(`[admin] custo_reunioes_por_tenant falhou: ${semDadoPessoal(reuniaoErro.message)}`);
  }

  type LinhaUso = {
    tenant_id: string | null;
    modelo: string;
    chamadas: number;
    conversas: number;
    proativos: number;
    classificador: number;
    tokens_entrada: number;
    tokens_cache_escrita: number;
    tokens_cache_leitura: number;
    tokens_saida: number;
  };
  const linhasUso = (usoRows ?? []) as LinhaUso[];

  // Nome/papel por tenant_id, pra dar rosto às linhas agregadas.
  const identidade = new Map<string, { nome: string; slug: string; dono: boolean }>();
  for (const t of linhas) {
    identidade.set(String(t.id ?? ""), {
      nome: (t.nome as string | null) ?? "",
      slug: String(t.slug),
      dono: Boolean(t.is_platform_owner),
    });
  }

  // Agrupa por tenant somando os modelos. `tenant_id` nulo é a linha da
  // PLATAFORMA: o classificador roda antes de o sistema saber de quem é a
  // mensagem, então esse custo não tem dono. Fica visível de propósito — é
  // ali que cai o gasto de quem manda mensagem sem estar cadastrado, e um
  // salto nessa linha é sinal de abuso do número compartilhado.
  const porTenant = new Map<string, UsoAdmin>();
  const custoPorModelo = new Map<string, number>();
  const modelosSemPreco = new Set<string>();

  for (const l of linhasUso) {
    const chave = l.tenant_id ?? "__plataforma__";
    const quem = l.tenant_id ? identidade.get(l.tenant_id) : undefined;
    const atual = porTenant.get(chave) ?? {
      slug: quem?.slug ?? "",
      nome: quem?.nome || (l.tenant_id ? "(cadastro removido)" : "Plataforma"),
      dono: quem?.dono ?? false,
      sistema: l.tenant_id === null,
      conversas: 0,
      proativos: 0,
      tokens: 0,
      reunioes: 0,
      usd: 0,
    };

    atual.conversas += l.conversas;
    atual.proativos += l.proativos;
    atual.tokens += l.tokens_entrada + l.tokens_cache_escrita + l.tokens_cache_leitura + l.tokens_saida;

    const usd = custoUsd(l.modelo, l);
    if (usd === null) modelosSemPreco.add(l.modelo);
    else {
      atual.usd += usd;
      const rotulo = PRECOS[l.modelo].rotulo;
      custoPorModelo.set(rotulo, (custoPorModelo.get(rotulo) ?? 0) + usd);
    }

    porTenant.set(chave, atual);
  }

  // Dobra o custo de reunião nas mesmas linhas. Um tenant que só gravou
  // reunião e nunca conversou não aparece em uso_modelo — por isso a linha é
  // CRIADA aqui quando não existe, em vez de só somada.
  type LinhaReuniao = { tenant_id: string | null; reunioes: number; custo_usd: number };
  let custoReunioes = 0;
  for (const l of (reuniaoRows ?? []) as LinhaReuniao[]) {
    const chave = l.tenant_id ?? "__plataforma__";
    const quem = l.tenant_id ? identidade.get(l.tenant_id) : undefined;
    const atual = porTenant.get(chave) ?? {
      slug: quem?.slug ?? "",
      nome: quem?.nome || (l.tenant_id ? "(cadastro removido)" : "Plataforma"),
      dono: quem?.dono ?? false,
      sistema: l.tenant_id === null,
      conversas: 0,
      proativos: 0,
      tokens: 0,
      reunioes: 0,
      usd: 0,
    };
    const usd = Number(l.custo_usd) || 0;
    atual.reunioes += Number(l.reunioes) || 0;
    atual.usd += usd;
    custoReunioes += usd;
    porTenant.set(chave, atual);
  }
  if (custoReunioes > 0) {
    custoPorModelo.set("Transcrição de reunião", custoReunioes);
  }

  const uso = [...porTenant.values()].sort((a, b) => b.usd - a.usd);
  const mensagensNoMes = uso.reduce((s, u) => s + u.conversas, 0);

  return (
    <AdminLista
      cadastros={cadastros}
      userLabel={primeiroNome}
      mensagensNoMes={mensagensNoMes}
      uso={uso}
      custoPorModelo={[...custoPorModelo.entries()]
        .map(([rotulo, usd]) => ({ rotulo, usd }))
        .sort((a, b) => b.usd - a.usd)}
      modelosSemPreco={[...modelosSemPreco]}
    />
  );
}
