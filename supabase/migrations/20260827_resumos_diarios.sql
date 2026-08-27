-- "Ask Mia" (ideia 1 do brainstorm de inspiração no Heypocket, aprovada pelo
-- Daniel em 27/08/2026): busca semântica no histórico de conversa ALÉM da
-- janela recente que o /fast já vê (HISTORY_LIMIT=14, ~7 turnos).
--
-- Estratégia escolhida (das 3 apresentadas): resumir o dia inteiro de
-- conversa 1x, à noite, em vez de guardar embedding por mensagem — mantém o
-- volume (e o custo da Voyage) baixo e a densidade de busca alta, já que o
-- resumo já filtra o ruído de "oi"/"bom dia" antes de virar vetor.
--
-- Provedor: Voyage AI (voyage-4, recomendação oficial da Anthropic pra
-- embeddings), 1024 dimensões (default do modelo).
create extension if not exists vector;

create table public.resumos_diarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Mesmo formato de user_id do resto da base (remoteJid do WhatsApp ou
  -- 'tg:<chatId>') — é o dono da conversa resumida, não de quem rodou o cron.
  user_id text not null,
  -- Dia civil (America/Sao_Paulo) que este resumo cobre, não a data de
  -- criação da linha (o job roda de madrugada, resumindo o dia anterior).
  data date not null,
  resumo text not null,
  embedding vector(1024),
  created_at timestamptz not null default now(),

  -- Um resumo por usuário por dia — job idempotente via upsert nesta chave.
  unique (tenant_id, user_id, data),

  -- resumo é saída do modelo, não texto livre de usuário, mas o prompt de
  -- sumarização já pede "até 6-8 linhas" — teto generoso só contra
  -- degeneração (ver despesas_tamanhos pro mesmo padrão de defesa).
  constraint resumos_diarios_tamanho check (length(resumo) <= 4000)
);

-- Consulta dominante: RPC de busca por similaridade filtrada por tenant+user.
create index resumos_diarios_tenant_user_idx on public.resumos_diarios (tenant_id, user_id);
create index resumos_diarios_embedding_idx
  on public.resumos_diarios using hnsw (embedding vector_cosine_ops);

-- Sem policy, de propósito: só service role (edge functions) acessa, mesmo
-- padrão de despesas/quick_capture/uso_modelo. RLS ligado sem nenhuma policy
-- bloqueia qualquer role que não bypasse RLS — anon e authenticated não leem
-- nem escrevem nada aqui.
alter table public.resumos_diarios enable row level security;

-- RPC de busca: postgrest/supabase-js não expõe o operador `<=>` de distância
-- pra ORDER BY em queries comuns — precisa de uma function. tenant_id e
-- user_id são obrigatórios (não opcionais) de propósito: sem eles, um bug de
-- chamada vazaria resumo de um usuário/tenant pro outro na busca.
create or replace function public.buscar_resumos_diarios(
  p_tenant_id uuid,
  p_user_id text,
  p_embedding vector(1024),
  p_limite int default 5
)
returns table (data date, resumo text, similaridade float)
language sql
stable
as $$
  select r.data, r.resumo, 1 - (r.embedding <=> p_embedding) as similaridade
  from public.resumos_diarios r
  where r.tenant_id = p_tenant_id
    and r.user_id = p_user_id
    and r.embedding is not null
  order by r.embedding <=> p_embedding
  limit greatest(1, least(p_limite, 10));
$$;

revoke all on function public.buscar_resumos_diarios from public;
grant execute on function public.buscar_resumos_diarios to service_role;
