-- Agenda a task feedback_novo (existe no código desde o merge de hoje, mas
-- nenhum job do pg_cron chamava ela ainda). Mesmo padrão dos outros jobs de
-- varredura leve (scheduled-reminders, despesa-anomala, prep-reuniao): 5 em 5
-- min, timeout de 20s, service-role key lida do Vault em tempo de execução.
select cron.schedule(
  'feedback-novo',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'feedback_novo'),
    timeout_milliseconds := 20000
  );
  $$
);
