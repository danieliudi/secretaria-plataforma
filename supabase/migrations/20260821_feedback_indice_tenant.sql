-- Índice por tenant pro teto de frequência do feedback.
--
-- A tabela nasceu (20260821_feedback.sql) só com o índice parcial da varredura
-- do cron, que é liderado por `criado_em`. Os dois caminhos de escrita passaram
-- a contar quantos relatos aquele tenant mandou na última hora / no último dia
-- antes de aceitar mais um — sem teto, uma conta sozinha inunda o WhatsApp do
-- dono, que é o número COMPARTILHADO da plataforma. Essa contagem é
-- `where tenant_id = ? and criado_em >= ?`, que o índice parcial não serve.
--
-- Também cobre a leitura óbvia de suporte ("o que essa conta já reportou"), e
-- o ON DELETE CASCADE do FK, que faz varredura por tenant_id ao remover um
-- tenant.

create index if not exists feedback_tenant_criado_idx
  on public.feedback (tenant_id, criado_em desc);
