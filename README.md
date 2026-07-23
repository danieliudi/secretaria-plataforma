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
     pra ela escolher pelo nome. Trello também busca (`trello-lists`), usando
     a API key própria da pessoa se ela colar uma, senão a `TRELLO_API_KEY`
     global do ambiente (ver "Setup local" abaixo) — sem nenhuma das duas,
     cai num textarea de fallback pra colar o mapa em JSON manualmente.
   * No passo do canal, se a pessoa escolher Telegram, o próprio onboarding
     chama o `setWebhook` da API do Telegram (`app/api/onboarding/channel`)
     apontando pra `.../functions/v1/telegram/<slug>` — o bot já sai
     funcionando, sem precisar de ninguém configurando isso manualmente. Se a
     chamada falhar (token errado, rede), o onboarding não trava — só avisa
     na tela de recibo que a ativação automática não rolou.

Depois disso o tenant já está pronto pro **backend** (edge functions do
`secretaria-agentic`) usar — só falta o WhatsApp, que ainda é conectado
manualmente (ver "Pendências" abaixo; Telegram já é automático, ver acima).

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
opcional — key compartilhada usada como fallback quando a pessoa não cola a
própria no wizard (developer.trello.com/docs/get-started); sem nenhuma das
duas, o wizard continua funcionando, só cai no textarea manual pro Trello.

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

* **WhatsApp ainda é manual** — o wizard não provisiona a instância Evolution
  API (precisa de número dedicado por tenant, linkado por QR code). Telegram
  já não tem esse problema: o onboarding registra o webhook do bot sozinho
  (ver "Como funciona" acima).
* Mapa de frentes só é JSON cru no fallback do Trello quando nem a API key
  própria nem a `TRELLO_API_KEY` global estão disponíveis (ClickUp, Notion e
  Google Tasks sempre têm UI guiada com busca automática).
* **Dependência de deploy**: este repo já lê/grava a coluna
  `tenants.trello_api_key_secret_id` (API key do Trello por tenant, em vez de
  só a global). Essa coluna é criada por uma migration no repo
  `secretaria-agentic` (branch `claude/trello-api-key-per-tenant`, ainda não
  aplicada em produção neste momento) — depende dela pra funcionar em
  produção; sem a coluna, os passos de persona/tarefas do onboarding quebram.

## Repositório

Este projeto é separado do `secretaria-agentic` (que tem as edge functions e
a migration que criou `tenants`/as RPCs de Vault) de propósito — front-end e
back-end evoluem e deployam independentes, compartilhando só o Supabase.
