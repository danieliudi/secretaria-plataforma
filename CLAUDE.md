# Regras de trabalho neste repositório

Estas regras valem **sempre**, mesmo quando a sessão está em modo automático.
Modo automático dá liberdade pra pesquisar, escrever e testar — não dá licença
pra decidir sozinho o rumo do produto nem pra entregar sem conferência.

## 1. Mockup antes de construir

Antes de implementar qualquer mudança de plataforma (tela, fluxo, texto que o
usuário lê, comportamento da secretária, mudança de dados), **mostre primeiro um
mockup do que vai ser feito**:

- **Visual** quando a mudança é de interface: layout em ASCII/markdown, HTML
  renderizável ou print — o que fizer a pessoa *ver* o resultado.
- **Só texto** quando a mudança é de comportamento ou de backend: descreva o
  antes/depois, o que muda pro usuário e o que muda no banco.

O mockup vem **antes** do código, não junto com a entrega. O objetivo é o Daniel
poder dizer "não é isso" enquanto ainda é barato mudar.

## 2. Perguntar com opções, não decidir sozinho

Quando houver mais de um caminho razoável, **traga as opções (A / B / C) com o
trade-off de cada uma e uma recomendação**, e espere a escolha. Não assuma o
caminho "óbvio" e siga.

Vale especialmente pra:

- arquitetura e escolha de dependência;
- qualquer coisa que custe dinheiro (modelo, API paga, infra);
- mudança irreversível ou destrutiva (migration que apaga, rotação de chave,
  remoção de tenant);
- tom de voz e texto que o usuário final lê.

Não vale pra detalhe mecânico interno (nome de variável, ordem de import,
formatação) — isso decide e segue.

## 3. Check de segurança antes de entregar

Depois de aprovado e executado, **antes de dizer que terminou**, rode um check
de segurança sobre tudo que foi mexido — código, comentários, migrations,
configuração. No mínimo:

- **Isolamento entre tenants** — toda query nova filtra por `tenant_id`/tenant?
  Nenhum caminho novo cai em tenant padrão por fallback?
- **Autenticação** — endpoint novo ou alterado exige `isInternalCall()`,
  `verify_jwt`, ou secret de webhook? Comparação de segredo é tempo constante?
- **Segredos** — nenhum valor real de chave em código, comentário, log, commit
  ou mensagem de chat. Segredo mora no Vault ou em env var; verificação só por
  fingerprint (tamanho + primeiros/últimos caracteres).
- **Dados pessoais em log** — nada de telefone, e-mail, `chat_id` ou conteúdo de
  mensagem em `async_debug` ou `console.log`.
- **Entrada não confiável** — payload de webhook, texto de usuário e resposta de
  API externa são tratados como hostis (validados, com limite de tamanho).
- **Portão de acesso** — funcionalidade paga/limitada respeita `aprovado_em`
  no backend, não só na tela.

Reporte o resultado do check junto com a entrega, inclusive quando não achar
nada ("check feito, nada encontrado" é um resultado válido). Se achar algo,
corrija antes de entregar ou aponte explicitamente o que ficou aberto e por quê.

---

# Contexto do projeto

Plataforma multi-tenant de uma secretária de IA. Next.js (Netlify) + Supabase
edge functions (Deno) + WhatsApp via Evolution API + Telegram. Tudo em pt-BR,
inclusive comentários de código.

## Fatos que já custaram caro pra descobrir

- **`verify_jwt` roda antes do código da função.** O gateway da Supabase valida
  o JWT antes de qualquer linha nossa. Chaves no formato novo (`sb_secret_...`)
  **não são JWT** e nunca passam. Funções que fazem a própria autenticação
  (`/fast`, `/cron`, `/telegram`) precisam de `verify_jwt = false` no
  `supabase/config.toml` — que é versionado justamente por isso.
- **O secret do Google OAuth vive em 3 lugares** e precisa ser idêntico nos
  três: Auth Provider (Supabase), secret das Edge Functions, env var do Netlify.
  Divergência entre eles dá `invalid_client` sem dizer qual está errado.
- **`NEXT_PUBLIC_*` é lido em tempo de build**, não de runtime. Mudar no Netlify
  exige novo deploy pra ter efeito.
- **pg_cron lê a service-role key do Vault** em tempo de execução, não embutida
  no `cron.job.command` — senão rotacionar a chave quebra todos os jobs.
- **`supabase functions deploy --prune` precisa de `--yes`** no CI: sem stdin o
  prompt `[y/N]` trava e o job falha *depois* de já ter feito o deploy.
