-- Memória editável: as "instruções" que o usuário escreve pra secretária.
--
-- POR QUE ISTO EXISTE, além do `user_profile` que já temos:
--
-- O perfil é memória AUTOMÁTICA — a Mia grava fatos curtos em silêncio e os 60
-- mais recentes entram no prompt de toda conversa. Funciona, mas tem dois
-- limites que nenhum ajuste resolve: o usuário nunca escreveu nada ali, e tudo
-- que entra é pago em cache write no prompt de TODA conversa (hoje, ~80% do
-- custo da plataforma). Uma memória que ele possa escrever de verdade não cabe
-- nesse formato — um texto de 1.200 caracteres sobre "como eu escrevo pra
-- cliente industrial" não pode estar em toda conversa.
--
-- A saída é a mesma das Skills do Claude, e é por isso que a tabela tem esta
-- forma: um ÍNDICE curto que está sempre visível (`nome` + `quando_usar`) e um
-- CORPO que só é lido quando a situação pede (`texto`, via tool). 20 instruções
-- custam ~480 tokens no prompt; o texto inteiro delas nunca é pago junto.
--
-- Decisão do Daniel (31/08/2026, opção A do mockup): esta camada CONVIVE com o
-- user_profile em vez de substituí-lo. O perfil automático segue exatamente
-- como está — gravado em silêncio, sempre no prompt, consolidado toda semana.
-- Cada fato ganha um caminho de saída ("virar instrução") na tela, e só o uso
-- real vai dizer se um dia o perfil vira redundante.
create table if not exists public.instrucoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Identidade estável: entra na URL da tela e é como o modelo pede o corpo
  -- (`abrir_instrucao`). Renomear o `nome` não muda o slug — instrução que o
  -- modelo aprendeu a abrir continua abrindo.
  slug text not null,

  -- As duas colunas do ÍNDICE. Ficam curtas porque são pagas em toda conversa.
  nome text not null check (length(nome) between 1 and 60),
  -- Vazio é permitido e significa RASCUNHO INCOMPLETO: sem gatilho a Mia não
  -- tem como saber quando abrir, então a instrução não pode ser ativada (ver
  -- o check de `ativo` abaixo).
  quando_usar text not null default '' check (length(quando_usar) <= 160),

  -- O CORPO. Só entra na conversa quando o gatilho bate.
  texto text not null default '' check (length(texto) <= 6000),

  -- Default FALSE de propósito: instrução ativa muda toda resposta futura, e
  -- é o único jeito de garantir que uma proposta da Mia nasça inerte.
  ativo boolean not null default false,

  -- 'escrita' = o usuário criou; 'proposta' = a Mia redigiu depois de notar um
  -- padrão. A origem sobrevive à edição — saber que o texto começou com ela
  -- muda o quanto se confia nele quando algo sair estranho.
  origem text not null default 'escrita' check (origem in ('escrita', 'proposta')),

  -- Contadores em vez de tabela de eventos: o que o usuário precisa saber é se
  -- o GATILHO está funcionando ("nunca usada" = `quando_usar` estreito demais,
  -- não texto errado). Total + última vez respondem isso sem uma tabela que
  -- cresce pra sempre e precisa de limpeza.
  usos integer not null default 0,
  ultimo_uso timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (tenant_id, slug),

  -- Instrução ativa PRECISA de gatilho e de corpo. Sem isso ela ou nunca abre,
  -- ou abre pra não dizer nada — e nos dois casos o usuário culparia o modelo.
  constraint instrucao_ativa_completa check (
    not ativo or (length(trim(quando_usar)) > 0 and length(trim(texto)) > 0)
  )
);

-- O índice do prompt: só as ativas, sempre na mesma ordem (a ordem entra no
-- prompt, e ordem instável quebraria o cache do prompt a cada conversa).
create index if not exists instrucoes_indice_idx
  on public.instrucoes (tenant_id, nome)
  where ativo;

create index if not exists instrucoes_tenant_idx
  on public.instrucoes (tenant_id, atualizado_em desc);

-- `atualizado_em` é "quando o USUÁRIO editou", e é isso que a tela mostra.
-- Sem a guarda abaixo, o contador de uso (que também é um UPDATE nesta tabela)
-- empurraria a data toda vez que a Mia abrisse a instrução — a tela passaria a
-- dizer "editada hoje" sobre um texto que ninguém toca há um mês.
create or replace function public.instrucoes_toca_atualizado_em()
returns trigger language plpgsql as $$
begin
  if new.nome is distinct from old.nome
     or new.quando_usar is distinct from old.quando_usar
     or new.texto is distinct from old.texto
     or new.ativo is distinct from old.ativo
     or new.slug is distinct from old.slug then
    new.atualizado_em = now();
  end if;
  return new;
end;
$$;

drop trigger if exists instrucoes_atualizado_em on public.instrucoes;
create trigger instrucoes_atualizado_em
  before update on public.instrucoes
  for each row execute function public.instrucoes_toca_atualizado_em();

-- RLS ligado SEM policy: mesma postura de `reunioes`. Todo acesso passa por
-- service_role dentro das edge functions e das rotas do Next, que checam a
-- sessão e o tenant antes. Sem policy, qualquer leitura pelo browser volta
-- vazia — falha pro lado seguro.
alter table public.instrucoes enable row level security;

comment on table public.instrucoes is
  'Memória editável pelo usuário, no modelo das Skills: nome+quando_usar sempre no prompt, texto sob demanda.';
comment on column public.instrucoes.ativo is
  'FALSE por default. A Mia pode CRIAR uma instrução (origem=proposta), nunca ativar — ativar é sempre do usuário.';

-- Contador de uso: RPC em vez de read-modify-write no cliente. Duas conversas
-- abrindo a mesma instrução ao mesmo tempo perderiam uma contagem no caminho
-- de ida e volta, e é justamente esse número que o usuário olha pra decidir se
-- o `quando_usar` está pegando ou não.
create or replace function public.instrucao_registra_uso(
  p_tenant_id uuid,
  p_slug text
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.instrucoes
     set usos = usos + 1,
         ultimo_uso = now()
   where tenant_id = p_tenant_id
     and slug = p_slug;
$$;

revoke all on function public.instrucao_registra_uso(uuid, text) from public;
grant execute on function public.instrucao_registra_uso(uuid, text) to service_role;
