---
tags: [tudo-azul, ideias]
---
# Ideias e comparações

## Organizze e Mobills (páginas públicas, 26/10)
Só estrutura de funções; sem copiar marca, texto, tela ou código.

| Função | Organizze | Mobills | Tudo Azul |
|---|---|---|---|
| Contas, cartões, categorias, orçamento por categoria | sim | sim | **sim** |
| Relatórios e gráficos | sim | sim | **sim** |
| Projeção do mês | parcial | parcial | **sim** |
| Alertas de contas a pagar (push) | sim | sim | **parcial** (card "Vencidos") |
| Metas/objetivos | — | sim | não (junto com investimentos) |
| Exportar CSV | — | — | **sim** |
| Conexão bancária (Open Finance) | sim (planos pagos) | sim | **fora de escopo** |
| Renda regular × eventual, conferência de saldo | — | — | **sim** (diferencial) |

Preços vistos: Organizze Manual R$ 39/mês (Conectado R$ 49; Plus R$ 79); Mobills Premium R$ 99,90/ano (página com cache de 2022).

## DLPInvest (referência de organização)
Aproveitado: **menu por categorias** (Visão geral, Movimentações, Ferramentas…) e **ocultar valores**. Não aproveitado: variação diária do patrimônio (ruído num orçamento familiar). Próximo: separar **Início × Análises**, espelhando Portfólio × Dashboard.

## Livro de contas (prints do dono, 28/10/2026)
Só ideias de uso; sem copiar marca, texto, tela ou código. Ficam guardadas: **só se aplicam quando o dono pedir**. Em ordem de valor:

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 1 | **Valor do dia dentro da grade do Calendário** (o resultado do dia aparece no próprio quadrado) | Hoje a grade só tem marcas coloridas; o valor está na lista do dia. Proposta pronta. **Decidido pelo dono em 28/10/2026: opção A, resultado do dia (entrou − saiu).** Falta confirmar se o planejado entra no número (recomendado: sim, em âmbar, separado) e o "pode" para implementar. Precisa de função nova no banco (mesmo critério da lista do dia) com teste pgTAP, passa pelo workflow de produção. No celular o valor vai abreviado ("−1,2 mil") por causa da largura | Médio (migration + front) |
| 2 | **Grade de categorias com ícone no lançamento**: tocar no ícone em vez de abrir uma lista; valor grande no topo; data com ‹ › | Hoje a categoria é uma lista suspensa. Os ícones já existem (#72). Junta com "formulário em folha no celular" | Médio, só front |
| 3 | **Lançar em sequência**: salvar e já abrir outro em branco | Não existe. Útil para lançar vários gastos de uma vez | Baixo |
| 4 | **Dia inicial do mês** (o mês começa no dia do salário) | Já previsto em "Períodos financeiros" (etapa 1 mesclada no #58); falta a autorização das próximas etapas | Médio |
| 5 | **Tema escuro** | Não existe; as cores já estão centralizadas | Médio |
| 6 | **Relatório anual** (saldo e despesa por categoria no ano) | Temos Análises mês a mês e exportação; falta a visão do ano | Médio |

**Já temos (e mais completo):** calendário com lista do dia (#62), despesas fixas (recorrências com frequência), apagar tudo ("zerar"), família, conferência com extrato, cartão parcelado, números vindos do banco.

**Não copiar:**
- Anúncios e consentimento com centenas de "parceiros": erro de privacidade para um app de finanças da família.
- "Saldo do mês anterior" como opção: no Tudo Azul o saldo vem do banco e é contínuo; virar opção abre espaço para número errado.
- Bloqueio com senha no app: em app web exige WebAuthn; login e "ocultar valores" já cobrem. Fica para depois, se o dono pedir.
- Lembrete por notificação: já está nas decisões pendentes (alerta de vencimento por push).

## Minhas Economias (prints do dono, 28/10/2026)
Os prints mostram o **cadastro de conta** (e a tela de termos de uso); a página inicial do app não veio nos prints. Só ideias de uso; sem copiar marca, logo, texto, tela ou código. **Só se aplica quando o dono pedir.**

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 1 | **Conta principal**: o lançamento já abre na conta mais usada | Hoje o formulário abre na **primeira conta ativa** da lista. Duas formas: (a) lembrar a última conta usada no aparelho (só front, sem banco, por aparelho); (b) marcar uma conta como principal (coluna nova + migration, vale para a família toda). Recomendação: começar por (a) | Baixo (a) · Médio (b) |
| 2 | **Escolher o banco numa lista com busca** ("Buscar Banco ou Cartão"), com os mais comuns primeiro; o **apelido da conta vem preenchido** com o nome do banco | Hoje o nome é texto livre (placeholder "Ex.: Itaú João"). Lista fixa de instituições no front (sem banco), nome sugerido que a pessoa pode editar. **Sem logos de marca**: ícone neutro e cor do design system, para não usar marca de terceiros | Médio, só front |
| 3 | **Termos de Uso e Política de Privacidade** com aceite | Não achei no app. Vale ter antes de abrir para outras famílias (planos pagos) e por causa da LGPD: o app guarda dados financeiros. Pede texto revisado por quem entende de LGPD, não só código | Médio (texto + tela + registro do aceite) |

**Mais prints (Início, Patrimônio e Registrar transação)** — ideias novas, em ordem de valor:

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 4 | **Atribuir o lançamento a um membro** ("quem gastou") e ver os gastos de cada pessoa | O lançamento guarda quem **registrou** (`created_by`), não quem **gastou**; as duas coisas são diferentes. Para uma família é a ideia de mais valor desta rodada. Precisa de coluna nova, migration, e o relatório por pessoa tem de vir do banco (o front não soma). Decidir antes: lançamento antigo fica "sem membro"? qualquer membro pode atribuir a outro? | Alto (banco + telas) |
| 5 | **Botão "+" flutuante** sempre visível, abre o lançamento | Hoje as ações rápidas só existem no Início; nas outras telas é preciso voltar. Junta com o formulário novo (ideias 2 e 3 do Livro de contas) | Baixo, só front |
| 6 | **Formulário de lançamento enxuto**: abas Gasto/Ganho/Transferência no topo, nome primeiro, **valor grande**, data com "Hoje", conta já preenchida, um botão com o nome da ação ("Registrar ganho") | Já temos o tipo e todos os campos, mas num formulário comum. Entra no mesmo PR da grade de categorias e da conta principal | Médio, só front |
| 7 | **Aviso de confirmação** depois de registrar ("Ganho registrado") | O Lançamentos só avisa quando dá erro; quem registra não vê confirmação além da linha na lista | Baixo |
| 8 | **Composição do patrimônio** (rosca "Meus ativos" por instituição, com % e opção de barras) e **Ativos × Passivos** | Temos o patrimônio total e as contas com saldo do banco. A rosca pede o percentual de cada conta vindo do banco (como já é em despesas por categoria) | Médio |
| 9 | **Etiquetas (tags)** além da categoria (ex.: "Viagem Floripa") | Não existem. Cuidado: duplica o papel da categoria e da subcategoria; só vale se o dono sentir falta de um recorte que a categoria não dá | Médio (tabela + migration); baixa prioridade |
| 10 | **Personalizar página inicial** (escolher e ordenar os cartões) | O Início é fixo. Pode ser por aparelho (sem banco). Baixa prioridade | Médio |

**Menu do Minhas Economias** — ideias novas:

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 11 | **Atalho do iPhone** ("lance o gasto do cartão sem abrir o app") | **Sem código, já dá para fazer:** o app aceita `https://tudo-azul.vercel.app/lancamentos?novo=cartao` (também `despesa`, `receita`, `transferencia`) e abre o formulário no tipo certo. No app Atalhos do iPhone, a ação "Abrir URL" com esse link serve. Limite: abre no Safari (não no app instalado) e pode pedir o login. Lançar **de verdade sem abrir o app** exigiria um endereço de API com um token pessoal: **não recomendado** (regra do projeto: nunca aceitar nem guardar chave secreta; um token vazado lança dinheiro na família). Extra barato: pôr "Nova despesa" e "Compra no cartão" nos atalhos do `manifest.webmanifest` (hoje só há Lançamentos e Cartões); pelo que sei o iOS não mostra esses atalhos no ícone, o Android sim (a confirmar) | Zero (URL) · Baixo (manifest) |
| 12 | **Regras de transação** (descrição "Mercado Extra" → categoria Mercado automático) | Hoje a categoria é escolhida toda vez. Versão barata, só front: ao digitar a descrição, sugerir a categoria usada da última vez com essa descrição. Versão completa: tabela de regras por família (migration). Junta com o formulário enxuto | Baixo (sugestão) · Médio (regras) |
| 13 | **Segundo fator no login** ("Token", forma de login em Segurança) | Não encontrei segundo fator no app. O Supabase tem TOTP. O app guarda dados financeiros da família: vale pensar, junto com a configuração "Confirm email" que já está pendente | Médio |
| 14 | **Ajuda/FAQ dentro do app** ("como pagar a fatura", "o que é renda eventual") | Não existe; o diário tem a explicação, mas só no repositório | Baixo |

**Menu (continuação — atalhos Parcelas, Central de avisos, Meus Bens, Aprendizado):**

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 15 | **Tela "Parcelas"**: todas as compras parceladas em andamento, de todos os cartões, num lugar só (descrição, parcela n/N, valor da parcela, quando termina, quanto falta) | Hoje o Cartões mostra só o **total** de "Parcelas futuras" por cartão e as parcelas dentro de cada fatura. **Combina com a pendência "antecipar parcelas"**: a lista é o lugar natural do botão "Antecipar". O "quanto falta" de cada compra precisa vir do banco (o front não soma). Sugestão: fazer a lista primeiro, antecipar depois | Médio (função de leitura + tela) |
| 16 | **Central de avisos**: um lugar só com tudo que pede atenção (vencidos, fatura perto de vencer, orçamento estourado, conta nunca conferida) | Essas coisas já aparecem espalhadas no Início (Vencidos, Cartões, conferência das contas). Uma central juntaria tudo e prepararia o terreno para o alerta por push, que continua em "Decisões suas" | Médio |
| 17 | **Meus Bens** (imóvel, carro, com valor) | Não existe. O banco já guarda empréstimo e financiamento (`debts` kind `loan`/`financing`); faltam os bens, para o patrimônio mostrar ativos além das contas. Fica junto com "investimentos" (fev–abr/2027) | Médio; baixa prioridade |

**Segurança (print do dono, 28/10/2026):** a tela deles tem só duas linhas, "Senha de login" (alterar a senha) e "Deletar conta" (apagar a conta). Junto com a ideia 13 (segundo fator), forma uma **tela Segurança** no grupo "Conta":

| # | Ideia | Situação no Tudo Azul | Esforço |
|---|---|---|---|
| 18 | **Alterar a senha com a pessoa logada** | Só existe a recuperação por e-mail (`/recuperar-senha` → `/nova-senha`). Dentro do app não há "trocar senha". Só front (o Supabase já tem `updateUser`); pedir a senha atual antes de trocar | Baixo |
| 19 | **Excluir minha conta** (direito de eliminação da LGPD) | Existe "Zerar tudo" para o dono (apaga os dados da família), mas não existe apagar o **usuário**. Precisa decidir: se o dono sai, o que acontece com a família e os outros membros? Tecnicamente, apagar um usuário do Supabase exige função de servidor com permissão alta; a chave de serviço **nunca** passa pelo front nem por mim (regra do projeto). Junta com a ideia 3 (Termos e Privacidade) | Alto, sensível; só com desenho aprovado |

Ordem sugerida da tela Segurança: (18) trocar senha → (13) segundo fator → (19) excluir conta.

**Não copiar do menu:** "Meu Aprendizado" (conteúdo educativo: fora do foco; a ideia 14, Ajuda/FAQ, cobre o essencial), "Convide seus amigos" (crescimento), "Meu Clube/premium" (planos pagos são futuro), "Avalie o app" e redes sociais, "Gerenciar conexões" (Open Finance, fora de escopo). "Resumo do mês" e "Categorias" já existem (Análises e Categorias).

**Observação sobre o Início do Minhas Economias:** é uma rolagem longa com um cartão para cada coisa, vários ainda vazios ("Objetivos", "Membros", "Cartões"). O Início do Tudo Azul é mais enxuto e orientado a ação ("o que pede atenção agora": vencidos, cartões, últimos lançamentos). Não vale copiar a quantidade de cartões; vale copiar o botão "+" e a composição do patrimônio.
**Tema escuro:** reaparece no topo do app deles (ícone de lua); confirma a ideia 5 do Livro de contas.
**Objetivos** e **Ver meus investimentos:** já estão nas ideias guardadas (metas com prazo junto com investimentos, previsto para fev–abr/2027).

**Já temos:** tipos de conta (corrente, poupança, carteira…), saldo inicial com data, conferência com o extrato.
**Fora de escopo:** o app mostra contas conectadas por Open Finance ("conta manual" × conectada); o Tudo Azul é 100% manual por decisão do projeto.

## Planos pagos (futuro)
Famílias com 1, 3 ou 5–10 pessoas já cabem na trava atual. Falta decidir o que acontece ao reduzir o plano com mais gente que o limite.
