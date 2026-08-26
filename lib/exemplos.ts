// Exemplos reais de como se fala com a Mia, por categoria — usado na Home
// (resumido) e em /funcionalidades (detalhado). Fonte única: as frases são
// as mesmas nos dois lugares, só a apresentação muda.
export interface Exemplo {
  titulo: string;
  eyebrow: string;
  descricao: string;
  frases: string[];
}

export const EXEMPLOS: Exemplo[] = [
  {
    titulo: "Agenda",
    eyebrow: "Agenda inteligente",
    descricao:
      "Ela lê e escreve direto no seu Google Calendar ou Outlook — marca, remarca e cancela com suas próprias palavras, sem formulário. Entende \"amanhã de manhã\" ou \"na próxima sexta\", e avisa antes de confirmar se perceber conflito de horário.",
    frases: [
      "o que eu tenho hoje?",
      "marca almoço com o João amanhã 12h",
      "bloqueia 2h de deep work na sexta de manhã",
      "minha quinta à tarde tá livre?",
    ],
  },
  {
    titulo: "E-mail",
    eyebrow: "E-mail e comunicação",
    descricao:
      "Resume sua caixa de entrada e destaca só o que precisa de atenção agora — sem te enfiar o corpo inteiro de cada mensagem. Ela lê remetente, assunto e um trecho curto, o suficiente pra você decidir se abre ou ignora.",
    frases: [
      "tem algo urgente no e-mail?",
      "resume meu inbox",
      "chegou alguma coisa do fornecedor?",
    ],
  },
  {
    titulo: "Tarefas",
    eyebrow: "Tarefas, sem plataforma nova",
    descricao:
      "Cria, conclui e consulta tarefas na ferramenta que você já usa — ClickUp, Notion, Trello, Google Tasks ou Microsoft To Do. Você não aprende uma plataforma nova, só fala com ela.",
    frases: [
      "o que tá atrasado?",
      "cria uma task de revisar o contrato pra sexta",
      "já entreguei o deck",
      "tô perdido, o que eu faço agora?",
    ],
  },
  {
    titulo: "Memória",
    eyebrow: "Ela lembra por você",
    descricao:
      "Guarda o que você conta que vale a pena lembrar depois — preferências, rotina, gente que você menciona sempre — e usa isso pra responder melhor, sem você repetir contexto toda vez.",
    frases: [
      "anota que o fornecedor novo cobra 12% a mais",
      "o que eu tinha anotado sobre o contrato?",
      "prefiro reunião de manhã",
    ],
  },
  {
    titulo: "Lembretes",
    eyebrow: "Ela cutuca na hora certa",
    descricao:
      "Pontual ou recorrente, é só pedir — ela avisa no momento combinado, sem você precisar abrir outro app pra isso.",
    frases: [
      "me lembra de ligar pro João amanhã às 14h",
      "todo dia 5 me avisa do fechamento",
      "me cutuca em 1h",
    ],
  },
  {
    titulo: "Arquivos",
    eyebrow: "Sai da conversa, vira arquivo",
    descricao:
      "Quando o que você precisa é um arquivo — não só uma resposta — ela exporta em planilha ou PDF na hora, direto na conversa.",
    frases: [
      "me manda as tarefas da Nike em planilha",
      "exporta minha agenda da semana",
    ],
  },
];
