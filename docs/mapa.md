# Mapa da plataforma

O que existe e o que quebra sem cada peça. O `CLAUDE.md` é **como construir**;
este arquivo é **o que está construído**. Consulte antes de assumir que algo não
existe — e atualize aqui ao criar/remover função, rota ou job.

As contagens são verificadas por `npm run doc:check`, que recalcula a partir do
código e falha apontando a divergência. Fica **fora** do build de propósito:
documento defasado não deve travar deploy.

<!-- doc:check
edge_functions=7
paginas=15
rotas_api=9
migrations=33
testes=29
-->

## Edge functions (7)

Todas com `verify_jwt = false` em `supabase/config.toml` — cada uma faz a
própria autenticação (ver `_shared/internal-auth.ts`). O gateway da Supabase
valida o JWT **antes** do nosso código, e a service-role key no formato novo
(`sb_secret_...`) não é JWT: com `verify_jwt = true` nenhuma delas responderia.

| função | quem chama | quebra sem |
|---|---|---|
| `reflex` | n8n, ao chegar mensagem de WhatsApp | resolve o tenant e decide se responde direto ou delega ao `/fast`. Sem ela, WhatsApp fica mudo |
| `fast` | `reflex`, `cron` | o cérebro: loop de tool use (agenda, e-mail, tarefas, despesas, documentos). Sem ela não há resposta com ferramenta |
| `cron` | pg_cron (22 jobs) | tudo que a secretária manda sem ser perguntada — brief, meio do dia, fim do dia, lembretes, sinais |
| `telegram` | webhook do Telegram | canal Telegram inteiro |
| `wa-webhook` | Meta Cloud API | só para quem tiver `envio_oficial = true`. Hoje ninguém tem |
| `teams` | Bot Framework | canal Teams |
| `import-csv` | site (`/app`) | importação de planilha |

## Páginas (15)

Públicas: `/`, `/login`, `/precos`, `/funcionalidades`, `/novidades`,
`/privacidade`, `/termos`.
Com sessão: `/onboarding`, `/app`, `/app/memoria`, `/app/memoria/[slug]`,
`/app/reunioes`, `/app/reunioes/[id]`, `/app/reunioes/receber`, `/admin`.

`/admin` é a fila de aprovação de tenant — o portão `aprovado_em` é aplicado no
backend, não só ali.

## Rotas de API (9)

`/api/admin/aprovacao` · `/api/feedback` · `/api/instrucoes` ·
`/api/instrucoes/fato` · `/api/onboarding/channel` · `/api/onboarding/persona` ·
`/api/onboarding/task-provider` · `/api/reunioes/registrar` ·
`/api/reunioes/enviado`

## Jobs do pg_cron (22, todos ativos)

Horário em **UTC** — São Paulo é −3h. Cada job chama `/cron` com a service-role
key lida do Vault em execução (nunca embutida no comando).

| job | UTC | BRT | o que faz |
|---|---|---|---|
| `daily-brief` | `0 9 * * *` | 06:00 | resumo da manhã |
| `meio-do-dia` | `0 16 * * *` | 13:00 | pergunta o que passou pela manhã |
| `evening-recap` | `0 22 * * *` | 19:00 | fim do dia: tarefas, agenda, lembretes |
| `semana-a-frente` | `0 22 * * 0` | dom 19:00 | prévia da semana |
| `event-reminders` · `scheduled-reminders` · `prep-reuniao` · `reunioes` · `despesa-anomala` · `feedback-novo` | `*/5` | — | fila de 5 em 5 min |
| `conflito-agenda` | `*/30` | — | choque de agenda |
| `whatsapp-watchdog` | `*/10` | — | reconecta a instância caída |
| `ads-check` | `*/30 11-23` | — | Google Ads |
| `agenda-apertada` | `0 23 * * *` | 20:00 | aviso de dia cheio |
| `relacionamento-esfriando` | `0 13 * * *` | 10:00 | contato sem retorno |
| `lugar-novo` | `0 0 * * *` | 21:00 | — |
| `resumo-diario` | `10 3 * * *` | 00:10 | — |
| `reuniao-retencao` | `20 4 * * *` | 01:20 | limpeza de áudio |
| `tarefas-atrasadas` | `0 11 * * 1` | seg 08:00 | — |
| `marketing-review` | `0 12 * * 1` | seg 09:00 | — |
| `beehave-alerts` | `0 11,17 * * *` | 08:00 e 14:00 | — |
| `beehave-weekly` | `0 11 * * 1` | seg 08:00 | — |

## Antes de escrever módulo novo

`supabase/functions/_shared/` tem ~60 módulos e `providers/` tem 9. Rode `ls`
antes de criar — a chance de já existir é alta. Os que mais são reaproveitados:

`tenant` (resolve tenant e monta o env) · `internal-auth` (autenticação de
função) · `task-provider` + `task-provider-factory` (os 6 gerenciadores de
tarefa) · `dia-semana` (dia da semana de qualquer data, e o eco no retorno de
tool) · `log-seguro` (`semDadoPessoal`) · `uso` (registro de custo de modelo) ·
`http-retry` · `proactive-send` (entrega multi-canal com dedupe).

## Providers de tarefa (9 arquivos, 6 gerenciadores)

`clickup` · `notion` · `trello` · `google_tasks` · `microsoft_todo` ·
`sanwey_tasks` (só o dono da plataforma). Mais `assemblyai` (diarização) e os
dois do Outlook (calendar e mail).

Os valores acima têm **CHECK no banco** (`tenants_task_provider_check`) e são
chave do `list_map` — ver regra 7 do `CLAUDE.md`.

## Integrações externas

Anthropic · Google (Calendar, Gmail, Tasks, Ads, Analytics, TTS, OAuth) ·
Microsoft Graph (Outlook, To-Do, Teams) · Notion · Trello · ClickUp ·
AssemblyAI · Groq · Voyage · Evolution API (WhatsApp) · Telegram · Meta Graph ·
Banco Central (PTAX) · PNCP (editais) · Google News.

## Dois projetos Supabase

- `edaogdfeuxrylwqpopqe` — a plataforma (tenants, conversas, uso, lembretes).
- `adizvduyfzfftyswkijj` — sanwey-crm, onde vive `personal_tasks` (o provider
  `sanwey_tasks` lê de lá, via `PERSONAL_TASKS_AGENT_KEY`).

Não existe ambiente de teste: local, preview e produção apontam para o mesmo
projeto.
