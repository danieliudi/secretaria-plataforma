-- Watchdog da instância compartilhada de WhatsApp (Evolution API). A cada
-- 10 min chama a task whatsapp_watchdog: consulta o estado da conexão direto
-- na Evolution, tenta reconectar sozinha se não estiver "open", e só avisa
-- (Telegram, dedup) se continuar fora do ar depois da tentativa — ver
-- runWhatsappWatchdog em supabase/functions/cron/index.ts.
--
-- Motivação: incidente de 20-24/08/2026 — a instância desconectou da
-- Evolution API silenciosamente e ninguém soube por 3,5 dias, porque nada
-- monitorava o estado da conexão em si (só o tráfego, que ficar quieto é
-- normal à noite/fim de semana). Mesmo padrão dos outros jobs de varredura
-- leve: timeout curto, service-role key lida do Vault em tempo de execução.
select cron.schedule(
  'whatsapp-watchdog',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'whatsapp_watchdog'),
    timeout_milliseconds := 20000
  );
  $$
);
