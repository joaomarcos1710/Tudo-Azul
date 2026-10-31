# Prompt para Claude Code — tela Lançamentos

Estamos trabalhando no repositório `joaomarcos1710/Tudo-Azul`, um dashboard financeiro familiar em React 18, TypeScript, Vite e Supabase. A remoção da conferência manual com extrato está sendo preparada em PR separada: não reintroduza tela, link, alerta, RPC de gravação/desfazer ou trava de período. O histórico legado permanece somente para leitura/exportação. Não faça merge, deploy ou qualquer alteração no Supabase hospedado.

## Objetivo

Ajustar a experiência da tela **Lançamentos**, mantendo a arquitetura, os padrões visuais e os cálculos financeiros atuais.

## Requisitos de UX

1. Ao tocar em **Novo lançamento**, abrir diretamente o formulário de novo lançamento. Não abrir, expandir nem alterar filtros como efeito colateral.
2. No painel de filtros, a ordem visual deve ser **Tipo → Categoria → Conta**:
   - **Tipo** vem primeiro: Receita ou Despesa;
   - **Categoria** vem logo depois e mostra somente categorias do tipo selecionado;
   - **Conta** e demais filtros ficam depois, sem preceder o filtro Tipo.
3. Se o tipo estiver sem seleção ou em “Todos”, definir um comportamento explícito e coerente para Categoria (por exemplo, categoria desabilitada até escolher Receita/Despesa); não mostrar categorias incompatíveis.
4. Trocar o tipo deve limpar ou reajustar uma categoria selecionada que não pertença ao novo tipo, sem deixar filtro invisivelmente inconsistente.
5. Acessibilidade: rótulos associados aos controles, navegação por teclado e estados desabilitados perceptíveis.

## Restrições técnicas

- Antes de editar, leia a implementação e os testes existentes da tela Lançamentos, os componentes de filtros e os helpers de categoria; siga os padrões do repositório.
- Não altere regras de saldo, esquema do banco, migrations ou dados históricos.
- Não misture este trabalho com a remoção da conferência, correções de dependências, dívidas/investimentos ou mudanças visuais não solicitadas.
- Use os scripts existentes de typecheck, testes e build. Acrescente testes para os requisitos abaixo.
- Não aplique migrations e não interaja com o Supabase hospedado.

## Critérios de aceite

- Clicar em **Novo lançamento** não abre filtros e não modifica os filtros vigentes.
- A ordem visual dos filtros começa por Tipo → Categoria; Conta e demais filtros aparecem depois.
- Receita mostra somente categorias de receita; Despesa mostra somente categorias de despesa.
- Alternar Receita/Despesa remove ou reinicia uma categoria incompatível.
- Testes automatizados cobrem a abertura do formulário, a ordem dos campos, as listas filtradas e a troca de tipo.
- `npm test`, `npm run typecheck` e `npm run build` passam.

Entregue as mudanças em PR própria, atualize a versão para o número real dessa PR conforme `docs/VERSOES.md`, e descreva os arquivos modificados e os testes executados. Não faça merge; aguarde autorização explícita.
