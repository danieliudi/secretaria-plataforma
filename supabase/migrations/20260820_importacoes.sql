-- Importação de dados de ferramentas externas (CRM/ERP/planilha do chefe),
-- via exportação manual: ele exporta um CSV da ferramenta que já usa e manda
-- pelo Telegram — sem OAuth, sem API key, sem webhook pra configurar.
--
-- Full-refresh por (tenant_id, origem): reimportar SUBSTITUI o conteúdo
-- anterior da mesma origem inteiro (upsert), nunca acumula duplicata. Mesmo
-- padrão que a base da Sanwey_crm usa pra reprocessar cargas de dado externo
-- (tabela rapp_cargas) — reenviar o mesmo arquivo é "atualizar", não "somar".
--
-- `origem` é derivado do nome do arquivo (slug), sem perguntar nada ao chefe
-- antes de guardar — qualquer pergunta bloqueante ali reintroduziria a
-- fricção que este desenho inteiro existe pra evitar.
--
-- `linhas` fica cru em jsonb (sem schema fixo): cada ferramenta exporta
-- colunas diferentes, e não há como prever todas com antecedência. Quem
-- cruza/soma/filtra é o modelo, lendo os dados na hora — por isso o teto de
-- linhas por importação é generoso o bastante pra análise, mas não ilimitado.
--
-- Multi-tenant desde o dia 1, mesmo padrão de despesas/contatos: tenant_id
-- NOT NULL, sem default, sem fallback pro dono da plataforma.

create table public.importacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Slug derivado do nome do arquivo (ver origemDoNomeArquivo em
  -- fast/tools/importacao.ts), ex: "pipedrive_export_2026". Chave de
  -- reimportação junto com tenant_id.
  origem text not null,

  -- Nome original do arquivo, só pra contexto na resposta ("importei o
  -- pipedrive_leads.csv").
  nome_arquivo text not null,

  -- Cabeçalho do CSV, na ordem em que veio.
  colunas text[] not null,

  -- Linhas cruas, cada uma um objeto {coluna: valor}. Sem schema fixo de
  -- propósito (ver motivação acima).
  linhas jsonb not null,

  total_linhas integer not null,

  -- true quando o CSV tinha mais linhas do que o teto de importação — a
  -- resposta do modelo precisa avisar que analisou só uma parte.
  truncado boolean not null default false,

  importado_em timestamptz not null default now(),

  -- Tamanhos: nome do arquivo e origem vêm de um nome escolhido por quem
  -- exportou o CSV (não pelo chefe direto), tratado como hostil igual
  -- qualquer texto de terceiro. `total_linhas`/`linhas` respeitam o mesmo
  -- teto aplicado no parse (fast/tools/importacao.ts MAX_IMPORT_ROWS) — o
  -- check aqui é a segunda barreira, não a primeira.
  constraint importacoes_tamanhos
    check (
      length(origem) between 1 and 60
      and length(nome_arquivo) between 1 and 255
      and total_linhas >= 0
      and total_linhas <= 2000
      and jsonb_array_length(linhas) <= 2000
    )
);

-- Reimportar a mesma origem SUBSTITUI (upsert on conflict), nunca duplica.
create unique index importacoes_tenant_origem_idx
  on public.importacoes (tenant_id, origem);

-- Busca dominante quando o modelo não recebeu 'origem' (pega a importação
-- mais recente do tenant).
create index importacoes_tenant_recente_idx
  on public.importacoes (tenant_id, importado_em desc);

alter table public.importacoes enable row level security;
-- Sem policy, de propósito: só service role (edge functions) acessa, mesmo
-- padrão de despesas/contatos/uso_modelo. RLS ligado sem nenhuma policy
-- bloqueia qualquer role que não bypasse RLS — anon e authenticated não leem
-- nada. Dado importado é o mais sensível desta tabela toda (pode ser lista
-- de cliente, valor de negócio, dado de fornecedor de terceiro): o alvo mais
-- óbvio de vazamento entre tenants nesta base.
