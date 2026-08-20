-- Lista de exclusão do card "relação esfriando" (cron/index.ts:
-- runRelacionamentoEsfriando). O chefe pode dizer, numa conversa, que uma
-- pessoa específica não deve entrar nesse alerta — o caso real que motivou
-- isto: o card avisou sobre a esposa dele, tratando "sem reunião com ela" como
-- se fosse uma relação profissional a acompanhar. Família, amigo próximo, ou
-- qualquer contato que não é isso precisa de um jeito de sair da lista.
--
-- Chave é E-MAIL (não telefone/nome): é o mesmo identificador que
-- runRelacionamentoEsfriando usa pra agregar participante de evento do
-- Calendar — nome pode não existir (Google às vezes não manda displayName) e
-- telefone nunca existe nesse fluxo (é dado de reunião, não de contato do
-- WhatsApp). Guardado sempre em minúsculas pela aplicação, pra
-- case-insensitive sem precisar de índice funcional.
--
-- Multi-tenant desde o dia 1, mesmo padrão de contatos/despesas: tenant_id
-- NOT NULL, sem default, sem fallback pro dono da plataforma.

create table public.relacionamento_ignorado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Sempre em minúsculas — normalizado em fast/tools/relacionamento.ts antes
  -- de chegar aqui; o check abaixo é a segunda barreira, não a primeira.
  email text not null,

  -- Opcional, só pra contexto humano (ex: "Erika Miwa") — nunca usado pra
  -- casar contra o participante do evento, que é sempre por e-mail.
  nome text,

  criado_em timestamptz not null default now(),

  constraint relacionamento_ignorado_tamanhos
    check (
      length(email) between 1 and 320
      and (nome is null or length(nome) <= 120)
    )
);

-- Uma pessoa só entra uma vez por tenant — pedir de novo pra ignorar quem já
-- está ignorado não deve duplicar linha.
create unique index relacionamento_ignorado_tenant_email_idx
  on public.relacionamento_ignorado (tenant_id, email);

alter table public.relacionamento_ignorado enable row level security;
-- Sem policy, de propósito: só service role (edge functions) acessa, mesmo
-- padrão de despesas/contatos/importacoes.
