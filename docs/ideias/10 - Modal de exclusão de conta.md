# Ideia 10 — Modal de exclusão de conta

**Status:** ideia, não implementada. **Origem:** pedido do dono, com uma imagem de referência de modal de confirmação em duas etapas.

## Dependência
Vem da ideia 09: o modal abre ao clicar em "Excluir conta por completo" na zona de perigo de Preferências.

## O que a ideia pede
- **Overlay escurecido** com blur, bloqueando a tela de fundo.
- **Caixa branca** centralizada, com "X" no canto superior direito.
- **Banner de aviso** (cor de atenção, com barra lateral): "Esta exclusão é definitiva: os seus dados serão removidos do Tudo Azul no site e na aplicação."
- **Título**: "Você está prestes a excluir a sua conta: [Nome]", e subtítulo "Leia com atenção:".
- **Duas confirmações obrigatórias**, que se comportam como checkboxes independentes, com divisórias sutis e área de clique ampla:
  1. Todas as movimentações e demais dados serão apagados e não poderão ser recuperados.
  2. Ao seguir, confirmo que a exclusão é definitiva e não pode ser desfeita.
- **Botão "Continuar"** largo, desativado até as duas estarem marcadas. Texto de ajuda: "Marque todas as opções para continuar."

## O que já existe
- **"Zerar tudo"** (`ZerarTudo.tsx`) já tem uma barreira de segurança: prévia do que será apagado, exportação e frase digitada, checada pelo banco. Esse é o padrão mais forte do app.

## Pontos a decidir (importantes)
1. **Apagar o usuário não é só apagar dados.** A família é compartilhada. Se o dono exclui a conta, o que acontece com os outros membros e com as transações da família? Esta é a decisão que mais pesa e precisa ser respondida antes de qualquer tela.
2. **Só o dono ou qualquer membro?** Um membro que sai da família é diferente de excluir a família inteira. Separar os dois casos.
3. **Apagar o login exige o servidor.** Remover o usuário de autenticação precisa de uma chave de serviço, que só pode ficar no backend (Vercel Function), nunca no navegador. Não fazer por SQL no front.
4. **Checkboxes ou frase digitada?** As duas checkboxes são fáceis de marcar sem ler. O "Zerar tudo" usa frase digitada, que exige atenção. Sugiro frase digitada, com o nome da conta, para seguir o padrão do app.
5. **Prazo de arrependimento e backup.** Antes de apagar, oferecer a exportação completa (já existe no app). Decidir se há período de carência, como em serviços de LGPD.
6. **LGPD.** A exclusão do titular é direito, mas os dados da família também são de outros membros. Revisar com a regra de dados do projeto (doc 22, segurança) antes de implementar.
7. **Cor do botão ativo.** A ideia pergunta: perigo (vermelho) ou primária? Recomendo vermelho, porque é irreversível e a referência de perigo já existe no sistema (`prejuizo`).

## Fora do escopo desta ideia
Mudar a exclusão de conta bancária dentro de Contas.

## Critério de pronto (quando virar PR)
- Decisão sobre o destino dos dados da família registrada no doc 30.
- Exclusão do login só no backend, com teste de que o front não tem a chave.
- Teste de que o botão só ativa com a confirmação completa.
- Doc 22 (segurança) e doc 10 (telas) atualizados.
