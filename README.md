# secretaria-plataforma

Onboarding self-serve da secretária agêntica: login com Google, wizard de
configuração (persona + gerenciador de tarefas), grava tudo direto na mesma
base multi-tenant do projeto **secretaria-agentic** (tabela `tenants` +
Vault). Depois do wizard, a pessoa some com o próprio bot funcionando — nunca
vê nem baixa uma linha de código.

Next.js 16 (App Router, Turbopack) + Supabase Auth (`@supabase/ssr`). Atenção:
essa versão do Next tem convenções diferentes do usual — o antigo
`middleware.ts` virou `proxy.ts` (mesma API, `NextRequest`/`NextResponse`, só
o nome do arquivo e da função exportada mudou; ver comentário no topo do
arquivo).

## Como funciona

1. **`/login`** — botão "Entrar com Google". Pede login **e** os escopos de
   Calendar/Gmail/Tasks no mesmo consentimento (`access_type=offline` +
   `prompt=consent`, senão o Google não devolve `refresh_token`).
2. **`/auth/callback`** — troca o `code` pela sessão, garante a linha em
   `tenants` (`auth_user_id`) e grava o `refresh_token` do Google no Vault
   (`lib/tenant-provisioning.ts`).
3. **`/onboarding`** — wizard de 3 passos: persona (nome/cargo/frentes),
   gerenciador de tarefas (ClickUp/Notion/Trello/Google Tasks + token + mapa
   de frentes) e canal de conversa (WhatsApp/Telegram/ambos). Termina numa
   tela de recibo com um link "Editar configuração" que volta pro passo 1 —
   como cada passo faz upsert (não só insert), reabrir `/onboarding` depois
   (a raiz `/` já redireciona quem está logado pra lá) serve como tela de
   "gerenciar depois", com os campos pré-preenchidos do que já foi salvo.
   Cada passo chama uma API route (`app/api/onboarding/*`) que grava em
   `tenants` via **service role** (RLS de `tenants` hoje nega tudo pra
   `authenticated`; toda escrita passa por uma rota server-side que verifica
   a sessão antes).
   * ClickUp, Notion e Google Tasks buscam as listas/databases reais da
     pessoa (`app/api/onboarding/{clickup-lists,notion-databases,google-tasks-lists}`)
     pra ela escolher pelo nome. Trello também busca (`trello-lists`), mas
     depende de uma `TRELLO_API_KEY` global configurada no ambiente (ver
     "Setup local" abaixo) — sem ela, cai num textarea de fallback pra colar
     o mapa em JSON manualmente.

Depois disso o tenant já está pronto pro **backend** (edge functions do
`secretaria-agentic`) usar — só falta o canal (WhatsApp/Telegram), que ainda
é conectado manualmente (ver "Pendências" abaixo).

## Setup local

```bash
npm install
cp .env.local.example .env.local   # preencher com os valores abaixo
npm run dev
```

Valores de `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → Data API) e
`SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys → `service_role` —
nunca commitar, nunca usar num Client Component). `TRELLO_API_KEY` é
opcional — só habilita a busca automática de listas do Trello no passo 2 do
wizard (developer.trello.com/docs/get-started); sem ela o wizard continua
funcionando, só cai no textarea manual pro Trello.

## Setup externo pendente (obrigatório antes de qualquer login funcionar)

1. Habilitar o provider Google no Supabase Auth — Dashboard do projeto
   `secretaria-agentic` (`edaogdfeuxrylwqpopqe`) → Authentication → Sign In /
   Providers → Google. Importante: usar o MESMO Client ID/Secret que já está
   configurado como `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` nas edge
   functions — um `refresh_token` só é válido pra trocar por `access_token`
   sob o client OAuth que o emitiu. Usar um client diferente aqui quebra
   silenciosamente o acesso a Calendar/Gmail/Tasks depois.
2. Redirect URI no Google Cloud Console — no mesmo OAuth client acima,
   adicionar `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase
   expõe esse callback fixo) em "Authorized redirect URIs".
3. URL Configuration no Supabase Auth — Authentication → URL Configuration →
   Redirect URLs: adicionar a URL do deploy (Vercel) + `/auth/callback`, e
   `http://localhost:3000/auth/callback` pra desenvolvimento local.
4. Deploy na Vercel — importar este repositório, setar as 3 env vars acima
   nas configurações do projeto.

## Pendências conhecidas (não bloqueiam o piloto, mas documentar)

* Conexão do canal (WhatsApp/Telegram) ainda é manual. O wizard termina sem
  provisionar instância do WhatsApp nem bot do Telegram — isso é trabalho de
  infraestrutura (Evolution API precisa de número dedicado por tenant;
  Telegram precisa criar o bot via @BotFather e configurar o webhook
  `/telegram/<slug>`). Automatizar isso é o próximo passo grande desta
  plataforma.
* Trello precisa de 2 credenciais (API key da aplicação + token pessoal),
  mas `tenants` só tem 1 coluna de token por provider — o wizard grava o
  token pessoal; a API key (`TRELLO_API_KEY`) é global, compartilhada por
  todos os tenants (gap já documentado em
  `secretaria-agentic/docs/multi-tenant.md`). Não dá pra um tenant trazer a
  própria API key do Trello sem uma coluna nova em `tenants` — mudança que
  pertence à migration do `secretaria-agentic`, não a este repo.
* Mapa de frentes só é JSON cru no fallback do Trello quando `TRELLO_API_KEY`
  não está configurada (ClickUp, Notion e Google Tasks sempre têm UI guiada
  com busca automática; Trello também busca quando a key está configurada).

## Repositório

Este projeto é separado do `secretaria-agentic` (que tem as edge functions e
a migration que criou `tenants`/as RPCs de Vault) de propósito — front-end e
back-end evoluem e deployam independentes, compartilhando só o Supabase.
