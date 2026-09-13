-- Quantas pessoas iam falar na reunião.
--
-- POR QUE UMA COLUNA, e não um palpite do código: é o único dado da
-- transcrição que NÃO dá pra deduzir do arquivo. Quem estava na sala sabe;
-- ninguém depois sabe. Vira `speakers_expected` no AssemblyAI, que hoje não
-- mandamos — e sem ele o modelo adivinha quantas vozes existem. Em áudio de
-- sala ele adivinha PRA MAIS: a mesma pessoa muda de tom e vira duas, e a ata
-- sai com "Falante 5" que nunca existiu.
--
-- NULL É VÁLIDO e é o padrão. Reunião que chegou pela folha de
-- compartilhamento (o caminho que existia antes da tela de gravação) não tem
-- como responder isso, e forçar um default seria pior que não mandar nada:
-- número errado obriga o modelo a espremer ou esticar as vozes pra caber numa
-- contagem que ninguém confirmou.
--
-- A faixa espelha MIN_PESSOAS/MAX_PESSOAS em _shared/diarizacao.ts. Duas
-- guardas pro mesmo valor de propósito: a rota valida o que veio do navegador,
-- e o banco recusa o que passar por qualquer outro caminho.
alter table public.reunioes
  add column if not exists pessoas_esperadas int;

alter table public.reunioes
  drop constraint if exists reunioes_pessoas_esperadas_faixa;

alter table public.reunioes
  add constraint reunioes_pessoas_esperadas_faixa
  check (pessoas_esperadas is null or (pessoas_esperadas between 2 and 20));

comment on column public.reunioes.pessoas_esperadas is
  'Quantas pessoas iam falar, informado por quem estava na sala. Vira speakers_expected no provedor de diarização. NULL = não informado (reunião vinda do compartilhamento), e aí o provedor decide sozinho.';
