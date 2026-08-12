import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Quem já entrou vai direto pro wizard — a landing é pra quem ainda não
// conhece. Antes desta página o "/" redirecionava direto pro /login, e a
// pessoa chegava na secretária sem ideia do que dizer pra ela: o produto é
// uma caixa de conversa vazia, então o que ensina a usar é ver exemplo real.

const EXEMPLOS: Array<{ titulo: string; frases: string[] }> = [
  {
    titulo: "Agenda",
    frases: [
      "o que eu tenho hoje?",
      "marca almoço com o João amanhã 12h",
      "bloqueia 2h de deep work na sexta de manhã",
      "minha quinta à tarde tá livre?",
    ],
  },
  {
    titulo: "E-mail",
    frases: [
      "tem algo urgente no e-mail?",
      "resume meu inbox",
      "chegou alguma coisa do fornecedor?",
    ],
  },
  {
    titulo: "Tarefas",
    frases: [
      "o que tá atrasado?",
      "cria uma task de revisar o contrato pra sexta",
      "já entreguei o deck",
      "tô perdido, o que eu faço agora?",
    ],
  },
  {
    titulo: "Memória",
    frases: [
      "anota que o fornecedor novo cobra 12% a mais",
      "o que eu tinha anotado sobre o contrato?",
      "prefiro reunião de manhã",
    ],
  },
  {
    titulo: "Lembretes",
    frases: [
      "me lembra de ligar pro João amanhã às 14h",
      "todo dia 5 me avisa do fechamento",
      "me cutuca em 1h",
    ],
  },
  {
    titulo: "Arquivos",
    frases: [
      "me manda as tarefas da Resibag em planilha",
      "exporta minha agenda da semana",
    ],
  },
];

function Bolha({ children, de }: { children: React.ReactNode; de: "eu" | "ela" }) {
  const meu = de === "eu";
  return (
    <div
      className={`max-w-[85%] rounded-lg px-3 py-2 text-[13.5px] leading-relaxed text-[#e9edef] ${
        meu ? "self-end rounded-tr-sm bg-[#005c4b]" : "self-start rounded-tl-sm bg-[#1f2c33]"
      }`}
    >
      {children}
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/onboarding");

  return (
    <main className="flex flex-col">
      {/* ── topo ── */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-cyan" />
          <span className="text-[13.5px] font-bold tracking-tight text-foreground">sinal</span>
        </div>
        <div className="flex items-center gap-6">
          <Link
            href="/novidades"
            className="text-[13.5px] font-semibold text-muted transition hover:text-foreground"
          >
            Novidades
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-line px-4 py-2 text-[13.5px] font-semibold text-foreground transition hover:border-muted-2"
          >
            Entrar
          </Link>
        </div>
      </header>

      {/* ── hero ── */}
      <section className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-12 px-6 pb-20 pt-10 md:grid-cols-[1.05fr_0.95fr] md:pt-16">
        <div className="flex flex-col items-start gap-6">
          <h1 className="text-balance text-[40px] font-semibold leading-[1.1] tracking-tight text-foreground md:text-[52px]">
            Uma secretária que vive no seu WhatsApp
          </h1>
          <p className="max-w-lg text-[16.5px] leading-relaxed text-muted">
            Ela cuida da sua agenda, do seu e-mail e das suas tarefas — e você
            fala com ela como falaria com uma pessoa. Sem app novo, sem aprender
            comando nenhum.
          </p>
          <Link
            href="/login"
            className="rounded-lg bg-foreground px-6 py-3.5 text-[14.5px] font-semibold text-background transition active:scale-[0.98]"
          >
            Criar a minha
          </Link>
          <span className="text-[13px] text-muted-2">
            Leva menos de 3 minutos. Você conecta sua conta Google e escolhe o canal.
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl bg-[#0b141a] p-4">
          <Bolha de="eu">bom dia</Bolha>
          <Bolha de="ela">
            Bom dia! Você tem 3 compromissos hoje — o primeiro é 10h, alinhamento
            com a Sanwey. O deck da Resibag está 2 dias atrasado.
          </Bolha>
          <Bolha de="eu">marca almoço com o João amanhã 12h</Bolha>
          <Bolha de="ela">Marquei ✅ Amanhã, 12h–13h, “Almoço com João”.</Bolha>
          <Bolha de="eu">me lembra de levar o contrato</Bolha>
          <Bolha de="ela">Combinado — te cutuco amanhã 11h30. 👍</Bolha>
        </div>
      </section>

      {/* ── como usar ── */}
      <section className="border-y border-line-soft bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-20">
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-2">
              Como se fala com ela
            </span>
            <h2 className="max-w-2xl text-balance text-[30px] font-semibold leading-tight tracking-tight text-foreground">
              Do jeito que você já escreve
            </h2>
            <p className="max-w-2xl text-[15.5px] leading-relaxed text-muted">
              Não tem menu nem palavra mágica. Estes são pedidos reais que
              funcionam — escreva parecido, com suas palavras.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {EXEMPLOS.map((grupo) => (
              <div
                key={grupo.titulo}
                className="flex flex-col gap-3 rounded-xl border border-line bg-background p-5"
              >
                <span className="text-[13px] font-bold tracking-tight text-cyan">
                  {grupo.titulo}
                </span>
                <ul className="flex flex-col gap-2">
                  {grupo.frases.map((f) => (
                    <li
                      key={f}
                      className="rounded-lg bg-surface-2 px-3 py-2 text-[13.5px] leading-snug text-foreground"
                    >
                      “{f}”
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── proativo ── */}
      <section className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-12 px-6 py-20 md:grid-cols-[0.95fr_1.05fr]">
        <div className="order-2 overflow-hidden rounded-xl md:order-1" style={{ background: "#10201f" }}>
          <div className="flex items-start justify-between border-b px-6 py-5" style={{ borderColor: "#24423f" }}>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold tracking-[0.14em]" style={{ color: "#4ecdc0" }}>
                AMANHÃ
              </span>
              <span className="mt-1 text-[21px] font-bold" style={{ color: "#eef5f3" }}>
                4 reuniões seguidas
              </span>
            </div>
            <span className="pt-1 text-[12px]" style={{ color: "#8fa9a5" }}>12 ago</span>
          </div>
          <div className="flex flex-col px-6 py-4">
            {[
              ["09:00", "Conselho Sanwey", "60 min"],
              ["10:00", "Fornecedor — IBC", "30 min · sem intervalo"],
              ["10:30", "Comercial Resibag", "60 min · sem intervalo"],
              ["11:30", "Jurídico", "45 min · sem intervalo"],
            ].map(([hora, titulo, sub], i, arr) => (
              <div
                key={titulo}
                className="flex items-start gap-3 py-2.5"
                style={{ borderBottom: i === arr.length - 1 ? "none" : "1px solid #24423f" }}
              >
                <span className="w-11 text-[12.5px]" style={{ color: "#8fa9a5" }}>{hora}</span>
                <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: "#4ecdc0" }} />
                <span className="flex flex-col">
                  <span className="text-[14px] font-semibold" style={{ color: "#eef5f3" }}>{titulo}</span>
                  <span className="text-[11.5px]" style={{ color: "#8fa9a5" }}>{sub}</span>
                </span>
              </div>
            ))}
            <div className="mt-4 flex flex-col gap-1.5 rounded-lg px-4 py-3" style={{ background: "#17302e" }}>
              <span className="text-[12.5px]" style={{ color: "#eef5f3" }}>→ 3h15 sem pausa e sem almoço até 12h15.</span>
              <span className="text-[12.5px]" style={{ color: "#eef5f3" }}>→ Posso empurrar o Jurídico pra 14h?</span>
            </div>
          </div>
        </div>

        <div className="order-1 flex flex-col gap-4 md:order-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-2">
            Ela fala primeiro
          </span>
          <h2 className="text-balance text-[30px] font-semibold leading-tight tracking-tight text-foreground">
            O melhor dela é o que você não pediu
          </h2>
          <p className="max-w-lg text-[15.5px] leading-relaxed text-muted">
            De manhã, seu dia resumido. Dez minutos antes, o lembrete da reunião.
            E quando ela percebe que amanhã está impossível, ela te avisa na
            véspera — com a agenda desenhada e uma proposta pronta.
          </p>
          <p className="max-w-lg text-[15.5px] leading-relaxed text-muted">
            Ela não te enche. Se o dia está tranquilo, você não ouve nada.
          </p>
        </div>
      </section>

      {/* ── canais + o que precisa ── */}
      <section className="border-t border-line-soft bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-20">
          <h2 className="text-balance text-[30px] font-semibold leading-tight tracking-tight text-foreground">
            O que você precisa pra começar
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {[
              {
                t: "Uma conta Google",
                d: "É por onde ela enxerga sua agenda, seu e-mail e suas tarefas. Você autoriza no login, e revoga quando quiser.",
              },
              {
                t: "WhatsApp ou Telegram",
                d: "No WhatsApp todo mundo conversa pelo mesmo número — você vincula o seu com um código de 6 letras. No Telegram, o bot é seu.",
              },
              {
                t: "Três minutos",
                d: "O resto é escolher como ela te chama e onde ficam suas tarefas. Dá pra mudar tudo depois.",
              },
            ].map((c) => (
              <div key={c.t} className="flex flex-col gap-2 rounded-xl border border-line bg-background p-5">
                <span className="text-[15px] font-semibold text-foreground">{c.t}</span>
                <span className="text-[13.5px] leading-relaxed text-muted">{c.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── cta ── */}
      <section className="mx-auto flex w-full max-w-5xl flex-col items-start gap-5 px-6 py-20">
        <h2 className="text-balance text-[32px] font-semibold leading-tight tracking-tight text-foreground">
          Pronto pra parar de ser o seu próprio assistente?
        </h2>
        <Link
          href="/login"
          className="rounded-lg bg-cyan px-6 py-3.5 text-[14.5px] font-semibold text-white transition active:scale-[0.98]"
        >
          Criar a minha secretária
        </Link>
      </section>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-6 py-7">
          <span className="h-2 w-2 rounded-sm bg-cyan" />
          <span className="text-[13px] font-semibold text-muted">sinal</span>
        </div>
      </footer>
    </main>
  );
}
