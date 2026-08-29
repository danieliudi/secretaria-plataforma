-- Jobs das reuniões (ver cron/index.ts: runReunioes e runReuniaoRetencao).
--
-- 'reunioes' a cada 5 min: é o POLLING do resultado da transcrição. A PRIMEIRA
-- submissão não espera por aqui — /api/reunioes/enviado cutuca a task assim
-- que o upload fecha (dispararTarefaCron), então o job já sai na hora. Este
-- agendamento existe pra buscar o resultado depois e pra recuperar qualquer
-- linha cujo disparo direto tenha falhado.
--
-- O coordenador tem pré-filtro (tenantIdsComReuniaoEmAberto): num tick sem
-- nenhuma reunião em andamento — que é a esmagadora maioria — ele faz UMA
-- query e não invoca execução pra tenant nenhum.
select cron.schedule(
  'reunioes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'reunioes'),
    timeout_milliseconds := 30000
  );
  $$
);

-- Retenção do áudio original: 1x por dia, 04:20 UTC = 01:20 America/Sao_Paulo.
-- Apaga só o ARQUIVO; a ata e a transcrição continuam (o combinado com o
-- usuário foi sobre a gravação, não sobre a memória da reunião).
select cron.schedule(
  'reuniao-retencao',
  '20 4 * * *',
  $$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'reuniao_retencao'),
    timeout_milliseconds := 60000
  );
  $$
);

-- ATENÇÃO (29/08/2026): os dois jobs foram criados e imediatamente
-- DESATIVADOS (cron.alter_job ... active := false).
--
-- Motivo: o CI só publica as edge functions em push pra `main`, então entre
-- aplicar esta migration e o merge existe uma janela em que o /cron ainda não
-- conhece as tasks 'reunioes'/'reuniao_retencao' e responde 400. Ativo, o job
-- de 5 minutos encheria o log de falha e esconderia falha de verdade.
--
-- Reativar DEPOIS do deploy:
--   select cron.alter_job(jobid, active := true)
--   from cron.job where jobname in ('reunioes', 'reuniao-retencao');
