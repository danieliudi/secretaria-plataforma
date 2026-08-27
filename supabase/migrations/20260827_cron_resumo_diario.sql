-- Agenda a task multi-tenant 'resumo_diario' (cron/index.ts) — mesmo padrão
-- de coordenador dos outros jobs mecânicos (fan-out por tenant elegível, o
-- executor real roda em EdgeRuntime.waitUntil, então o timeout aqui só
-- precisa cobrir o fan-out em si, não o trabalho de cada tenant).
--
-- Horário: 03:10 UTC = 00:10 America/Sao_Paulo (Brasil não tem mais horário
-- de verão) — 10 min depois da virada do dia, pra resumir o dia que ACABOU
-- de fechar (ver diaAnteriorEmSP em cron/index.ts).
select cron.schedule(
  'resumo-diario',
  '10 3 * * *',
  $$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'resumo_diario'),
    timeout_milliseconds := 30000
  );
  $$
);
