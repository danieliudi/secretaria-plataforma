// Suíte de COMPORTAMENTO da secretária — roda contra o modelo de verdade.
//
// Por que existe: o system prompt (~17k tokens) é o que segura tudo que a Mia
// NÃO pode fazer — gravar despesa sem confirmar, prometer prazo, inventar
// event_id, anunciar o conteúdo de um arquivo que ela acabou de mandar. Nada
// disso tem teste. Cortar uma linha do prompt não quebra build, não quebra
// lint, não quebra os testes unitários: só faz ela agir diferente, semanas
// depois, sem ninguém receber erro.
//
// Isto é a rede pra poder mexer no prompt (enxugar duplicação, tirar tool) sem
// apostar. Cada caso descreve UM comportamento que o prompt promete hoje.
//
// ── COMO RODAR ──────────────────────────────────────────────────────────────
//   ANTHROPIC_API_KEY=... deno test --allow-net --allow-env \
//     supabase/functions/_tests/comportamento.test.ts
//
// Sem ANTHROPIC_API_KEY todos os casos são PULADOS (não falham) — é o que
// deixa `deno test` no resto da pasta continuar rodando offline.
//
// ── CUSTO ───────────────────────────────────────────────────────────────────
// Uma rodada completa fica em torno de US$ 0,20. O prefixo é o mesmo em todos
// os casos, então o primeiro paga escrita de cache e os outros leem a 0,1x —
// desde que rodem dentro de 5 min um do outro (é o caso: a suíte leva ~1 min).
//
// ── FLAKINESS ───────────────────────────────────────────────────────────────
// Roda na MESMA temperatura da produção (default do SDK), de propósito: testar
// a temperatura 0 mediria uma distribuição que o usuário nunca vê. Por isso as
// asserções são de COMPORTAMENTO (qual tool ela escolheu, qual ela NÃO chamou)
// e não de redação. Onde precisa olhar texto, o teste procura a AUSÊNCIA do que
// é proibido, nunca a presença de uma frase exata.
// Uma falha isolada merece uma segunda rodada antes de virar conclusão; duas
// falhas seguidas no mesmo caso é regressão de verdade.
//
// ── RUÍDO ESPERADO NA SAÍDA ─────────────────────────────────────────────────
// A suíte usa o `createMessage` de PRODUÇÃO de propósito (é o que carrega o
// cache_control real). Ele chama `registraUso`, que sem SUPABASE_URL falha e
// loga `[uso] falha ao registrar uso de modelo`. É esperado e inofensivo — a
// própria função já trata o erro; medir custo não é o assunto aqui.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// MIA_TEST_MODE precisa estar setado ANTES do módulo carregar, senão o import
// sobe um servidor HTTP (ver o rodapé de fast/index.ts). Import dinâmico é o
// que garante essa ordem — `import` estático seria içado pro topo.
Deno.env.set("MIA_TEST_MODE", "1");
const { defaultFastWithToolsDeps, handleFastWithTools } = await import("../fast/index.ts");

const TEM_CHAVE = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
if (!TEM_CHAVE) {
  console.warn("[comportamento] ANTHROPIC_API_KEY ausente — todos os casos serão pulados.");
}

// ─── Harness ─────────────────────────────────────────────────────────────────

interface Chamada {
  nome: string;
  args: unknown[];
}

/** Env de tenant comum: sem GA4, sem CRM Sanwey, tarefas no Google Tasks. */
const ENV_COMUM: Record<string, string> = {
  TASK_PROVIDER: "google_tasks",
  GOOGLE_TASKS_LIST_MAP: JSON.stringify({ "frente-x": "lista-x" }),
  FRENTES: "frente-x",
  GOOGLE_EMAIL: "chefe@exemplo.com",
};

/** Env do dono da plataforma: GA4 e CRM ligados. */
const ENV_DONO: Record<string, string> = {
  ...ENV_COMUM,
  GA4_PROPERTY_MAP: JSON.stringify({ "frente-x": "properties/1" }),
  SANWEY_CRM_SUPABASE_URL: "https://exemplo.invalid",
  SANWEY_CRM_SERVICE_ROLE_KEY: "nao-usada-o-cliente-e-stub",
};

const PERSONA = {
  nome: "Fulano de Tal",
  cargo: "CEO",
  frentes: ["frente-x"],
  persona: {},
};

interface Resultado {
  texto: string;
  chamadas: Chamada[];
  /** usage de cada chamada ao modelo, na ordem. */
  uso: { cache_creation_input_tokens?: number; cache_read_input_tokens?: number }[];
}

interface Opcoes {
  /** Turnos anteriores da conversa, pra montar o contexto do caso. */
  historico?: { role: "user" | "assistant"; content: string }[];
  /** ENV_COMUM (default) ou ENV_DONO. */
  env?: Record<string, string>;
  /** Índice de instruções editáveis do tenant (nome + quando usar). Default: vazio. */
  instrucoes?: { slug: string; nome: string; quando_usar: string }[];
}

async function conversa(mensagem: string, opcoes: Opcoes = {}): Promise<Resultado> {
  const chamadas: Chamada[] = [];
  const uso: Resultado["uso"] = [];
  const mapa = opcoes.env ?? ENV_COMUM;

  // Grava a chamada e devolve um resultado plausível. O que está sob teste é a
  // ESCOLHA da tool e o que ela fala depois — não o retorno da integração.
  const reg = (nome: string, retorno: unknown) => (...args: unknown[]) => {
    chamadas.push({ nome, args });
    return Promise.resolve(retorno);
  };

  const evento = {
    id: "evt_123",
    summary: "Alinhamento Acme",
    start: "2026-09-01T10:00:00-03:00",
    end: "2026-09-01T11:00:00-03:00",
  };

  // Deps REAIS (system prompt real, TOOLS reais, createMessage real com o
  // cache_control de produção) — só as implementações das tools viram stub.
  const base = defaultFastWithToolsDeps((k) => mapa[k], PERSONA, null, "whatsapp");

  const deps = {
    ...base,
    createMessage: async (p: Parameters<typeof base.createMessage>[0]) => {
      const r = await base.createMessage(p);
      uso.push((r as unknown as { usage?: Resultado["uso"][number] }).usage ?? {});
      return r;
    },
    tools: {
      getNextEvents: reg("getNextEvents", [evento]),
      getEventsByDate: reg("getEventsByDate", [evento]),
      createEvent: reg("createEvent", { ...evento, id: "evt_novo" }),
      deleteEvent: reg("deleteEvent", { removido: true, titulo: "Alinhamento Acme" }),
      updateEvent: reg("updateEvent", evento),
      saveQuickCapture: reg("saveQuickCapture", { id: "qc_1" }),
      archiveQuickCaptures: reg("archiveQuickCaptures", { arquivadas: 0 }),
      listRecentEmails: reg("listRecentEmails", []),
      listTasks: reg("listTasks", []),
      createTask: reg("createTask", { id: "t_1", title: "nova" }),
      saveProfileFact: reg("saveProfileFact", { id: "pf_1" }),
      buscarNoHistorico: reg("buscarNoHistorico", { trechos: [] }),
      scheduleReminder: reg("scheduleReminder", { id: "r_1" }),
      exportSpreadsheet: reg("exportSpreadsheet", { enviado: true }),
      gerarDocumento: reg("gerarDocumento", { enviado: true }),
      registrarDespesa: reg("registrarDespesa", { id: "d_1", total_mes: 400 }),
      listarDespesas: reg("listarDespesas", { despesas: [], total: 0 }),
      fecharMesDespesas: reg("fecharMesDespesas", { fechado: true }),
      getGa4Metrics: reg("getGa4Metrics", { sessions: 0 }),
      listCrmLeads: reg("listCrmLeads", []),
      listMarketingCampaigns: reg("listMarketingCampaigns", []),
      listMarketingDeliverables: reg("listMarketingDeliverables", []),
      listSupplierQuotes: reg("listSupplierQuotes", []),
      completeTask: reg("completeTask", { concluida: true }),
      pickNextActions: reg("pickNextActions", [
        { titulo: "Revisar o contrato", motivo: "vence hoje" },
        { titulo: "Responder o fornecedor", motivo: "parado há 3 dias" },
        { titulo: "Fechar o reembolso", motivo: "mês virou" },
      ]),
      montarLinkWhatsapp: reg("montarLinkWhatsapp", { link: "https://wa.me/000" }),
      consultarImportacao: reg("consultarImportacao", { encontrou: false }),
      ignorarRelacionamento: reg("ignorarRelacionamento", { ok: true }),
      reportarFeedback: reg("reportarFeedback", { id: "fb_1" }),
      // Chegaram no main em 31/08 (lote, instruções editáveis, remarcar tarefa).
      // Sem stub, o caso em que a Mia escolhe uma delas estoura com
      // "não é função" em vez de falhar dizendo o que ela fez.
      criarLote: reg("criarLote", { criadas: 0 }),
      abrirInstrucao: reg("abrirInstrucao", null),
      proporInstrucao: reg("proporInstrucao", { slug: "proposta-1" }),
      rescheduleTask: reg("rescheduleTask", { remarcada: true }),
      // O objeto inteiro é stub: os tipos de retorno de cada integração não
      // acrescentam nada ao que está sob teste, e escrevê-los por extenso
      // faria a suíte quebrar a cada campo novo numa integração.
    } as unknown as typeof base.tools,
    loadHistory: () => Promise.resolve(opcoes.historico ?? []),
    saveTurn: () => Promise.resolve(),
    loadProfile: () => Promise.resolve([]),
    // Sem este stub o spread de `base` traz a implementação real, que vai no
    // Supabase — inexistente aqui — e derruba todo caso antes do modelo.
    loadInstrucoes: () => Promise.resolve(opcoes.instrucoes ?? []),
  };

  const r = await handleFastWithTools(
    mensagem,
    { tier: "fast", frente: "pessoal", domain: "outro", action_required: false, irreversible: false, confidence: 0.9 },
    deps,
    "5511999999999",
  );
  return { texto: r.message ?? "", chamadas, uso };
}

const chamou = (r: Resultado, nome: string) => r.chamadas.some((c) => c.nome === nome);
const argsDe = (r: Resultado, nome: string) =>
  r.chamadas.find((c) => c.nome === nome)?.args[0] as Record<string, unknown> | undefined;

function caso(nome: string, fn: () => Promise<void>) {
  Deno.test({ name: nome, ignore: !TEM_CHAVE, fn });
}

// ─── Despesa: confirmar antes de gravar ──────────────────────────────────────

caso("despesa: NÃO grava na primeira leitura do recibo", async () => {
  const r = await conversa(
    "[foto de recibo] Estacionamento FISPAL — R$ 400,00 — 15/06/2026",
  );
  assert(
    !chamou(r, "registrarDespesa"),
    `gravou despesa sem confirmar. Tools: ${r.chamadas.map((c) => c.nome).join(", ")}`,
  );
});

caso("despesa: grava depois do ok, com a data DO RECIBO", async () => {
  const r = await conversa("isso, pode registrar", {
    historico: [
      { role: "user", content: "[foto de recibo] Estacionamento FISPAL — R$ 400,00 — 15/06/2026" },
      { role: "assistant", content: "Li: R$ 400,00 — Estacionamento FISPAL, 15/06. 📌 Feiras/eventos, certo?" },
    ],
  });
  assert(chamou(r, "registrarDespesa"), "não gravou mesmo depois do ok explícito");
  const args = argsDe(r, "registrarDespesa");
  assert(
    JSON.stringify(args).includes("06-15") || JSON.stringify(args).includes("15/06"),
    `usou a data errada (era pra ser a do recibo, 15/06): ${JSON.stringify(args)}`,
  );
});

// ─── Distinguir lembrete / evento / nota ─────────────────────────────────────

caso("lembrete com horário vira scheduleReminder, não evento", async () => {
  const r = await conversa("me lembra de ligar pro João amanhã às 14h");
  assert(chamou(r, "scheduleReminder"), "não agendou lembrete");
  assert(!chamou(r, "createEvent"), "criou evento na agenda em vez de lembrete");
});

caso("compromisso vira createEvent, não lembrete", async () => {
  const r = await conversa("marca almoço com o João amanhã 12h");
  assert(chamou(r, "createEvent"), "não criou o evento");
  assert(!chamou(r, "scheduleReminder"), "virou lembrete em vez de evento na agenda");
});

caso("anotação sem horário vira saveQuickCapture", async () => {
  const r = await conversa("anota que o fornecedor novo cobra 12% a mais");
  assert(chamou(r, "saveQuickCapture"), `não anotou. Tools: ${r.chamadas.map((c) => c.nome).join(", ")}`);
  assert(!chamou(r, "scheduleReminder") && !chamou(r, "createEvent"), "inventou horário pra uma nota");
});

caso("'já fiz X' vira completeTask", async () => {
  const r = await conversa("já apresentei o deck pro cliente");
  assert(
    chamou(r, "completeTask") || chamou(r, "listTasks"),
    `não tratou como task concluída. Tools: ${r.chamadas.map((c) => c.nome).join(", ")}`,
  );
  assert(!chamou(r, "createTask"), "criou uma task nova em vez de concluir a existente");
});

// ─── Não inventar id ─────────────────────────────────────────────────────────

caso("cancelar evento: busca o id antes, não inventa", async () => {
  const r = await conversa("cancela a reunião de amanhã");
  const iBusca = r.chamadas.findIndex((c) => c.nome === "getEventsByDate" || c.nome === "getNextEvents");
  const iDelete = r.chamadas.findIndex((c) => c.nome === "deleteEvent");
  if (iDelete >= 0) {
    assert(iBusca >= 0 && iBusca < iDelete, "apagou evento sem buscar o id antes — id inventado");
  }
});

// ─── Integração ausente: admitir, não inventar ───────────────────────────────

caso("sem GA4 configurado, não promete métrica de site", async () => {
  const r = await conversa("como tá o tráfego do site da frente-x esse mês?");
  assert(!chamou(r, "getGa4Metrics"), "chamou GA4 num tenant que não tem GA4");
  assert(r.texto.trim().length > 0, "não respondeu nada");
});

caso("sem CRM configurado, não promete leads", async () => {
  const r = await conversa("me mostra os leads do funil");
  assert(!chamou(r, "listCrmLeads"), "chamou o CRM num tenant que não tem CRM");
});

caso("dado que só existe em ferramenta externa: sugere exportar CSV", async () => {
  const r = await conversa("quantos negócios eu tenho abertos no Pipedrive?");
  const t = r.texto.toLowerCase();
  assert(
    t.includes("csv") || t.includes("export") || t.includes("planilha") || t.includes("arquivo"),
    `não sugeriu o caminho do CSV: ${r.texto}`,
  );
});

// ─── Feedback: confirmar antes, não prometer prazo ───────────────────────────

caso("reclamação: confirma antes de abrir chamado", async () => {
  const r = await conversa("você marcou no dia errado de novo");
  assert(!chamou(r, "reportarFeedback"), "abriu chamado sem perguntar");
});

caso("feedback registrado: não promete prazo nem conserto", async () => {
  const r = await conversa("pode registrar sim", {
    historico: [
      { role: "user", content: "você marcou no dia errado de novo" },
      { role: "assistant", content: "Quer que eu registre isso como um problema pro time dar uma olhada?" },
    ],
  });
  const t = r.texto.toLowerCase();
  for (const proibido of ["vou consertar", "vou corrigir", "amanhã tá resolvido", "até amanhã", "em breve estará"]) {
    assert(!t.includes(proibido), `prometeu o que não controla ("${proibido}"): ${r.texto}`);
  }
});

// ─── Arquivo: confirma o envio, não descreve o conteúdo ──────────────────────

caso("planilha: manda e confirma curto, sem listar o conteúdo", async () => {
  const r = await conversa("me manda as tarefas da frente-x em planilha");
  assert(chamou(r, "exportSpreadsheet"), "não exportou");
  assert(
    r.texto.length < 240,
    `resposta longa demais depois de mandar arquivo (provável recital do conteúdo): ${r.texto}`,
  );
});

// ─── Próxima ação: uma, não a lista ──────────────────────────────────────────

caso("what_now: mostra uma prioridade, não empilha a lista", async () => {
  const r = await conversa("tô perdido, o que eu faço agora?");
  if (chamou(r, "pickNextActions")) {
    const t = r.texto.toLowerCase();
    const quantas = ["revisar o contrato", "responder o fornecedor", "fechar o reembolso"]
      .filter((s) => t.includes(s)).length;
    assert(quantas <= 1, `despejou ${quantas} sugestões de uma vez: ${r.texto}`);
  }
});

// ─── Cache de prompt (regressão do fix de 31/08/2026) ────────────────────────

caso("cache: a 2ª chamada do mesmo turno LÊ o prefixo, não reescreve", async () => {
  // Qualquer coisa volátil que volte pro prefixo cacheado (hora com minuto,
  // contador, id de request) quebra isto — e quebra em silêncio, só na conta.
  const r = await conversa("o que eu tenho na agenda amanhã?");
  assert(r.uso.length >= 2, "o caso não gerou tool use — sem 2ª chamada pra medir cache");
  const segunda = r.uso[1];
  assert(
    (segunda.cache_read_input_tokens ?? 0) > 0,
    `a 2ª chamada não leu o cache (leitura=${segunda.cache_read_input_tokens}, ` +
      `escrita=${segunda.cache_creation_input_tokens}) — algo volátil voltou pro prefixo`,
  );
});

// ─── Filtro de tools (regressão do fix de 31/08/2026) ────────────────────────

Deno.test("tenant comum não recebe as tools de GA4/CRM", () => {
  // Não chama modelo — é só o array. Roda sempre, com ou sem chave.
  const comum = defaultFastWithToolsDeps((k) => ENV_COMUM[k], PERSONA, null, "whatsapp");
  const dono = defaultFastWithToolsDeps((k) => ENV_DONO[k], PERSONA, null, "whatsapp");
  const nomes = (d: { toolsDefinidas: { name: string }[] }) => d.toolsDefinidas.map((t) => t.name);
  for (const proibida of ["get_ga4_metrics", "list_crm_leads", "list_marketing_campaigns", "list_supplier_quotes"]) {
    assert(!nomes(comum).includes(proibida), `tenant comum recebeu '${proibida}'`);
    assert(nomes(dono).includes(proibida), `o dono deixou de receber '${proibida}'`);
  }
  assertEquals(nomes(comum).length + 5, nomes(dono).length);
});
