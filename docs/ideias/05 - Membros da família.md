# Ideia 05 — Membros da família (pessoas que geram despesa)

**Status:** em grande parte já implementado. **Origem:** pedido do dono, colado com três partes: um prompt de interface em estilo modal, uma revisão de arquitetura e um prompt de desenvolvimento em três fases. Esta nota diz o que já está no `main` e o que ainda seria ideia nova.

## Já implementado (não reinventar)
- **Tabela `household_people`** (migration 078, PR #205), separada de `household_members` (quem tem login). Tem `name`, `photo_url`, `birthdate`, `relationship` e `status`, com `household_id`.
- **Parentesco com as 8 opções exatas** do pedido (`src/lib/pessoasFamilia.ts`).
- **Classificação** em lançamentos, compras de cartão (parcelas) e recorrências, com `person_scope` ("pessoa", "Toda a família" e "Não classificada") e `person_id` opcional. Ou seja: a distinção que a revisão pediu (`NULL` não significa "toda a família") já existe.
- **Relatório por pessoa** (`RelatorioPessoas.tsx`) e **filtro por pessoa** em Lançamentos e Relatórios.
- **Inativar** pessoa (`status`) em vez de apagar, com a página `PessoasFamilia.tsx` mostrando as inativas sob demanda.
- **Vínculo com login** (migration 080, PR #211 e seguintes): `user_id` opcional em `household_people`, criado automaticamente para quem entra na família. Não concede acesso: é só a ligação entre a identidade financeira e a conta.
- **Modal de cadastro**: o botão "+ Adicionar pessoa" já abre um modal, não uma página nova.

## O que pode ser ideia nova (conferir antes de implementar)
1. **Estado vazio com ícone grande e botão primário** ("Criar membro"). Verificar se a tela atual já tem isso ou só a lista.
2. **Cards ou grade com avatar, nome e parentesco** na lista principal. Hoje é lista; decidir se vale mudar.
3. **Foto de perfil com botão de câmera sobreposto.** O campo `photo_url` existe, mas o envio de foto pela interface precisa ser conferido. Se houver envio, a foto vai para o Storage com acesso restrito à família (não guardar foto em URL pública).
4. **Data de nascimento com máscara "dd/mm/aaaa"** e ícone de calendário. Conferir o componente atual.
5. **Seleção de parentesco em lista estilizada** (bottom sheet ou sub-modal) em vez de `<select>`. Pedido de estilo, sem mudança de regra.
6. **Botão "Criar membro" desativado até o nome ser preenchido**, com feedback ao preencher. Conferir.
7. **Herança em parcelamentos futuros** (a parcela nova herda a pessoa da compra). Confirmar no banco antes de afirmar que funciona; se não funcionar, é uma migration nova.
8. **Modo escuro das imagens de referência**: não aplicar. O app é claro, como já decidido.

## Pontos a decidir
- **Foto**: vale a complexidade (Storage, limite de tamanho, remoção) para um app familiar pequeno, ou o avatar com iniciais basta?
- **Herança**: confirmar se a regra vale para compras futuras de parcelamento e para recorrências já geradas.

## Fora do escopo desta ideia
Dar login a dependentes ou pets, e mudar a regra de acesso da família. A revisão de arquitetura do próprio pedido diz para não mexer nisso.

## Critério de pronto (quando virar PR)
- Testes de isolamento por família em qualquer consulta nova.
- Nenhum cálculo financeiro alterado: pessoa é só classificação analítica.
- Doc 10 (telas) e doc 21 (banco) atualizados quando algo mudar.
