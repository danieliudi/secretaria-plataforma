// Marca "Mia" — símbolo (public/brand/*) + wordmark ou tagline, nos tamanhos
// usados hoje: cabeçalho da landing (link pra "/"), cabeçalho da área logada
// e rodapé.
//
// Dois recortes do símbolo, e de cada um a versão de EXIBIÇÃO:
//   - mia-mark.png / mia-mark-64.png             — original com margem em volta.
//   - mia-mark-tight.png / mia-mark-tight-120.png — recortado, sem a margem.
//
// O código aponta pros derivados; os originais ficam na pasta como fonte. Até
// 01/09/2026 o header servia o ORIGINAL de 1536x1024 (954 KB) pra desenhar 17
// pixels de altura — 192x mais bytes do que o necessário, em toda página
// pública e no /login. Os derivados são gerados a 3x o maior uso na tela, então
// o resultado é idêntico inclusive em retina; muda só o peso.
// A margem do original faz o símbolo "encolher" na caixa: a 19px de altura
// sobrava desenho de uns 12px, e ele sumia ao lado do menu. O lockup da área
// logada usa o recorte; a landing e o rodapé seguem no original até terem
// mockup próprio (a troca muda o tamanho aparente, não é ajuste mecânico).
const VARIANTES = {
  header: {
    src: "/brand/mia-mark-64.png",
    alturaImg: 17,
    texto: "text-[13.5px] font-bold tracking-tight text-aurora-fg",
  },
  headerApp: {
    src: "/brand/mia-mark-64.png",
    alturaImg: 19,
    texto: "text-[15px] font-extrabold tracking-tight text-aurora-fg",
  },
  footer: {
    src: "/brand/mia-mark-64.png",
    alturaImg: 13,
    texto: "text-[13px] font-semibold text-aurora-muted",
  },
} as const;

export function Logo({ variant = "header" }: { variant?: keyof typeof VARIANTES }) {
  const v = VARIANTES[variant];
  return (
    <span className="flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- o ARQUIVO já vem no
          tamanho certo, então não há o que next/image otimizar. Foi confiar
          nesta linha sem olhar o arquivo que deixou 954 KB no header. */}
      <img src={v.src} alt="" style={{ height: v.alturaImg, width: "auto" }} />
      <span className={v.texto}>Mia</span>
    </span>
  );
}

/**
 * Lockup da área logada (variante "B" do mockup de 27/08/2026, aprovada pelo
 * Daniel): símbolo recortado a 40px + filete + tagline em duas linhas, SEM
 * repetir "Mia" — o símbolo já é o nome, e escrever de novo ao lado dele
 * competia com o próprio desenho.
 *
 * No celular o símbolo cai pra 32px e a tagline SAI (`mostrarTagline={false}`):
 * numa barra de 360px ela custa ~120px e empurraria "Novidades" pra fora — e
 * esconder navegação é justamente o problema que este redesenho veio corrigir.
 * A ordem de sacrifício é tagline primeiro, símbolo por último.
 */
export function LogoLockup({
  alturaSimbolo = 40,
  mostrarTagline = true,
}: {
  alturaSimbolo?: number;
  mostrarTagline?: boolean;
}) {
  return (
    <span className="flex flex-shrink-0 items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- ícone estático */}
      <img
        src="/brand/mia-mark-tight-120.png"
        alt="Mia"
        style={{ height: alturaSimbolo, width: "auto" }}
      />
      {mostrarTagline && (
        <>
          <span aria-hidden="true" className="my-[3px] w-px self-stretch bg-aurora-line" />
          <span className="text-[10.5px] font-bold uppercase leading-[1.5] tracking-[0.13em] text-aurora-muted">
            Secretária
            <br />
            executiva agêntica
          </span>
        </>
      )}
    </span>
  );
}
