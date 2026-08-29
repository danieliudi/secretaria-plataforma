-- Agregação de uso por tenant + modelo, pro painel de custo do /admin.
--
-- POR QUE UMA FUNCTION E NÃO UMA QUERY NO CLIENTE: o PostgREST não faz
-- GROUP BY, então a página teria que baixar UMA LINHA POR CHAMADA de modelo
-- e somar em JavaScript. Isso já tem um teto silencioso hoje (o `select`
-- do supabase-js devolve no máximo 1000 linhas por padrão): com o volume
-- atual passa despercebido, mas no dia em que o mês passar de 1000 chamadas
-- o número na tela ficaria MENOR que a realidade, sem erro nenhum — o pior
-- tipo de bug num painel de custo. Agregando aqui, o resultado é de poucas
-- linhas (tenants × modelos) e sempre completo.
--
-- Dinheiro NÃO é calculado aqui de propósito: a tabela de preços mora em
-- lib/precos-modelo.ts, versionada junto do código que a usa. Duplicar preço
-- em SQL criaria duas fontes de verdade que divergem no primeiro reajuste.
create or replace function public.uso_por_tenant(p_desde timestamptz)
returns table (
  tenant_id uuid,
  modelo text,
  chamadas bigint,
  conversas bigint,
  proativos bigint,
  classificador bigint,
  tokens_entrada bigint,
  tokens_cache_escrita bigint,
  tokens_cache_leitura bigint,
  tokens_saida bigint
)
language sql
stable
as $$
  select
    u.tenant_id,
    u.modelo,
    count(*) as chamadas,
    count(*) filter (where u.origem in ('whatsapp', 'telegram', 'teams')) as conversas,
    count(*) filter (where u.origem = 'cron') as proativos,
    count(*) filter (where u.origem = 'classificador') as classificador,
    coalesce(sum(u.tokens_entrada), 0) as tokens_entrada,
    coalesce(sum(u.tokens_cache_escrita), 0) as tokens_cache_escrita,
    coalesce(sum(u.tokens_cache_leitura), 0) as tokens_cache_leitura,
    coalesce(sum(u.tokens_saida), 0) as tokens_saida
  from public.uso_modelo u
  where u.ts >= p_desde
  group by u.tenant_id, u.modelo;
$$;

-- Mesmo portão do resto: só service role (a página /admin já confirmou que
-- quem pediu é o dono da plataforma ANTES de usar a service key — ver
-- lib/admin-guard.ts). `authenticated` não chega aqui.
revoke all on function public.uso_por_tenant(timestamptz) from public;
grant execute on function public.uso_por_tenant(timestamptz) to service_role;
