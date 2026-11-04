---
tags: [tudo-azul, deploy]
---
# Deploy e operação

## Front (automático)
Merge no `main` → **Vercel** publica em https://tudo-azul.vercel.app em poucos minutos. É PWA: depois do deploy, **feche e reabra o app** (uma ou duas vezes) para pegar a versão nova.

## Banco (manual, sempre com "pode")
Só pelo workflow do GitHub **"Supabase — aplicar migrations (produção)"**:
1. Rodar em **simular** (nada é alterado) e **ler o log**: deve listar só as migrations esperadas.
2. Rodar em **aplicar**, com a confirmação `APLICAR`.
3. Conferir o log "depois": local e remoto iguais.
Nunca editar migration já aplicada.

## Regras de merge
- Só mergeia com o seu "pode".
- Merge commit, com a **trava do commit exato** testado.
- PR nasce **rascunho**; sai do rascunho só para mergear.
- Antes de mergear: CI verde **e** sem conflito; se a `main` andou, atualizar a branch e validar de novo.

## Quando algo falha
- CI vermelho: reproduzir, corrigir, provar, empurrar (nunca pular teste).
- "Rate limit" ao instalar o CLI do Supabase: erro da infraestrutura do GitHub; rodar a simulação de novo.

## Preview dos branches do Claude desligado (04/11/2026)
`vercel.json` → `git.deploymentEnabled` com `"claude/**": false`: push em branch `claude/...` não gera preview (o plano gratuito tem 100 deploys por dia). Produção (`main`) segue automática. Para ver um preview pontual, publique pela Vercel à mão ou tire a regra numa PR.
