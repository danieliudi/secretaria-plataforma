-- Personalidade da secretária + agenda de contatos.
--
-- Motivação, em duas partes.
--
-- PERSONALIDADE: a voz era única e embutida no prompt. Escritório de
-- contabilidade e estúdio de design não querem a mesma secretária, e hoje não
-- há como diferenciar sem editar código. Vira coluna do tenant, com quatro
-- presets fechados (nada de texto livre: prompt vindo do banco é injeção de
-- prompt com etapa extra).
--
-- CONTATOS: o Google Calendar guarda E-MAIL do participante, nunca telefone. O
-- link wa.me exige telefone. Sem esta tabela, a secretária teria que perguntar
-- o número toda vez que fosse redigir uma confirmação — inclusive pra mesma
-- pessoa, todo dia. Ela pergunta uma vez e guarda.
--
-- Multi-tenant desde o dia 1, igual despesas: tenant_id NOT NULL, sem default,
-- sem fallback pro dono da plataforma.

-- ─── personalidade ──────────────────────────────────────────────────────────

-- `cordial` como default porque é o meio-termo: tenant que já existe não fica
-- sem voz definida nem muda de comportamento de forma brusca. NOT NULL pra que
-- nenhum caminho de leitura precise decidir o que fazer com null — não existe
-- tenant sem personalidade.
alter table public.tenants
  add column personalidade text not null default 'cordial';

-- Conjunto FECHADO. O valor daqui escolhe um fragmento de prompt já escrito em
-- _shared/personalidade.ts; ele nunca é concatenado no prompt como texto. Se um
-- dia virar campo livre, vira vetor de injeção.
alter table public.tenants
  add constraint tenants_personalidade_valida
    check (personalidade in ('direta', 'cordial', 'formal', 'leve'));

-- ─── contatos ───────────────────────────────────────────────────────────────

create table public.contatos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Quem cadastrou, no formato de user_id do canal (remoteJid ou tg:<chatId>),
  -- mesmo padrão de despesas. Guardado pra quando um tenant tiver mais de uma
  -- pessoa usando a secretária.
  user_id text,

  nome text not null,

  -- E.164 SEM o "+", que é exatamente o formato que o wa.me consome
  -- (5511988887777). A normalização acontece em _shared/telefone.ts antes de
  -- chegar aqui; o check abaixo é a segunda barreira, não a primeira.
  telefone_e164 text not null,

  -- Opcional, e é o elo com o Calendar: o participante do evento vem
  -- identificado por e-mail, então é por aqui que "quem é a Ana do evento das
  -- 14h" encontra um telefone.
  email text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Só dígitos, começando em 55, tamanho de fixo (12) ou celular (13). Barra
  -- "+55...", número com espaço e telefone estrangeiro que escape da aplicação.
  constraint contatos_telefone_e164_valido
    check (telefone_e164 ~ '^55[1-9][0-9]{9,10}$'),

  -- Tamanhos: nome e e-mail vêm de texto de usuário e de resposta da Calendar
  -- API, os dois tratados como hostis.
  constraint contatos_tamanhos
    check (
      length(nome) between 1 and 120
      and (email is null or length(email) <= 320)
    )
);

-- Um telefone, um contato por tenant. Sem isto, cada confirmação criaria uma
-- linha nova e "a Ana" viraria oito Anas iguais em três meses.
create unique index contatos_tenant_telefone_idx
  on public.contatos (tenant_id, telefone_e164);

-- Busca dominante: "manda mensagem pra Ana" — o modelo tem o nome, não o
-- número. `lower(nome)` porque o usuário escreve "ana", "Ana" e "ANA".
create index contatos_tenant_nome_idx
  on public.contatos (tenant_id, lower(nome));

-- Casamento com participante de evento do Calendar, que chega por e-mail.
create index contatos_tenant_email_idx
  on public.contatos (tenant_id, lower(email))
  where email is not null;

alter table public.contatos enable row level security;
-- Sem policy, de propósito: só service role (edge functions) acessa, mesmo
-- padrão de despesas/uso_modelo/uso_janela. RLS ligado sem nenhuma policy
-- bloqueia qualquer role que não bypasse RLS — anon e authenticated não leem
-- nada. Contato é lista de telefone de terceiro: o alvo mais óbvio de
-- vazamento entre tenants nesta base.
