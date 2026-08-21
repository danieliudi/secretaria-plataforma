-- jobid 15 (despesa_anomala, */5) é o único job do cron sem
-- timeout_milliseconds — roda no default do pg_net, 5000ms. Achado da
-- auditoria de multi-tenant de 20/08/2026: com o fan-out (coordenador +
-- pré-filtro), a resposta ainda deve ser rápida, mas não há por que este job
-- ser o único sem teto explícito enquanto todos os outros 13 têm. Mesmo
-- valor de `scheduled` (jobid 7), a task estruturalmente mais parecida —
-- ambas fazem só leitura de banco, sem chamada a API externa no coordenador.

select cron.alter_job(
  job_id := 15,
  command := $$
  select net.http_post(
    url := 'https://edaogdfeuxrylwqpopqe.supabase.co/functions/v1/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := jsonb_build_object('task', 'despesa_anomala'),
    timeout_milliseconds := 20000
  );
  $$
);
