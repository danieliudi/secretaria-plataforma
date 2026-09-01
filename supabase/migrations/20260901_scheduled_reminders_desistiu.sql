-- `sent_at` significava duas coisas incompatíveis: "chegou na pessoa" e
-- "desisti de tentar". Quando o cron estourava SCHEDULED_MAX_TENTATIVAS ele
-- gravava sent_at pra linha parar de reentrar no loop — e a tabela passava a
-- afirmar que um lembrete que nunca saiu tinha sido entregue.
--
-- Caso real (01/09/2026): um tenant de número compartilhado reclamou que
-- lembrete "não funciona". No banco, o lembrete dele aparecia com sent_at
-- preenchido. Só olhando `tentativas = 10` dava pra ver que ele nunca saiu.
-- Quem confia na coluna erra; e nenhum relatório futuro ia olhar tentativas.
--
-- Agora sent_at significa UMA coisa: a Evolution/Telegram aceitou o envio.
alter table public.scheduled_reminders
  add column if not exists desistiu_em timestamptz,
  add column if not exists ultimo_erro text;

comment on column public.scheduled_reminders.sent_at is
  'Quando o envio foi ACEITO pelo canal. Nunca preencher por desistência — use desistiu_em.';
comment on column public.scheduled_reminders.desistiu_em is
  'Quando o cron parou de tentar (estourou o teto de tentativas). A mensagem NÃO foi entregue.';
comment on column public.scheduled_reminders.ultimo_erro is
  'Motivo da última falha de entrega, já passado por semDadoPessoal(). Sem dado pessoal.';

-- Correção do dado velho: o que está marcado como enviado mas esgotou as
-- tentativas nunca foi entregue. O valor não some — muda de coluna.
-- O 10 aqui é SCHEDULED_MAX_TENTATIVAS (cron/index.ts); se aquele teto mudar,
-- esta migration continua correta pro histórico que ela corrigiu.
update public.scheduled_reminders
   set desistiu_em = sent_at,
       sent_at = null
 where sent_at is not null
   and tentativas >= 10;

-- A varredura do cron agora exclui os dois estados finais. Índice parcial
-- porque a varredura só olha o que está pendente — que é sempre pouco perto
-- do histórico acumulado.
create index if not exists scheduled_reminders_pendentes_idx
  on public.scheduled_reminders (tenant_id, fire_at)
  where sent_at is null and desistiu_em is null;
