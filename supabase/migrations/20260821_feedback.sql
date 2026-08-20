-- Bug reportado e melhoria sugerida pelo usuário, dos dois canais de entrada:
-- a conversa com a Mia (tool reportar_feedback em fast/index.ts) e o formulário
-- do site (app/api/feedback/route.ts). Uma tabela só pros dois — o `canal`
-- registra de onde veio, mas o dado é o mesmo.
--
-- O aviso pro dono da plataforma NÃO sai daqui: a coluna `avisado_em` é
-- reivindicada pela task `feedback_novo` do cron (cron/index.ts,
-- runFeedbackNovo), mesmo padrão de `tenants.avisado_em` em runNovosCadastros.
-- Motivo de ser assim e não um envio direto na hora do insert: quem escreve a
-- linha roda no env do tenant que reportou, que não tem — e não deve ter — a
-- credencial de WhatsApp do dono da plataforma.
--
-- Multi-tenant desde o dia 1, mesmo padrão de despesas/contatos/importacoes:
-- tenant_id NOT NULL, sem default, sem fallback pro dono da plataforma.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  tipo text not null,
  canal text not null,

  -- O que a pessoa escreveu, como escreveu. Teto de 2000 no banco é a segunda
  -- barreira: a aplicação corta antes (entrada não confiável, ver CLAUDE.md).
  texto text not null,

  criado_em timestamptz not null default now(),

  -- NULL = ainda não avisado. Reivindicado com UPDATE condicional antes do
  -- envio, pra duas execuções concorrentes do cron não mandarem o mesmo
  -- feedback duas vezes.
  avisado_em timestamptz,

  constraint feedback_tipo_valido check (tipo in ('bug', 'sugestao')),
  constraint feedback_canal_valido check (canal in ('whatsapp', 'telegram', 'teams', 'site')),
  constraint feedback_texto_tamanho check (length(texto) between 1 and 2000)
);

-- A varredura do cron é sempre "os não avisados, mais antigo primeiro".
create index feedback_pendentes_idx
  on public.feedback (criado_em)
  where avisado_em is null;

alter table public.feedback enable row level security;
-- Sem policy, de propósito: só service role (edge functions e as rotas de API
-- do site) acessa, mesmo padrão de despesas/contatos/importacoes.
