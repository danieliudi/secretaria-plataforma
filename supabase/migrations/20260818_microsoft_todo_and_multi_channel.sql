-- Libera 'microsoft_todo' como task_provider válido (5º provedor de tarefas,
-- ao lado de clickup/notion/trello/google_tasks/sanwey_tasks).
ALTER TABLE public.tenants DROP CONSTRAINT tenants_task_provider_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_task_provider_check
  CHECK (task_provider = ANY (ARRAY['clickup'::text, 'notion'::text, 'trello'::text, 'google_tasks'::text, 'sanwey_tasks'::text, 'microsoft_todo'::text]));

-- channel_preference deixa de ser um enum fechado ('whatsapp'|'telegram'|'both')
-- pra virar texto livre com os canais escolhidos separados por vírgula (ex:
-- "whatsapp,teams") — o passo 3 do wizard virou múltipla escolha (WhatsApp,
-- Telegram, Teams, qualquer combinação), não faz mais sentido um enum fixo.
-- Nenhum caminho de código decide roteamento por esse valor — é só exibição
-- (cron/index.ts runNovosCadastros, app/admin) — quem autoriza de verdade é
-- cada coluna própria (whatsapp_authorized_number, telegram_authorized_chat_id,
-- teams_authorized_user_id).
ALTER TABLE public.tenants DROP CONSTRAINT tenants_channel_preference_check;
