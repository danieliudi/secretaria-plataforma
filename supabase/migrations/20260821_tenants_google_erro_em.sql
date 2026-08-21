-- Marca quando o refresh do Google falha com `invalid_grant` (token
-- revogado/expirado — o usuário desconectou o app, trocou de conta, etc).
--
-- Sem isto, um tenant nesse estado batia na mesma falha centenas de vezes por
-- dia (reminders e prep_reuniao rodam */5) sem que ninguém — nem ele, nem o
-- dono da plataforma — ficasse sabendo que precisa reconectar. Achado da
-- auditoria de multi-tenant de 20/08/2026: "tenant que PERDEU o Google" é o
-- caso comum em produção, diferente de "tenant que nunca conectou".

alter table public.tenants
  add column if not exists google_erro_em timestamptz null;

comment on column public.tenants.google_erro_em is
  'Setado quando o refresh do Google falha com invalid_grant. As tasks que dependem de Calendar pulam o tenant enquanto isto estiver preenchido — ver marcaGoogleRevogadoSeAplicavel em supabase/functions/cron/index.ts. Limpo quando o Google é reconectado (novo refresh token gravado no wizard).';
