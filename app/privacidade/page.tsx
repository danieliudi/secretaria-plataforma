import Link from "next/link";
import { Logo } from "@/components/Logo";

// Página pública e estática — texto legal, sem dado dinâmico. Conteúdo
// aprovado por mockup (ver conversa) antes de virar rota real, seguindo o
// mesmo levantamento factual do código (o que é coletado, descartado,
// compartilhado e retido) — não é boilerplate genérico.
export default function PrivacidadePage() {
  return (
    <main className="aurora-bg flex min-h-screen flex-col">
      <header className="bg-aurora-header-bg">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
          <Link href="/">
            <Logo variant="header" />
          </Link>
          <div className="flex items-center gap-6">
            <span className="text-[13.5px] font-semibold text-aurora-fg">Privacidade</span>
            <Link
              href="/login"
              className="rounded-lg border border-aurora-line px-4 py-2 text-[13.5px] font-semibold text-aurora-fg transition hover:border-white/20"
            >
              Entrar
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-24 pt-6 md:pt-10">
        <div className="flex flex-col gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
            Como seus dados são tratados
          </span>
          <h1 className="text-balance text-[32px] font-semibold leading-tight tracking-tight text-aurora-fg md:text-[38px]">
            Política de Privacidade
          </h1>
          <span className="font-mono text-[12px] text-aurora-muted-2">Última atualização · 19 ago 2026</span>
          <p className="max-w-xl text-[15px] leading-relaxed text-aurora-muted">
            Esta página explica, sem juridiquês, o que a Mia coleta sobre você, pra que serve,
            com quem esse dado é compartilhado e como pedir pra apagar tudo quando quiser.
          </p>
        </div>

        <div className="flex gap-3 aurora-card rounded-xl border border-aurora-line bg-aurora-surface p-5">
          <span className="mt-0.5 w-[3px] flex-none rounded-full bg-aurora-accent" />
          <p className="text-[13.5px] leading-relaxed text-aurora-muted">
            <strong className="font-semibold text-aurora-fg">A Mia é um projeto pessoal</strong>, não uma
            empresa constituída — está em fase de teste gratuito com um grupo pequeno de pessoas
            conhecidas. O responsável pelos dados tratados aqui é{" "}
            <strong className="font-semibold text-aurora-fg">Daniel Yano</strong>, pessoa física, que
            também é quem você contata pra qualquer assunto de privacidade (final da página).
          </p>
        </div>

        <div className="flex flex-col gap-16">
          <Secao numero="01" titulo="O que a gente coleta">
            <Item titulo="Identificação">
              nome e cargo que você informa no cadastro; e-mail da conta Google/Outlook usada pra entrar.
            </Item>
            <Item titulo="Canal de conversa">
              seu número de WhatsApp, seu chat_id do Telegram ou seu identificador do Teams — o mínimo
              pra saber pra quem responder.
            </Item>
            <Item titulo="Conteúdo das mensagens">
              o texto que você manda pra Mia, guardado como histórico recente de conversa (últimas
              trocas) e como um perfil de coisas duráveis que você já contou pra ela (preferências,
              rotina, pessoas que você menciona sempre).
            </Item>
            <Item titulo="Uso da plataforma">
              quantidade de mensagens processadas por mês, sem o conteúdo — só contagem, pra gente
              entender o quanto a Mia está sendo usada.
            </Item>
          </Secao>

          <Secao numero="02" titulo="Áudio, foto e PDF: o que fica salvo">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Quando você manda um áudio, a Mia transcreve pra texto e{" "}
              <strong className="font-semibold text-aurora-fg">descarta o áudio original</strong> — só o
              texto da transcrição segue no fluxo. O mesmo vale pra foto (ela é descrita em texto e
              descartada) e pra PDF (é resumido em texto e descartado). Nenhum desses arquivos brutos é
              guardado em banco de dados em nenhum momento — eles passam pelo provedor de IA que faz a
              conversão e são jogados fora.
            </p>
          </Secao>

          <Secao numero="03" titulo="Quando você conecta Google ou Outlook">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Se você liga sua conta Google ou Microsoft, a Mia pode ler e escrever na sua{" "}
              <strong className="font-semibold text-aurora-fg">agenda</strong>, ler{" "}
              <strong className="font-semibold text-aurora-fg">e-mails</strong> (só remetente, assunto e
              um trecho curto — não o corpo inteiro) e gerenciar suas{" "}
              <strong className="font-semibold text-aurora-fg">tarefas</strong>, exatamente pra poder
              marcar compromissos e te lembrar do que importa. Essas informações são lidas na hora, pra
              responder sua pergunta, e não ficam guardadas numa tabela própria — só o token de acesso
              (a &ldquo;chave&rdquo; que permite essa leitura) fica salvo, dentro de um cofre criptografado
              exclusivo da sua conta.
            </p>
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Você pode revogar esse acesso a qualquer momento, direto nas configurações da sua conta
              Google ou Microsoft.
            </p>
          </Secao>

          <Secao numero="04" titulo="Com quem esse dado é compartilhado">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Pra Mia funcionar, alguns pedaços da conversa passam por serviços de terceiros — cada um
              só recebe o que precisa pra fazer sua parte:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="border-b border-aurora-line-soft py-2.5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wide text-aurora-muted-2">
                      Serviço
                    </th>
                    <th className="border-b border-aurora-line-soft py-2.5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wide text-aurora-muted-2">
                      O que recebe
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Anthropic (Claude)", "O texto da conversa, e o conteúdo de fotos/PDFs enviados, pra gerar as respostas."],
                    ["Groq", "O áudio que você manda, só pra transcrever em texto."],
                    ["Google Cloud", "O texto da resposta da Mia, quando ela responde falando."],
                    ["Google / Microsoft", "Consultas de agenda, e-mail e tarefas — só se você conectou essas contas."],
                    ["WhatsApp, Telegram, Teams", "As mensagens em si, pra entrega — são os canais por onde você fala com a Mia."],
                    ["Supabase", "Hospeda o banco de dados, o login e o cofre de credenciais — é a infraestrutura por trás de tudo."],
                  ].map(([servico, recebe]) => (
                    <tr key={servico}>
                      <td className="whitespace-nowrap border-b border-aurora-line-soft py-2.5 pr-4 font-semibold text-aurora-fg">
                        {servico}
                      </td>
                      <td className="border-b border-aurora-line-soft py-2.5 pr-4 leading-relaxed text-aurora-muted">
                        {recebe}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Como a maioria desses serviços processa fora do Brasil, seus dados podem trafegar
              internacionalmente — sempre só o necessário pra função específica de cada um.
            </p>
          </Secao>

          <Secao numero="05" titulo="Por quanto tempo guardamos">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Enquanto sua conta estiver ativa, seu histórico de conversa e perfil ficam guardados — é o
              que permite a Mia lembrar de contexto entre uma mensagem e outra. Se você pedir pra excluir
              sua conta, todos os dados vinculados a ela são apagados.
            </p>
          </Secao>

          <Secao numero="06" titulo="Como protegemos">
            <Item titulo="Isolamento entre contas">
              o acesso direto ao banco é bloqueado por padrão — só o backend consegue ler dados, e
              sempre filtrando pela sua conta especificamente. Ninguém vê dado de outra pessoa.
            </Item>
            <Item titulo="Cofre de credenciais">
              tokens de acesso ao Google/Microsoft ficam num cofre criptografado, isolado por conta —
              nunca em texto puro.
            </Item>
            <Item titulo="Sem rastreamento">
              o site não usa Google Analytics, pixel do Meta, nem nenhum script de terceiro pra te
              rastrear. O único cookie é o de sessão, pra manter você logado.
            </Item>
          </Secao>

          <Secao numero="07" titulo="Seus direitos">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Pela LGPD, você pode a qualquer momento pedir (por e-mail, ao final da página):
            </p>
            <ul className="flex flex-col gap-2.5">
              {[
                "Confirmação de que tratamos seus dados, e acesso a eles",
                "Correção de dado incompleto ou desatualizado",
                "Exclusão dos seus dados e da sua conta",
                "Uma cópia portável do que temos sobre você",
                "Revogação de qualquer consentimento dado (ex.: desconectar Google/Outlook)",
              ].map((item) => (
                <li key={item} className="relative max-w-2xl pl-[18px] text-[14px] leading-relaxed text-aurora-muted">
                  <span className="absolute left-0 top-[0.6em] h-[5px] w-[5px] rounded-[1px] bg-aurora-accent/70" />
                  {item}
                </li>
              ))}
            </ul>
          </Secao>

          <Secao numero="08" titulo="Mudanças nesta política">
            <p className="max-w-2xl text-[14px] leading-relaxed text-aurora-muted">
              Se algo relevante mudar em como tratamos seus dados, isso aparece no{" "}
              <Link href="/novidades" className="text-aurora-accent-text underline">
                histórico de novidades
              </Link>{" "}
              do site ou é avisado diretamente. A Mia não é destinada a menores de 18 anos.
            </p>
          </Secao>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 aurora-card rounded-2xl border border-aurora-line bg-aurora-surface px-6 py-5">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-aurora-muted-2">
              Dúvida sobre privacidade?
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
          <Link href="/termos" className="text-[13px] text-aurora-muted-2 transition hover:text-aurora-muted">
            Termos de Uso
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

function Item({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <p className="relative max-w-2xl pl-[18px] text-[14px] leading-relaxed text-aurora-muted">
      <span className="absolute left-0 top-[0.6em] h-[5px] w-[5px] rounded-[1px] bg-aurora-accent/70" />
      <strong className="font-semibold text-aurora-fg">{titulo}:</strong> {children}
    </p>
  );
}
