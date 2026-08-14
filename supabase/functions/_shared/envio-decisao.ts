// Decide, a cada mensagem, se a secretária ENVIA pela API oficial ou devolve um
// link pro usuário mandar.
//
// POR QUE ISTO É UM MÓDULO SEPARADO DO QUE ENVIA: aqui moram as quatro
// perguntas que protegem, e elas precisam ser verificáveis sem rede, sem
// credencial da Meta e sem banco. Se a decisão vivesse dentro do cliente HTTP,
// só daria pra testar com o dedo em cima do gatilho.
//
// A REGRA GERAL: qualquer dúvida cai no link. O caminho seguro é o default,
// nunca a exceção. Nenhuma pergunta abaixo pode "falhar aberta" — erro de banco
// ao consultar opt-out devolve link, não envio.
//
// ORDEM DAS PERGUNTAS: as locais e baratas primeiro (flag, template), as de
// banco depois. Não é só desempenho — se o tenant nem ligou o envio, não faz
// sentido consultar a lista de saída de um telefone que não íamos contatar.

import { montaTemplate, type PayloadTemplate } from "./templates-wa.ts";

/**
 * De onde veio o direito de contatar esta pessoa. Não existe valor pra lista
 * importada nem pra prospecção: o tipo é a primeira barreira, e o CHECK da
 * coluna `envios_whatsapp.origem_contato` é a segunda.
 */
export type OrigemContato = "participante_evento" | "cadastrado_pelo_usuario";

export interface PedidoDeEnvio {
  tenantId: string;
  /** Vale a coluna `tenants.envio_oficial`. */
  tenantLigouEnvio: boolean;
  telefoneE164: string;
  /** Nome do template. Desconhecido → link, nunca envio. */
  template: string;
  variaveis: Record<string, string>;
  origemContato: OrigemContato;
  /** Compromisso que motivou. Usado pra não mandar o mesmo aviso duas vezes. */
  eventoId?: string;
}

export type Decisao =
  | { via: "envio"; payload: PayloadTemplate; previa: string }
  /** Cai no link wa.me — o comportamento de hoje. `motivo` é pra Yuka explicar. */
  | { via: "link"; motivo: string }
  /** Nem envia nem oferece link: já foi feito. Repetir é insistência. */
  | { via: "pular"; motivo: string };

export interface DecisaoDeps {
  /** Consulta `whatsapp_opt_out`. Global por telefone, sem tenant. */
  estaForaDaLista(telefoneE164: string): Promise<boolean>;
  /** Consulta `envios_whatsapp`: este template já saiu pra este evento? */
  jaEnviou(
    tenantId: string,
    telefoneE164: string,
    template: string,
    eventoId?: string,
  ): Promise<boolean>;
  /** Credencial da Meta presente no ambiente. Sem ela não existe envio. */
  temCredencial(): boolean;
}

/**
 * Roda as quatro perguntas e devolve o caminho.
 *
 * Nunca lança: erro de infraestrutura vira `link`, porque um envio que não
 * pôde ser verificado é um envio que não deve acontecer.
 */
export async function decideEnvio(
  pedido: PedidoDeEnvio,
  deps: DecisaoDeps,
): Promise<Decisao> {
  // 1. O tenant ligou? Desligado é o padrão e o caso da maioria.
  if (!pedido.tenantLigouEnvio) {
    return { via: "link", motivo: "envio automático desligado neste tenant" };
  }

  // 2. Existe credencial? Sem ela o envio falharia na Meta — melhor nem tentar.
  if (!deps.temCredencial()) {
    return { via: "link", motivo: "envio oficial ainda não configurado" };
  }

  // 3. Cabe num template aprovado? Aqui morre texto livre, e é a pergunta que
  //    impede a plataforma de fazer o que a Meta bloqueia conta por fazer.
  const montado = montaTemplate(pedido.template, pedido.telefoneE164, pedido.variaveis);
  if (!montado.ok) {
    return { via: "link", motivo: montado.motivo };
  }

  // 4. A pessoa pediu pra sair? Falha de consulta conta como "saiu" — na dúvida
  //    NÃO se envia. É o único ponto onde o erro precisa ser conservador nos
  //    dois sentidos, e ele é.
  try {
    if (await deps.estaForaDaLista(pedido.telefoneE164)) {
      return { via: "link", motivo: "essa pessoa pediu pra não receber mensagens automáticas" };
    }
  } catch {
    return { via: "link", motivo: "não consegui verificar a lista de saída agora" };
  }

  // 5. Já mandamos isto por causa deste compromisso? Dois lembretes da mesma
  //    reunião não é serviço, é incômodo — e o destinatário não tem como pedir
  //    "só um por favor".
  try {
    if (await deps.jaEnviou(pedido.tenantId, pedido.telefoneE164, pedido.template, pedido.eventoId)) {
      return { via: "pular", motivo: "esse aviso já foi enviado" };
    }
  } catch {
    return { via: "link", motivo: "não consegui verificar o histórico de envio agora" };
  }

  return { via: "envio", payload: montado.payload, previa: montado.previa };
}
