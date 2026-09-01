-- Radar de sinais: em quais UFs procurar edital público, POR TENANT.
--
-- Nasce como coluna de tenant e não como constante no código de propósito. A
-- lista certa pro Daniel hoje (SP, MG, RS, RJ, PR) saiu da distribuição real
-- da carteira dele — 65% em SP, o resto concentrado em quatro estados. Isso é
-- dado DELE, não do produto. Chapar no código repetiria o mesmo erro do
-- "da Beehave (Resibag, Sanwey)" que já foi corrigido uma vez nos prompts:
-- o negócio do dono da plataforma vazando pra dentro de todo cliente.
--
-- Vazio (default) = radar de edital desligado pro tenant. Ninguém recebe
-- edital sem ter dito onde vende.
alter table public.tenants
  add column if not exists radar_ufs text[] not null default '{}'::text[];

comment on column public.tenants.radar_ufs is
  'UFs onde o tenant tem carteira, pra busca de edital no PNCP. Vazio = desligado.';

-- Formato validado no banco, não só na aplicação: é configuração que alguém
-- vai editar na mão pelo painel da Supabase, e "sp" ou "São Paulo" aqui
-- viraria uma requisição inútil por dia, pra sempre, sem erro visível.
alter table public.tenants
  drop constraint if exists tenants_radar_ufs_formato;
alter table public.tenants
  add constraint tenants_radar_ufs_formato
  check (
    radar_ufs <@ array[
      'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
      'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
    ]::text[]
  );

-- Teto de 8 UFs: cada uma é uma leitura paginada por dia, e a carteira que
-- justifica mais que isso é nacional — aí o corte por estado deixa de ser o
-- filtro certo e a conversa é outra.
alter table public.tenants
  drop constraint if exists tenants_radar_ufs_teto;
alter table public.tenants
  add constraint tenants_radar_ufs_teto
  check (array_length(radar_ufs, 1) is null or array_length(radar_ufs, 1) <= 8);
