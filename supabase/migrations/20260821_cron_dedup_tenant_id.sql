-- Dá dono às duas tabelas de dedup do cron que ainda são globais, e regulariza
-- a DDL delas (existiam em produção sem nunca terem sido versionadas — nenhum
-- `create table` pra elas em supabase/migrations/ antes desta).
--
-- A colisão é real, não teórica (auditoria de multi-tenant, 20/08/2026):
--   * reminders_sent: o Google mantém o MESMO event_id na cópia de cada
--     convidado. Quando o Daniel convida outro tenant pra uma reunião, quem
--     for varrido primeiro insere a linha e o segundo tenant nunca recebe o
--     lembrete (dedup por event_id+event_start, sem tenant). Em execuções
--     concorrentes, o segundo insert viola o único e a exceção sobe.
--   * clickup_alerts_sent: dois tenants olhando a MESMA lista compartilhada
--     (ClickUp/Notion/Google Tasks de chefe+assistente ou sócios) produzem o
--     mesmo task_id+due_ms — o segundo nunca recebe o alerta.
--
-- `create table if not exists` deixa a DDL correta pra qualquer ambiente que
-- não seja a produção atual (branch de preview, `supabase db reset` local,
-- projeto novo) — nesses, é o create que de fato cria a tabela; em produção é
-- no-op e os `alter table` seguintes é que fazem o trabalho.

create table if not exists public.reminders_sent (
  id bigserial primary key,
  event_id text not null,
  event_start timestamptz not null,
  title text,
  sent_at timestamptz not null default now()
);

create table if not exists public.clickup_alerts_sent (
  id bigserial primary key,
  task_id text not null,
  due_ms bigint not null,
  name text,
  sent_at timestamptz not null default now()
);

alter table public.reminders_sent      add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.clickup_alerts_sent add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

-- Backfill: todo dado existente é do dono da plataforma (mesmo padrão de
-- 20260810_dono_por_tenant_nas_tabelas_de_dados.sql).
update public.reminders_sent      set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;
update public.clickup_alerts_sent set tenant_id = (select id from public.tenants where is_platform_owner) where tenant_id is null;

alter table public.reminders_sent      drop constraint if exists reminders_sent_event_id_event_start_key;
alter table public.clickup_alerts_sent drop constraint if exists clickup_alerts_sent_task_id_due_ms_key;

create unique index if not exists reminders_sent_tenant_event_key
  on public.reminders_sent (tenant_id, event_id, event_start);
create index if not exists reminders_sent_tenant_idx on public.reminders_sent (tenant_id);

create unique index if not exists clickup_alerts_sent_tenant_task_due_key
  on public.clickup_alerts_sent (tenant_id, task_id, due_ms);
create index if not exists clickup_alerts_sent_tenant_idx on public.clickup_alerts_sent (tenant_id);

-- O código PARA de gravar `title`/`name` a partir desta mudança — dedup não
-- precisa do conteúdo, e com N tenants isso vira agenda de reunião / backlog
-- de tarefa de várias pessoas misturados numa tabela de controle sem dono.
-- Limpar o HISTÓRICO já gravado é destrutivo (apaga dado) e fica pra uma
-- decisão separada, com o Daniel — não faço isso sozinho.

-- NOT NULL fica para uma migration seguinte, só depois do código que grava
-- tenant_id estar em produção — mesma lição registrada em
-- 20260810_dono_por_tenant_nas_tabelas_de_dados.sql:44-48 (marcar NOT NULL
-- junto quebraria toda gravação na janela entre esta migration e o deploy).

-- Teto de tentativas nos lembretes agendados: sem isto, um lembrete que não
-- consegue entregar (canal nunca vinculado, credencial revogada) reentrava
-- pra sempre, a cada 5 minutos.
alter table public.scheduled_reminders add column if not exists tentativas int not null default 0;
