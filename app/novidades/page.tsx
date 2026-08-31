import { redirect } from "next/navigation";

// O changelog deixou de ser página e virou a última seção da vitrine
// (components/SecaoNovidades.tsx) — decisão do Daniel em 31/08/2026: duas
// páginas separadas dividiam o mesmo assunto em dois endereços, e ninguém
// sabia qual visitar.
//
// A ROTA CONTINUA EXISTINDO de propósito. Apagar quebraria três coisas que
// apontam pra ela e que não são o menu do site:
//   - o painel de novidades da área logada (components/NovidadesPainel.tsx),
//     que abre "Ver página completa ↗" numa aba nova;
//   - os links de /termos e /privacidade ("histórico de novidades"), que são
//     compromisso escrito com o usuário, não navegação;
//   - qualquer link que alguém tenha salvo ou recebido no resumo diário.
export default function NovidadesPage() {
  redirect("/funcionalidades#novidades");
}
