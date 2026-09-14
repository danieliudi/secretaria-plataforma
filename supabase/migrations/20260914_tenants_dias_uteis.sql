-- Dias em que a pessoa trabalha.
--
-- Antes disso a Mia falava três vezes por dia, todo dia: sábado de manhã ela
-- mandava o mesmo "☀️ sábado, 19/09 — 2 pra decidir" que mandaria numa terça.
-- Conferido em avisos_enviados: 24 envios de brief_do_dia em 12 dias, incluindo
-- sábado 12/09 e os domingos 06/09 e 13/09.
--
-- Índices iguais a getUTCDay(): 0 = domingo, 6 = sábado. Igual ao que
-- _shared/rotina.ts usa, e igual ao que o JavaScript devolve — um mapeamento
-- próprio aqui seria uma tradução a mais pra errar.
--
-- NULL é deliberado e diferente de '{1,2,3,4,5}': NULL significa "a pessoa
-- nunca disse", e o código cai no padrão seg–sex. Um DEFAULT aqui gravaria
-- uma resposta que ninguém deu, e depois não daria pra saber quem escolheu
-- seg–sex de verdade e quem só nunca foi perguntado.

alter table public.tenants
  add column if not exists dias_uteis smallint[];

-- O CHECK protege o consumo: array vazio silenciaria a secretária pra sempre,
-- e o sintoma seria ausência de mensagem — a falha que ninguém reporta.
-- rotina.ts também trata o caso, mas validação em dois lugares é de propósito:
-- o banco é a última linha.
alter table public.tenants
  drop constraint if exists tenants_dias_uteis_check;

alter table public.tenants
  add constraint tenants_dias_uteis_check check (
    dias_uteis is null
    or (
      -- CHECK só reprova em FALSE: NULL passa. Por isso as duas defesas abaixo
      -- existem, e por isso o coalesce.
      --
      -- `array_length('{}', 1)` devolve NULL, não 0 — sem o coalesce, array
      -- VAZIO entrava, e array vazio silenciaria a secretária pra sempre.
      -- `<@` com elemento NULL também devolve NULL, então '{1,NULL}' entrava.
      -- Os dois foram pegos avaliando o predicado no banco, não lendo o SQL.
      coalesce(array_length(dias_uteis, 1), 0) between 1 and 7
      and array_position(dias_uteis, null) is null
      and dias_uteis <@ array[0,1,2,3,4,5,6]::smallint[]
    )
  );

comment on column public.tenants.dias_uteis is
  'Dias da semana em que o tenant trabalha, índice = getUTCDay (0=domingo). NULL = nunca respondeu, o código usa seg–sex. Ver supabase/functions/_shared/rotina.ts.';
