-- "Lugar novo": na véspera, avisa quando amanhã tem um endereço onde a pessoa
-- nunca esteve (cron/index.ts: runLugarNovo).
--
-- 21h de Brasília = 00:00 UTC. Uma vez por noite, não a cada 30 min: a agenda
-- de amanhã já está formada e reexecutar não acharia nada novo — o claim em
-- `avisos_enviados` (chave evento+dia) impediria o reenvio de qualquer forma.
--
-- Por que 21h e não de manhã: a utilidade toda é dar tempo de reagir. Descobrir
-- às 8h que a visita das 14h pede crachá pedido na véspera não serve pra nada.
--
-- Pré-filtro: a task está em TASKS_GOOGLE, então o coordenador nem invoca
-- execução pra tenant sem Google conectado.
select cron.schedule(
  'lugar-novo',
  '0 0 * * *',
  $CRON$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'lugar_novo'),
    -- Esta task lê 12 meses de agenda; 30s do padrão pode não bastar num
    -- calendário cheio.
    timeout_milliseconds := 60000
  );
  $CRON$
);
