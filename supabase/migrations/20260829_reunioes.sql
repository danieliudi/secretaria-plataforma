-- Reuniões: a pessoa grava no gravador NATIVO do celular, compartilha com a
-- Mia (PWA como share target do Android), e recebe de volta uma ata com o que
-- ficou decidido e quem falou o quê.
--
-- Por que o áudio NÃO passa pelo nosso servidor: função da Netlify aceita no
-- máximo 6 MB de corpo de requisição, e uma hora de gravação de celular dá
-- 30-60 MB. O navegador sobe direto pro Storage (service worker + upload
-- autenticado), e o servidor só recebe o CAMINHO do objeto. Ver
-- public/sw.js e app/api/reunioes/registrar/route.ts.
--
-- Provedor de transcrição+diarização: AssemblyAI, escolhido em 29/08/2026
-- depois de comparar com self-host de pyannote. A economia do self-host era
-- de ~US$ 0,10/hora de áudio e custaria uma peça de infra com GPU que a
-- stack (Deno + Next) não tem onde rodar. O código fica atrás da interface
-- _shared/diarizacao.ts justamente pra essa troca ser um arquivo, não um
-- retrabalho, se o volume um dia justificar.

-- ── Quem é o tenant do usuário logado ────────────────────────────────────────
--
-- SECURITY DEFINER porque `public.tenants` tem RLS que nega tudo pra
-- `authenticated` (só service_role lê). Sem isto, uma policy de storage que
-- consultasse `tenants` diretamente nunca casaria — a subquery voltaria vazia
-- pro próprio dono da linha.
--
-- Seguro apesar do DEFINER: a função é fechada em `auth.uid()`, não aceita
-- parâmetro nenhum. Não existe entrada que faça ela devolver o tenant de
-- outra pessoa. `search_path` fixo pra ninguém conseguir plantar uma tabela
-- `tenants` num schema que venha antes no path.
create or replace function public.tenant_id_do_usuario()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id from public.tenants t where t.auth_user_id = auth.uid();
$$;

revoke all on function public.tenant_id_do_usuario() from public;
grant execute on function public.tenant_id_do_usuario() to authenticated, service_role;

-- ── Tabela ───────────────────────────────────────────────────────────────────
create table public.reunioes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Mesmo formato de user_id do resto da base (remoteJid do WhatsApp ou
  -- 'tg:<chatId>'): é por ele que a ata é ENTREGUE de volta. Fica null
  -- enquanto a pessoa não tem canal ligado — aí a ata só aparece na tela.
  user_id text,

  -- Ciclo de vida. Uma linha só anda pra frente:
  --   enviando     → row criada, navegador ainda subindo o arquivo
  --   pendente     → arquivo no Storage, esperando o cron submeter
  --   transcrevendo→ job criado no provedor, esperando ficar pronto
  --   entregue     → ata gerada e mandada pro canal
  --   erro         → falhou; `erro` diz o quê (sem conteúdo de áudio)
  status text not null default 'enviando'
    check (status in ('enviando', 'pendente', 'transcrevendo', 'entregue', 'erro')),

  -- Caminho dentro do bucket 'reunioes'. SEMPRE '<tenant_id>/<id>.<ext>' — é
  -- o primeiro segmento que a policy de storage compara com o tenant de quem
  -- está subindo. Null depois que o áudio é apagado pela retenção.
  audio_path text,
  audio_tipo text,
  audio_bytes bigint,

  -- Identificação do job no provedor de diarização. `provider` é gravado
  -- junto de propósito: quando trocarmos de provedor, as linhas antigas
  -- continuam explicando de onde vieram.
  provider text,
  provider_job_id text,

  titulo text,
  -- Transcrição corrida e os turnos ({falante, texto, inicio_ms, fim_ms}).
  -- CONTEÚDO SENSÍVEL: fala de terceiros que não necessariamente sabem que
  -- foram gravados. Nunca vai pra log, nunca sai em mensagem de erro.
  transcricao text,
  turnos jsonb,
  -- Ata gerada pelo modelo a partir dos turnos.
  ata text,

  duracao_seg int,
  -- Custo em dólar desta reunião no provedor de diarização. Fica aqui, e não
  -- em `uso_modelo`, porque aquela tabela é medida em TOKENS — áudio é medido
  -- em hora e não cabe nas colunas dela sem mentir no significado. O /admin
  -- soma as duas fontes no mesmo painel.
  custo_usd numeric(10, 4),

  erro text,
  tentativas int not null default 0,

  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  entregue_em timestamptz,
  audio_apagado_em timestamptz,

  -- Tetos contra degeneração e contra payload hostil que tenha passado pela
  -- validação da rota (mesmo padrão de resumos_diarios / despesas).
  constraint reunioes_titulo_tamanho check (titulo is null or length(titulo) <= 200),
  constraint reunioes_transcricao_tamanho check (transcricao is null or length(transcricao) <= 400000),
  constraint reunioes_ata_tamanho check (ata is null or length(ata) <= 20000),
  constraint reunioes_erro_tamanho check (erro is null or length(erro) <= 500)
);

-- Consulta dominante do cron: "quais reuniões deste tenant estão em aberto".
create index reunioes_tenant_status_idx on public.reunioes (tenant_id, status);
-- Consulta do pré-filtro de elegíveis (quem tem trabalho pendente agora) e da
-- retenção (quem tem áudio velho pra apagar).
create index reunioes_status_idx on public.reunioes (status) where status in ('pendente', 'transcrevendo');
create index reunioes_retencao_idx on public.reunioes (created_at) where audio_path is not null;
-- Listagem na tela.
create index reunioes_tenant_data_idx on public.reunioes (tenant_id, created_at desc);

-- Sem policy, de propósito: só service role (edge functions e rotas do Next
-- com service client) acessa. Mesmo padrão de despesas/resumos_diarios/
-- uso_modelo. As telas leem via Server Component com service client DEPOIS de
-- resolver a identidade pela sessão — nunca por id vindo do navegador.
alter table public.reunioes enable row level security;

create or replace function public.reunioes_toca_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger reunioes_atualizado_em
  before update on public.reunioes
  for each row execute function public.reunioes_toca_atualizado_em();

-- ── Bucket do áudio ──────────────────────────────────────────────────────────
--
-- PRIVADO. O provedor de diarização nunca recebe o objeto: recebe uma URL
-- ASSINADA de vida curta, gerada pelo cron com a service role. Assim o áudio
-- não fica publicamente endereçável em momento nenhum.
--
-- 200 MB por arquivo ≈ 3h de gravação de celular em m4a. O limite global do
-- projeto ainda vale por cima deste — se ele for menor, o upload falha com
-- erro claro do próprio Storage em vez de cortar o arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reunioes',
  'reunioes',
  false,
  209715200,
  array[
    'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
    'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/webm',
    'audio/3gpp', 'audio/amr', 'video/mp4'
  ]
)
on conflict (id) do nothing;

-- Escrita: cada pessoa só escreve DENTRO da pasta do próprio tenant. O nome
-- do objeto é '<tenant_id>/<uuid>.<ext>' e a policy compara o primeiro
-- segmento — sem isso, um usuário autenticado poderia gravar na pasta de
-- outro cliente só mudando o caminho no `upload()`.
create policy "reunioes: sobe só na pasta do próprio tenant"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reunioes'
    and public.tenant_id_do_usuario() is not null
    and (storage.foldername(name))[1] = public.tenant_id_do_usuario()::text
  );

-- Leitura: mesma regra. Na prática as telas nem usam (a ata é texto, o áudio
-- não é oferecido pra download), mas deixar sem policy de select tornaria
-- impossível pro dono conferir o próprio arquivo mais tarde sem abrir uma
-- brecha maior depois, às pressas.
create policy "reunioes: lê só a pasta do próprio tenant"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'reunioes'
    and public.tenant_id_do_usuario() is not null
    and (storage.foldername(name))[1] = public.tenant_id_do_usuario()::text
  );

-- Sem policy de update/delete pra `authenticated`: apagar é responsabilidade
-- da retenção automática (cron, service role), não do navegador.

-- ── Custo de reunião por tenant (painel /admin) ──────────────────────────────
--
-- Agregação no BANCO, não em JS, pelo mesmo motivo documentado em
-- 20260829_uso_por_tenant.sql: somar em JS exige baixar uma linha por
-- registro, e o supabase-js corta em 1000 linhas SEM ERRO — o número ficaria
-- menor que a realidade sem ninguém perceber.
--
-- Sem `security definer` (roda como quem chama, que é sempre o service role,
-- igual à uso_por_tenant).
create or replace function public.custo_reunioes_por_tenant(p_desde timestamptz)
returns table (tenant_id uuid, reunioes bigint, custo_usd numeric)
language sql
stable
as $$
  select r.tenant_id, count(*)::bigint, coalesce(sum(r.custo_usd), 0)::numeric
  from public.reunioes r
  where r.created_at >= p_desde
    and r.status = 'entregue'
  group by r.tenant_id;
$$;

revoke all on function public.custo_reunioes_por_tenant(timestamptz) from public;
grant execute on function public.custo_reunioes_por_tenant(timestamptz) to service_role;
