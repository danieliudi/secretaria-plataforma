-- Aviso de orçamento estourado no Google Ads (cron/index.ts: runAdsCheck).
--
-- A cada 30 min, entre 8h e 20h de Brasília (11-23 UTC). Fora desse intervalo
-- não adianta avisar: a campanha volta na virada do dia e ninguém vai mexer em
-- orçamento às 3 da manhã.
--
-- O coordenador tem pré-filtro por `google_ads_ativo`: num tique em que
-- ninguém tem Ads ligado — que é o caso hoje — ele faz UMA query e não invoca
-- execução pra tenant nenhum.
select cron.schedule(
  'ads-check',
  '*/30 11-23 * * *',
  $CRON$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'ads_check'),
    timeout_milliseconds := 30000
  );
  $CRON$
);
