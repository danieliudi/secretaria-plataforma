// Marca "Mia" — símbolo (public/brand/mia-mark.png) + wordmark, nos dois
// tamanhos usados hoje: cabeçalho (link pra "/") e rodapé (sem link, mais
// discreto). Substitui o antigo ponto dourado (`bg-aurora-accent`) que valia
// como logo provisório antes do arquivo de marca real existir.
const VARIANTES = {
  header: { alturaImg: 17, texto: "text-[13.5px] font-bold tracking-tight text-aurora-fg" },
  headerApp: { alturaImg: 19, texto: "text-[15px] font-extrabold tracking-tight text-aurora-fg" },
  footer: { alturaImg: 13, texto: "text-[13px] font-semibold text-aurora-muted" },
} as const;

export function Logo({ variant = "header" }: { variant?: keyof typeof VARIANTES }) {
  const v = VARIANTES[variant];
  return (
    <span className="flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- ícone pequeno e estático, não precisa de next/image */}
      <img src="/brand/mia-mark.png" alt="" style={{ height: v.alturaImg, width: "auto" }} />
      <span className={v.texto}>Mia</span>
    </span>
  );
}
