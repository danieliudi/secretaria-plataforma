-- Fase 3 das reuniões: a ata entra na busca do histórico ("Ask Mia").
--
-- Antes, perguntar "o que a gente decidiu sobre a Titã?" só alcançava o que
-- tinha sido CONVERSADO com a Mia — resumos_diarios. Uma reunião de uma hora,
-- transcrita e resumida, ficava fora: o dado mais denso que ela tem era
-- justamente o único que a busca não via.
--
-- A ata vira vetor na PRÓPRIA tabela `reunioes`, e não uma linha em
-- `resumos_diarios`, por dois motivos:
--   1. resumos_diarios tem unique(tenant_id, user_id, data) — uma reunião no
--      mesmo dia de uma conversa colidiria, e o dia é a chave errada aqui;
--   2. a ata já mora em reunioes com título, duração e falantes. Duplicar o
--      texto pra outra tabela criaria duas verdades pra manter em sincronia.
create extension if not exists vector;

alter table public.reunioes
  add column if not exists embedding vector(1024);

create index if not exists reunioes_embedding_idx
  on public.reunioes using hnsw (embedding vector_cosine_ops);

-- Pra achar rápido o que ainda falta embedar (backfill e retentativa quando a
-- Voyage estiver fora do ar).
create index if not exists reunioes_sem_embedding_idx
  on public.reunioes (tenant_id)
  where status = 'entregue' and embedding is null;

-- ── Busca unificada ─────────────────────────────────────────────────────────
--
-- A função ganha uma coluna `origem`, então precisa de DROP: o Postgres não
-- deixa CREATE OR REPLACE mudar o tipo de retorno.
--
-- POR QUE A ORIGEM IMPORTA: "você me contou no dia 12" e "ficou decidido na
-- reunião do dia 12" são afirmações diferentes, e a Mia precisa saber qual
-- está citando. Sem isso ela diria "você me disse" sobre algo que outra pessoa
-- falou numa reunião — que é o mesmo tipo de erro de atribuição que a gente já
-- blindou nos turnos de fala.
drop function if exists public.buscar_resumos_diarios(uuid, text, vector, int);

create or replace function public.buscar_resumos_diarios(
  p_tenant_id uuid,
  p_user_id text,
  p_embedding vector(1024),
  p_limite int default 5
)
returns table (data date, resumo text, similaridade float, origem text, titulo text)
language sql
stable
as $$
  -- Dois CTEs em vez de um UNION com ORDER BY em cada braço: o Postgres não
  -- aceita ORDER BY/LIMIT direto dentro de um braço de UNION sem parênteses, e
  -- cada braço PRECISA do seu próprio ORDER BY pra que o índice HNSW seja
  -- usado. Separando, cada lado faz a própria busca vetorial indexada e só
  -- depois os dois se encontram.
  with da_conversa as (
    select
      r.data,
      r.resumo,
      1 - (r.embedding <=> p_embedding) as similaridade,
      'conversa'::text as origem,
      null::text as titulo
    from public.resumos_diarios r
    where r.tenant_id = p_tenant_id
      and r.user_id = p_user_id
      and r.embedding is not null
    order by r.embedding <=> p_embedding
    limit greatest(1, least(p_limite, 10))
  ),
  das_reunioes as (
    select
      (m.created_at at time zone 'America/Sao_Paulo')::date as data,
      m.ata as resumo,
      1 - (m.embedding <=> p_embedding) as similaridade,
      'reuniao'::text as origem,
      m.titulo
    from public.reunioes m
    where m.tenant_id = p_tenant_id
      -- MESMO filtro por dono das duas pontas: reunião entregue pra outra
      -- pessoa do mesmo tenant não pode aparecer na busca desta aqui.
      and m.user_id = p_user_id
      and m.embedding is not null
      and m.ata is not null
    order by m.embedding <=> p_embedding
    limit greatest(1, least(p_limite, 10))
  )
  select c.data, c.resumo, c.similaridade, c.origem, c.titulo
  from (select * from da_conversa union all select * from das_reunioes) c
  order by c.similaridade desc
  limit greatest(1, least(p_limite, 10));
$$;

revoke all on function public.buscar_resumos_diarios(uuid, text, vector, int) from public;
grant execute on function public.buscar_resumos_diarios(uuid, text, vector, int) to service_role;

-- ── Fase 2: tarefas sugeridas pela ata ──────────────────────────────────────
--
-- Lista de compromissos que a ata identificou, cada um com dono e prazo COMO
-- FORAM DITOS ("sexta", "até o dia 5") — sem conversão pra data aqui.
--
-- Por que sem conversão: quem sabe que dia é "sexta" é o modelo conversacional,
-- que tem a data de hoje no prompt e vai criar as tarefas quando o usuário
-- confirmar. O cron não precisa fazer aritmética de calendário, e converter
-- cedo demais congelaria uma data errada num campo que ninguém revisa.
alter table public.reunioes
  add column if not exists tarefas_sugeridas jsonb;

comment on column public.reunioes.tarefas_sugeridas is
  'Compromissos que a ata identificou: [{titulo, quem?, quando?}]. Prazo em linguagem natural, como foi dito.';
