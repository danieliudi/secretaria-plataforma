-- scheduled_reminders já tinha a coluna tenant_id, mas NENHUMA linha estava
-- preenchida — inclusive um lembrete ainda pendente. Como o cron passou a
-- filtrar por tenant_id, sem este backfill esse lembrete nunca dispararia (e
-- some em silêncio: ninguém reclama de uma mensagem que não chegou).
update public.scheduled_reminders
   set tenant_id = (select id from public.tenants where is_platform_owner)
 where tenant_id is null;

create index if not exists scheduled_reminders_tenant_idx
  on public.scheduled_reminders (tenant_id);
