# Lições

Por que cada regra do `CLAUDE.md` existe. Uma entrada por erro real, com data e
a regra que nasceu dela.

Este arquivo **cresce**; o `CLAUDE.md` não. É exatamente essa separação que
mantém o contrato pequeno o bastante pra ser lido em toda sessão. Entrada nova
vai no topo da seção que corresponde.

Regra 6 do contrato: afirmação errada que chegou a mudar uma decisão, ou bug que
a sessão introduziu e descobriu depois, entra aqui — não morre no histórico da
conversa.

---

## Regra 4 — verde não é prova

### 03/09/2026 · o stub de asserção não verificava nada

O proxy do sandbox bloqueia `deno.land`, então a suíte roda com um import-map
que substitui `https://deno.land/std@0.224.0/assert/mod.ts` por um stub local.
Esse stub tinha corpo **vazio** em todas as funções:

```ts
export function assert(_c: unknown, _m?: string): void {}
export function assertEquals(_a: unknown, _b: unknown, _m?: string): void {}
```

Cada teste rodava até o fim sem estourar e reportava `ok`. Pegava crash, nunca
valor errado. Toda vez que uma sessão disse "389 testes passando" neste
repositório, a afirmação era vazia.

Só apareceu porque o CI reprovou uma asserção que passava localmente. Sem o
disparo manual do `testes.yml`, teria ido pro merge com a cegueira intacta.

Depois de reescrever o stub com implementações reais, a conta fechou: **dos 389,
só 1 estava passando falso** — o que a própria sessão tinha escrito naquela
manhã. Os outros 388 sempre verificaram.

**Regra derivada:** rodar `testes.yml` no CI antes de afirmar que passou. E o
princípio maior — build verde prova ausência de erro de sintaxe, não presença do
que foi pedido.

### 01/09/2026 · typecheck local não replica o do CI

O commit `372823b0` quebrou o CI com 6 erros de tipo. O baseline local usa
`--no-check` e um import-map de stub, que não pega o que o CI pega.

---

## Regra 5 — afirmação carrega a origem

### 04/09/2026 · "prazo hoje 8h30" sobre uma tarefa sem prazo nenhum

A Erika pediu "Procurar bolo para hj às 8:30". A tarefa nasceu no Notion só com
o título — nenhuma propriedade — e a resposta foi "Criado! A tarefa tá no
Notion — 'Procurar bolo', prazo hoje 8h30".

Duas falhas empilhadas. O `createTask` do notion-provider fazia
`if (input.due_date && schema.dueProp)`: sem coluna de data no database, o prazo
era descartado **em silêncio**. O `rescheduleTask`, no mesmo arquivo, já recusava
alto pelo mesmo motivo — só o criar engolia. E a confirmação leu o PEDIDO em vez
da ESCRITA: o retorno da tool já trazia `due_date: null`, e o modelo repetiu de
volta a data que a usuária tinha acabado de digitar.

**Regra derivada:** ao confirmar uma escrita, o fato dito sai do RETORNO, não do
argumento. O `/fast` agora compara os dois no `create_task` e devolve
`prazo_nao_salvo` quando divergem — checagem genérica, vale pros seis
gerenciadores. E provider que não consegue gravar um campo pedido diz isso; não
descarta calado.

### 03/09/2026 · "🔴 Prazos vencidos" sobre tarefas com 10 horas pela frente

Às 14:00 chegaram três bolhas seguidas, e a vermelha dizia que três tarefas da
Resibag tinham vencido "03/09, 09:00". Nenhuma tinha vencido, e ninguém marcou
09:00 nenhum.

`msDoPrazo` ancora prazo-só-data ao meio-dia UTC pra acertar o DIA — correto, e
necessário (ver a lição de 02/09 sobre o dia andando pra trás). O resto do
código passou a tratar a âncora como se fosse o prazo: `t.dueMs < now`. Meio-dia
UTC é 09:00 em São Paulo, então toda tarefa "vence dia 3" virava vencida às
09:01 e exibia um horário que não existia.

**Regra derivada:** data e instante não são a mesma coisa. Prazo só-com-data
acaba às 23:59:59,9 daquele dia no fuso do usuário (`fimDoPrazoMs`), e não se
imprime hora que o dado não tem (`fmtPrazo`) — mesma regra do "Dia todo" da
agenda.

### 02–03/09/2026 · "quinta" gravado como sexta

Às 20:40 de 02/09 (uma quarta) a secretária escreveu *"Relatório da AGCO →
quinta, Plano de vendas → quinta, Skills Resibag → sexta"* e gravou
`2026-09-04`, `2026-09-04` e `2026-09-05` — sexta, sexta e **sábado**. Três de
três, sempre um dia à frente, e uma caindo em fim de semana sem aviso.

Não foi confabulação: o `updated_at` das três linhas é 20:40:34–36, a tool rodou
e gravou o que recebeu. Foi a conta data→dia-da-semana, feita de cabeça. E não
faltava informação: o prompt já dizia `Agora: quarta-feira, 02/09/2026`.

**O que tornava invisível** é uma assimetria: a MENSAGEM carrega o nome do dia,
o BANCO carrega a data, e nada comparava os dois. O chefe lê a palavra e nunca
vê a data; o resumo da manhã lê a data e nunca vê a palavra. O erro apareceu 10
horas depois.

Em 03/09 08:10 o mesmo aconteceu com a Erika, em outra tool (`update_event`):
pediu sexta, foi pro sábado.

**Não era fuso.** Erro de fuso neste código anda pra trás (data pura lida como
meia-noite UTC vira o dia anterior em SP — era o bug do `msDoPrazo`). Estes
andavam +1.

**Correção:** calendário de 14 dias no bloco volátil do prompt (tira a conta) +
`_shared/dia-semana.ts`, que anexa `<chave>_dia_semana` a todo retorno de tool
no ponto único onde ele vira `tool_result` (torna a divergência visível na hora).

### 02/09/2026 · "o Notion não está integrado" — estava

A Erika ouviu três vezes que a integração não existia, com o database criado e
funcionando. Causa: `tenants.frentes` estava vazio enquanto o bloco do provider
no MESMO system prompt dizia "Frentes com Notion configurado: geral". O modelo
resolveu a contradição pro lado errado e dobrou a aposta.

### 01/09/2026 · "Tinha 1 coisa hoje", havia 4

`new Date("2026-09-01")` é meia-noite UTC, que em São Paulo é 31/08. Todo prazo
só-data era lido um dia antes. Corrigido com `msDoPrazo`, que ancora ao meio-dia
UTC — longe das duas bordas do dia em qualquer fuso do Brasil.

### 03/09/2026 · "Fechou sem você: Audible, Samsung, Cinemark…"

Onze nomes de newsletter apresentados como coisas resolvidas. A leitura de
e-mail do brief usava `in:inbox` sem filtro, e numa manhã qualquer a caixa é
quase toda promoção. Passou a cortar `promotions` e `social`. `updates` fica
**fora** do corte de propósito: é onde o Gmail joga confirmação de pedido junto
com notificação de deploy, e e-mail real sumindo em silêncio é pior que ruído.

---

## Regra 6 — erro da sessão vira regra

### 04/09/2026 · desdisse uma recomendação certa por acreditar num alarme falso

Ao analisar as mensagens de 03/09 eu escrevi, com todas as letras, que tinha
errado ao deixar tarefa fora da mensagem das 13:00 — "três prazos morreram às
09:00 e a mensagem os ignorou". Cheguei a chamar de "recomendação minha e está
errada", e o passo seguinte seria mudar o desenho.

Não tinha morrido nenhum. Eu li o "venceu 03/09, 09:00" da própria mensagem da
Mia como se fosse dado, quando era o sintoma do bug que eu estava investigando.
A recomendação original estava certa; quem mentia era o alerta.

**Regra derivada:** ao diagnosticar a partir de uma saída suspeita, não use
outro campo da mesma saída como fato. O que a mensagem errada afirma é
justamente o que está sob suspeita — a conferência tem que vir do código ou do
banco. Foi rodar `fimDoPrazoMs` contra o relógio daquele momento que mostrou as
10 horas restantes.

### 03/09/2026 · o pin do CLI e a saída que eu não conhecia

Propus fixar a versão do Supabase CLI depois de um deploy falhar por rate limit.
Só ao ler o `action.yml` do `@v1` descobri que a action aceita `github-token`,
feito exatamente pra isso — ou seja, havia uma segunda saída que o Daniel não
tinha quando decidiu. Foi dito a ele antes de seguir.

Mantido o pin, por um motivo que o token não cobre: aqui merge na main é deploy
em produção, e `latest` deixa uma release nova do CLI entrar nesse caminho sem
ninguém ter mudado uma linha.

### 01/09/2026 · "um segundo projeto Supabase é grátis" — não é

Afirmação errada que mudaria a decisão. Custa US$ 10/mês. **Regra: rodar
`get_cost` antes de afirmar preço, e `get_cost` exige a organização** — o custo
varia por org.

### 02/09/2026 · "o trigger das 3h vai disparar" — já tinha disparado

Afirmado sem conferir. A resposta do delete mostrou `ended_reason:
run_once_fired`.

---

## Regra 7 — identificador é contrato

### 02/09/2026 · a frente fantasma

Quem terminava o wizard sem declarar frente ganhava uma lista `geral` no
provider, mas o nome nunca era gravado em `tenants.frentes`. As duas fontes
passavam a se contradizer dentro do mesmo system prompt. O nome da frente é
chave do `list_map` — não é rótulo.

---

## Regra 1 — mockup antes de construir

### 02/09/2026 · o brief que piorou tentando melhorar

A v1 do resumo da manhã tinha 944 caracteres contra 567 da versão em produção.
O mockup existia justamente pra isso aparecer antes do código. Medido com
`len()`, cinco cortes identificados (quatro eram repetição pura), v2 saiu com
414.

**Corolário:** mockup de interface desenhado de memória erra o que a tela já é.
Ler o componente e os tokens reais antes faz parte de fazer o mockup.

---

## Armadilhas de infraestrutura

Resumidas no `CLAUDE.md`; o detalhe fica aqui.

- **`verify_jwt`** — o gateway da Supabase valida o JWT antes de qualquer linha
  nossa. Chaves no formato novo (`sb_secret_...`) não são JWT e nunca passam.
  Por isso `supabase/config.toml` é versionado: um redeploy sem ele resetaria o
  valor e derrubaria `/fast`, `/cron` e `/telegram` de uma vez.
- **Secret do Google OAuth em 3 lugares** — Auth Provider (Supabase), secret das
  Edge Functions, env var do Netlify. Divergência dá `invalid_client`, que não
  diz qual dos três está errado.
- **`NEXT_PUBLIC_*`** — lido em tempo de build. Mudar no Netlify sem novo deploy
  não tem efeito nenhum, e o sintoma é a variável "não ter sido salva".
- **pg_cron e o Vault** — a service-role key é lida em execução, nunca embutida
  no `cron.job.command`. Embutida, rotacionar a chave quebraria os 22 jobs em
  silêncio.
- **`--prune` precisa de `--yes`** — sem stdin, o prompt `[y/N]` trava e o job
  falha *depois* de já ter feito o deploy: o estado fica certo e o CI vermelho.
- **`supabase/setup-cli` com `version: latest`** — consulta a API do GitHub a
  cada deploy, sem autenticação, e os runners dividem faixa de IP. Derrubou o
  deploy do merge do PR #32 com `rate limit exceeded`. Versão fixa desde
  03/09/2026.
- **Fuso fixo em `America/Sao_Paulo`** — hardcoded pra todos os tenants
  (`todayISOInSP`, `nowInSaoPaulo`, `calendarioProximosDias`, e a linha
  "Timezone do usuário" do prompt). Não é bug enquanto todos estão no Brasil, e
  o Brasil não tem horário de verão desde 2019. É o limite pro primeiro tenant
  fora daqui.
