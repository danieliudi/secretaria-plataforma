import Link from "next/link";
import { Logo } from "@/components/Logo";
import { BotaoEntrar } from "@/components/BotaoEntrar";

// Página pública e estática — texto legal. Ver app/privacidade/page.tsx pro
// mesmo padrão e contexto (conteúdo aprovado por mockup antes desta rota).
export default function TermosPage() {
  return (
    <main className="aurora-bg flex min-h-screen flex-col">
      <header className="bg-aurora-header-bg">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
          <Link href="/">
            <Logo variant="header" />
          </Link>
          <div className="flex items-center gap-6">
            <span className="text-[13.5px] font-semibold text-aurora-fg">Termos de Uso</span>
            <BotaoEntrar />
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-24 pt-6 md:pt-10">
        <div className="flex flex-col gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
            As regras do jogo
          </span>
          <h1 className="text-balance text-[32px] font-semibold leading-tight tracking-tight text-aurora-fg md:text-[38px]">
            Termos de Uso
          </h1>
          <span className="font-mono text-[12px] text-aurora-muted-2">Última atualização · 19 ago 2026</span>
          <p className="max-w-xl text-[15px] leading-relaxed text-aurora-muted">
            Ao usar a Mia — pelo site, WhatsApp, Telegram ou Teams — você concorda com o que está
            descrito aqui. É curto de propósito: leia até o fim, leva menos de 3 minutos.
          </p>
        </div>

        <div className="flex gap-3 aurora-card rounded-xl border border-aurora-line bg-aurora-surface p-5">
          <span className="mt-0.5 w-[3px] flex-none rounded-full bg-aurora-accent" />
          <p className="text-[13.5px] leading-relaxed text-aurora-muted">
            <strong className="font-semibold text-aurora-fg">Fase de teste:</strong> a Mia hoje é um
            projeto pessoal em teste gratuito com um grupo pequeno de convidados — não uma empresa com
            contrato de nível de serviço. Ela pode mudar, sair do ar por um tempo, ou ter acesso pausado
            sem aviso longo.
          </p>
        </div>

        <div className="flex flex-col gap-16">
          <Secao numero="01" titulo="O que é a Mia">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              A Mia é uma secretária de inteligência artificial que conversa por WhatsApp, Telegram e
              Microsoft Teams, cuidando de agenda, e-mail, tarefas e outras frentes que você configurar
              no cadastro. O acesso é liberado manualmente, pessoa por pessoa, enquanto durar esta fase.
            </p>
          </Secao>

          <Secao numero="02" titulo="Sua conta">
            <Item>Você entra com sua conta Google ou Microsoft — é assim que a gente confirma que é você.</Item>
            <Item>
              O acesso é aprovado manualmente; ele pode ser recusado, pausado ou encerrado a qualquer
              momento durante a fase de teste, especialmente em caso de uso abusivo.
            </Item>
            <Item>
              Existe um limite de mensagens por período — pra evitar abuso e manter o serviço estável
              pra todo mundo.
            </Item>
          </Secao>

          <Secao numero="03" titulo="Uso aceitável">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">Não use a Mia para:</p>
            <Item>Fins ilegais, ou pra tentar acessar dados de outra pessoa</Item>
            <Item>Enviar spam, sobrecarregar o sistema de propósito, ou tentar burlar o limite de uso</Item>
            <Item>Fazer engenharia reversa ou tentar extrair como o sistema funciona por dentro</Item>
          </Secao>

          <Secao numero="04" titulo="Ela é IA — e erra">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              A Mia pode entender errado, esquecer contexto, ou responder algo impreciso — é como
              qualquer assistente de IA. Não use ela como única fonte pra decisões críticas (saúde,
              dinheiro, prazos legais, compromissos que não podem falhar). Confira o que for importante.
            </p>
          </Secao>

          <Secao numero="05" titulo="Google, Microsoft e outros acessos">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Ao conectar sua conta Google ou Microsoft, você autoriza a Mia a acessar agenda, e-mail e
              tarefas conforme descrito na{" "}
              <Link href="/privacidade" className="text-aurora-accent-text underline">
                Política de Privacidade
              </Link>
              . Você pode revogar esse acesso a qualquer momento, direto nas configurações da sua conta
              Google ou Microsoft, ou desconectando pelo site.
            </p>
          </Secao>

          <Secao numero="06" titulo="Seu conteúdo é seu">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Você continua dono de tudo que manda pra Mia. A gente usa esse conteúdo só pra prestar o
              serviço pra você — não vendemos, não usamos pra treinar modelo de terceiro, não publicamos
              em lugar nenhum.
            </p>
          </Secao>

          <Secao numero="07" titulo="Encerramento">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Você pode pedir pra encerrar sua conta e apagar seus dados a qualquer momento, escrevendo
              pro contato abaixo. O acesso também pode ser encerrado do nosso lado, a qualquer momento,
              enquanto durar a fase de teste gratuito.
            </p>
          </Secao>

          <Secao numero="08" titulo="Mudanças nestes termos">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Estes termos podem mudar conforme o produto evolui. Mudança relevante aparece no{" "}
              <Link href="/novidades" className="text-aurora-accent-text underline">
                histórico de novidades
              </Link>{" "}
              ou é avisada diretamente. Este documento segue a legislação brasileira.
            </p>
          </Secao>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 aurora-card rounded-2xl border border-aurora-line bg-aurora-surface px-6 py-5">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-aurora-muted-2">
              Dúvida ou pedido de encerramento?
            </p>
            <a
              href="mailto:iudiyano@gmail.com"
              className="font-serif text-[20px] italic font-medium text-aurora-fg"
            >
              iudiyano@gmail.com
            </a>
          </div>
          <p className="max-w-xs text-[13px] leading-relaxed text-aurora-muted">
            Responde direto o Daniel — é ele quem cuida disso pessoalmente.
          </p>
        </div>
      </section>

      <footer className="border-t border-aurora-line-soft">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-6 py-7">
          <Logo variant="footer" />
          <span className="mx-1 text-aurora-line">·</span>
          <Link href="/privacidade" className="text-[13px] text-aurora-muted-2 transition hover:text-aurora-muted">
            Política de Privacidade
          </Link>
        </div>
      </footer>
    </main>
  );
}

function Secao({ numero, titulo, children }: { numero: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-aurora-line-soft pt-8 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[12px] font-semibold text-aurora-muted-2">{numero}</span>
        <h2 className="text-[18.5px] font-semibold tracking-tight text-aurora-fg">{titulo}</h2>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <p className="relative max-w-2xl pl-[18px] text-[14px] leading-relaxed text-aurora-muted">
      <span className="absolute left-0 top-[0.6em] h-[5px] w-[5px] rounded-[1px] bg-aurora-accent/70" />
      {children}
    </p>
  );
}
