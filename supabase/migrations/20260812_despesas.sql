-- Despesas / reembolso estruturado.
--
-- Motivação (dado real de produção): o usuário fotografa nota fiscal, a visão
-- descreve ("Estacionamento FISPAL 15/06/26 - R$ 400,00") e isso virava TEXTO
-- SOLTO em quick_capture. No fim do mês ele pedia "me ajuda a organizar o
-- reembolso desse mês" e não dava pra somar nem exportar — o valor ali é
-- sequência de caracteres, não número. Esta tabela guarda o dado estruturado.
--
-- Multi-tenant desde o dia 1 (diferente de quick_capture/health_log, que
-- nasceram globais e precisaram de backfill depois): tenant_id NOT NULL, sem
-- default, sem fallback pro dono da plataforma.

create table public.despesas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Quem registrou, no formato de user_id do canal (remoteJid ou tg:<chatId>).
  -- Guardado pra quando um tenant tiver mais de uma pessoa lançando despesa.
  user_id text,

  -- Dinheiro em INTEIRO (centavos). Float arredonda errado em soma de moeda —
  -- 0.1 + 0.2 != 0.3 em ponto flutuante, e isto aqui vira relatório de reembolso.
  valor_centavos integer not null,

  -- A data DO RECIBO, não a de quando a foto foi mandada (o usuário manda notas
  -- atrasadas — ver histórico de junho/2026, recibo do dia 15 mandado no dia 19).
  data_despesa date not null,

  estabelecimento text not null,
  categoria text,
  frente text,

  -- Descrição original que a visão gerou, pra auditar quando um valor parecer
  -- estranho. É entrada não confiável (OCR) — daí o limite de tamanho.
  origem_texto text,

  status text not null default 'pendente',
  fechado_em timestamptz,
  created_at timestamptz not null default now(),

  -- Sanidade contra erro de leitura de OCR: vírgula/ponto trocados viram valores
  -- absurdos. Teto de R$ 1.000.000,00 por despesa; abaixo de 1 centavo não existe.
  constraint despesas_valor_plausivel
    check (valor_centavos > 0 and valor_centavos <= 100000000),
  constraint despesas_status_valido
    check (status in ('pendente', 'fechada')),
  -- Limites de tamanho: tudo isto vem de texto de OCR/modelo, tratado como hostil.
  constraint despesas_tamanhos
    check (
      length(estabelecimento) <= 200
      and (categoria is null or length(categoria) <= 80)
      and (frente is null or length(frente) <= 80)
      and (origem_texto is null or length(origem_texto) <= 2000)
    )
);

-- Consulta dominante: despesas de um tenant num mês ("quanto tá o reembolso de
-- junho?", fechamento, exportação).
create index despesas_tenant_data_idx on public.despesas (tenant_id, data_despesa);
-- Fechamento e listagem de pendentes.
create index despesas_tenant_status_idx on public.despesas (tenant_id, status);

alter table public.despesas enable row level security;
-- Sem policy, de propósito: só service role (edge functions) acessa, mesmo
-- padrão de uso_modelo/uso_janela. RLS ligado sem nenhuma policy bloqueia
-- qualquer role que não bypasse RLS — anon e authenticated não leem nada.
