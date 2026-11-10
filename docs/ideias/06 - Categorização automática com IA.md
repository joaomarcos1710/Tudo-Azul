# Ideia 06 — Categorização automática de despesas com IA

**Status:** ideia, não implementada. **Origem:** pedido do dono, com um texto que compara três abordagens (LLM por API, ML clássico e híbrida regras + IA) e um exemplo de código em Node.

## O que já existe (não reinventar)
- **`sugerirGrupo(nome)`** (`src/lib/categorias.ts`, usado em `Categorias.tsx`): sugere o grupo de uma **categoria** pelo nome, por palavra. É uma camada 1 de regras, mas ainda só para categorias, não para lançamentos.
- **PR #207, aberta** ("Lançamento inteligente com IA"): usa OpenAI (com um commit que muda para OpenRouter) numa função serverless da Vercel, em `/api/ai/parse-transaction`. Ela transforma frase em lançamento. **Não categoriza.** Mas já resolve o que a ideia precisa de infra: autenticação pelo JWT, checagem de família, categorias lidas do banco sob RLS e chave só no servidor.

Ou seja: a parte de infraestrutura de IA existe em rascunho. A categorização seria uma função nova que reaproveita esse caminho.

## O que a ideia propõe
Três abordagens, do mais simples ao mais complexo:
1. **LLM por API** (ex.: um modelo pequeno da OpenAI): envia nome da transação e lista de categorias, recebe uma categoria. Rápida de implementar.
2. **ML clássico** (ex.: Naive Bayes, treinado com histórico rotulado): sem custo por requisição, mas precisa de muitos exemplos rotulados e falha com estabelecimentos novos.
3. **Híbrida**: regras por palavra primeiro (ex.: "UBER", "POSTO"), IA só quando as regras não decidem.

O texto recomenda começar pela 1 e evoluir para a 3 quando o volume crescer.

## Minha crítica, antes de decidir
1. **A recomendação está ao contrário para este app.** Um app familiar tem pouco volume. A fonte mais precisa e mais barata é o **histórico da própria família**: se "MERCADO X" foi "Alimentação" dez vezes, a regra "mesmo estabelecimento, mesma categoria" acerta sem IA nenhuma. A IA entra só para o que nunca foi visto. Eu começaria por aí, não pela API.
2. **Privacidade.** Descrição de transação é dado financeiro pessoal. Enviar para um terceiro (OpenAI, OpenRouter, Google) é transferência de dado sensível: exige aviso e aceite do usuário, e revisão de LGPD antes de ir para produção. Nada de CPF, número de conta ou nome completo de terceiro no prompt.
3. **Usar nomes de categoria é frágil.** O exemplo do texto passa nomes ("Transporte", "Casa") e pede o nome de volta. No app, categoria tem id, pode ter nome repetido e pode ser renomeada. A resposta da IA precisa voltar como **id**, validado contra a lista do banco (como a #207 já faz), e qualquer valor fora da lista vira "sem categoria".
4. **"Responda Outros" no exemplo precisa existir no banco.** Se "Outros" não for uma categoria real da família, a resposta vira um valor órfão. Definir o comportamento: deixar em branco e pedir confirmação.
5. **Temperatura baixa não dá resultado repetível.** `temperature: 0.1` reduz variação, mas não garante a mesma resposta. Para o usuário, o que importa é a **sugestão aparecer e ser confirmada**, não a IA decidir sozinha. Lançamento salvo sem confirmação humana é o erro a evitar.
6. **Custo e modelo.** O texto cita um modelo "barato" e um Gemini "Flash" sem data. Os nomes de modelo e os preços mudam; conferir a documentação atual no dia da implementação, não confiar no texto.
7. **Abordagem 2 é pouco útil agora.** Sem uma base grande de transações rotuladas, o modelo clássico não tem o que aprender. Vale só se o histórico da família passar a ser um dataset de verdade, o que ainda não é o caso.
8. **Chave só no servidor.** Já é o padrão da #207; manter. Nunca `VITE_` para chave de IA.

## Proposta de ordem (se o dono aprovar)
1. **Camada 1 (sem IA):** sugerir categoria pelo histórico do estabelecimento na própria família, com a mesma normalização de texto que já existe em `sugerirGrupo`. Testes com nomes reais anonimizados.
2. **Camada 2 (IA, opcional e com aceite):** só para o que a camada 1 não resolve, retorna **id** validado, e mostra como sugestão editável.
3. **Medir antes de ampliar:** taxa de acerto da camada 1 e quanto a camada 2 corrigiu, antes de decidir mais IA.

## Fora do escopo desta ideia
Categorizar sem confirmação, mudar lançamento já salvo sem ação do usuário, e enviar dados de outra família.

## Critério de pronto (quando virar PR)
- Testes com estabelecimentos reais anonimizados, incluindo nomes ambíguos.
- Resposta da IA sempre validada contra as categorias do banco.
- Aceite de uso de IA registrado e texto de privacidade atualizado.
- Doc 20 (regras do dinheiro) e doc 22 (segurança) atualizados.
