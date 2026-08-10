-- Dá dono às tabelas de dados do usuário.
--
-- Até aqui estas tabelas eram GLOBAIS: nenhuma coluna de tenant e nenhuma
-- query filtrando. Consequências reais em produção:
--   * `one thing?` devolvia a prioridade estratégica de QUALQUER usuário;
--   * `tomei remédio` lia horários e doses de medicação de todos (dado de
--     saúde) e registrava a tomada no cadastro de outra pessoa;
--   * `água 500` somava o total do dia de todo mundo junto;
--   * "arquiva todas as notas" marcava as anotações pendentes de TODOS como
--     resolvidas — e devolvia o texto delas na resposta.
-- Os gatilhos do tier reflex são expressões de uma palavra, então isso
-- acontecia sem intenção nenhuma, no primeiro dia de qualquer usuário novo.
--
-- Backfill: todo dado existente é do dono da plataforma — a plataforma só teve
-- um usuário de verdade até agora.

alter table public.quick_capture       add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.one_thing           add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.health_log          add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.habit_log           add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.treino_log          add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.medication_schedule add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.medication_log      add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

update public.quick_capture       set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;
update public.one_thing           set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;
update public.health_log          set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;
update public.habit_log           set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;
update public.treino_log          set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;
update public.medication_schedule set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;
update public.medication_log      set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;

-- Índices: toda leitura passa a filtrar por tenant_id.
create index if not exists quick_capture_tenant_idx       on public.quick_capture (tenant_id);
create index if not exists one_thing_tenant_idx           on public.one_thing (tenant_id);
create index if not exists health_log_tenant_idx          on public.health_log (tenant_id);
create index if not exists habit_log_tenant_idx           on public.habit_log (tenant_id);
create index if not exists treino_log_tenant_idx          on public.treino_log (tenant_id);
create index if not exists medication_schedule_tenant_idx on public.medication_schedule (tenant_id);
create index if not exists medication_log_tenant_idx      on public.medication_log (tenant_id);

-- O NOT NULL fica para uma migration SEGUINTE, aplicada só depois que o código
-- que grava tenant_id estiver em produção. Marcar agora quebraria toda gravação
-- na janela entre esta migration e o deploy — "água 500" viraria erro.
-- Ver 20260810_dono_por_tenant_not_null.sql.
