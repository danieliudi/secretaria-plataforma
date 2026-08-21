-- Telegram é o único canal sem trava de unicidade em quem pode se vincular.
-- WhatsApp (whatsapp_authorized_number) e Teams (teams_authorized_user_id) já
-- têm UNIQUE; telegram_authorized_chat_id não tinha.
--
-- O chat_id do Telegram é o id da CONTA da pessoa, não do bot — cada tenant
-- tem bot próprio, mas a mesma pessoa podia vincular o mesmo Telegram a dois
-- tenants diferentes sem nada no banco impedir. Achado da auditoria de
-- multi-tenant de 20/08/2026, com evidência concreta de que esse EXATO padrão
-- de bug já aconteceu em produção num canal diferente (um JID de WhatsApp com
-- linhas de conversation_history sob dois tenants distintos).
--
-- `authorizeTelegramChatId` (_shared/tenant.ts) já foi ajustada pra tratar a
-- violação desta constraint como recusa silenciosa (mesmo formato de retorno
-- de "perdeu a corrida"), não como erro — nenhuma mudança de comportamento
-- pro caminho feliz.

create unique index if not exists tenants_telegram_chat_id_unico
  on public.tenants (telegram_authorized_chat_id)
  where telegram_authorized_chat_id is not null;
