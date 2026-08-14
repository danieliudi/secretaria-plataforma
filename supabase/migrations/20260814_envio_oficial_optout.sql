-- Envio oficial (WhatsApp Cloud API): opt-out global e registro de envio.
--
-- Esta migration entra ANTES do código que envia, de propósito. O que protege
-- precisa existir antes do que dispara — se a ordem se inverter, existe uma
-- janela em que dá pra enviar sem ter onde checar se a pessoa pediu pra sair.
--
-- Nada aqui liga nada: `envio_oficial` nasce false em todo tenant, e sem
-- credencial da Meta no Vault o caminho continua sendo o link wa.me.

-- ─── opt-in por tenant ──────────────────────────────────────────────────────

-- Desligado por padrão = comportamento de hoje. Ligar é decisão do tenant, na
-- tela de onboarding, com o custo por mensagem à vista.
alter table public.tenants
  add column envio_oficial boolean not null default false;

-- ─── opt-out, GLOBAL por telefone ───────────────────────────────────────────

-- ATENÇÃO À AUSÊNCIA DE tenant_id NA CHAVE: é a decisão central desta tabela.
-- Se o opt-out fosse por tenant, a pessoa que respondeu "SAIR" teria que
-- repetir o pedido pra cada cliente nosso que a contatasse — tecnicamente
-- defensável, na prática indefensável, e o tipo de coisa que a ANPD lê como
-- dificultar o exercício do direito.
--
-- Consequência assumida: o tenant A consegue, indiretamente, saber que um
-- telefone saiu (a Yuka dele vai recusar enviar). É menos informação do que
-- forçar a pessoa a repetir o pedido N vezes.
create table public.whatsapp_opt_out (
  -- E.164 sem "+", mesmo formato de `contatos`. PK porque a pergunta é sempre
  -- "este número está fora?" e a resposta precisa ser um índice, não um scan.
  telefone_e164 text primary key,

  -- Como o pedido chegou. 'resposta_sair' = a pessoa respondeu à mensagem;
  -- 'pedido_manual' = alguém registrou por outro canal (e-mail, telefonema).
  motivo text not null default 'resposta_sair',

  -- Só auditoria: qual tenant estava enviando quando o pedido veio.
  -- ON DELETE SET NULL, nunca CASCADE — apagar um tenant NÃO pode ressuscitar
  -- o direito de mandar mensagem pra quem pediu pra sair.
  origem_tenant_id uuid references public.tenants(id) on delete set null,

  criado_em timestamptz not null default now(),

  constraint whatsapp_opt_out_telefone_valido
    check (telefone_e164 ~ '^55[1-9][0-9]{9,10}$'),
  constraint whatsapp_opt_out_motivo_valido
    check (motivo in ('resposta_sair', 'pedido_manual'))
);

-- ─── registro de envio e de base legal ──────────────────────────────────────

-- Sem esta tabela, "tínhamos base legal" é afirmação sem prova no dia em que
-- alguém questionar. Guarda POR ENVIO de onde veio o direito de contatar.
create table public.envios_whatsapp (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  telefone_e164 text not null,

  -- Nome do template aprovado na Meta. Texto livre não passa por aqui: o
  -- catálogo vive em _shared/templates-wa.ts e o gate recusa nome desconhecido.
  template text not null,

  -- A BASE LEGAL, capturada no momento do envio e não deduzida depois.
  -- 'participante_evento' = estava convidado num compromisso da agenda do
  -- tenant; 'cadastrado_pelo_usuario' = o próprio tenant registrou o contato.
  -- Não existe valor pra lista importada, de propósito.
  origem_contato text not null,

  -- Qual compromisso motivou o envio, pra reconstruir o contexto numa auditoria.
  evento_id text,

  -- ID devolvido pela Meta, pra conciliar entrega/leitura depois.
  wa_message_id text,

  enviado_em timestamptz not null default now(),

  constraint envios_whatsapp_telefone_valido
    check (telefone_e164 ~ '^55[1-9][0-9]{9,10}$'),
  constraint envios_whatsapp_origem_valida
    check (origem_contato in ('participante_evento', 'cadastrado_pelo_usuario')),
  constraint envios_whatsapp_tamanhos
    check (
      length(template) <= 80
      and (evento_id is null or length(evento_id) <= 200)
      and (wa_message_id is null or length(wa_message_id) <= 200)
    )
);

-- Consulta dominante: "já mandei este template pra este número por causa deste
-- evento?" — é o que impede dois lembretes do mesmo compromisso.
create index envios_whatsapp_dedup_idx
  on public.envios_whatsapp (tenant_id, telefone_e164, template, evento_id);

-- Auditoria por período.
create index envios_whatsapp_tenant_data_idx
  on public.envios_whatsapp (tenant_id, enviado_em desc);

alter table public.whatsapp_opt_out enable row level security;
alter table public.envios_whatsapp enable row level security;
-- Sem policy, de propósito: só service role (edge functions) acessa, mesmo
-- padrão de contatos/despesas/uso_modelo. RLS ligado sem policy bloqueia
-- qualquer role que não bypasse RLS.
