/**
 * Cores dos gráficos (validadas com o validador da skill de dataviz no fundo branco dos cards, em 05/11/2026:
 * faixa de luminosidade, croma, separação para daltonismo ΔE 24,7 e visão normal ΔE 33,6, contraste ≥ 3:1).
 * O app ainda não tem modo escuro; quando tiver, os passos escuros precisam ser escolhidos e validados à parte.
 * A cor nunca é a única informação: todo gráfico mostra o nome (legenda ou rótulo) e o valor em texto.
 * Desde a #184 os tons vêm de src/lib/cores.ts (a mesma fonte das classes do Tailwind): nada de hex solto aqui.
 */
import { CORES, GRAFICO } from '../../lib/cores'

/** Série única (linha, barras de categoria): azul. */
export const COR_LINHA = CORES.lucro.marca
/**
 * Balanço mês a mês: receita azul × despesa vermelha. Até a #184 a despesa do Início era laranja (#eb6834) e a saída
 * dos Relatórios vermelha: dois tons para a mesma coisa. Unificado no vermelho do prejuízo (pedido do dono).
 */
export const COR_RECEITA = CORES.lucro.marca
export const COR_DESPESA = CORES.prejuizo.marca
/**
 * Relatórios, Entradas x Saídas (#179, pedido do dono: "o verde do Organizze, no Tudo Azul azul; vermelho para negativo").
 * Entrada azul (a mesma COR_RECEITA) e saída vermelha (Tailwind red-600, 4,8:1 no branco, acima de 3:1 para barra).
 * Azul × vermelho separam bem também para daltonismo (protan/deutan confundem verde e vermelho, não azul e vermelho).
 * Desde a #184 é a mesma COR_DESPESA do Início (o laranja saiu).
 */
export const COR_SAIDA = COR_DESPESA
/**
 * Saldo das contas como área clara ao fundo das barras (Relatórios, #179, como no Organizze): escala própria, sem eixo.
 * A área é contexto (contraste baixo de propósito, para não competir com as barras): o valor de cada saldo está no
 * toque/tooltip e na tabela logo abaixo (regra de alívio do validador), e a borda mostra a forma.
 */
export const COR_SALDO_AREA = GRAFICO.saldoArea
export const COR_SALDO_BORDA = GRAFICO.saldoBorda
/** Grade, eixo do zero, coluna em foco e contorno dos pontos: neutros, sem significado de dinheiro. */
export const COR_GRADE = GRAFICO.grade
export const COR_EIXO = GRAFICO.eixo
export const COR_FOCO = GRAFICO.destaque
export const COR_FOCO_SOBRE_AREA = GRAFICO.destaqueSobreArea
export const COR_CONTORNO = GRAFICO.contorno
/** Texto dos eixos (valores e meses): o cinza neutro, 4,8:1 no branco. */
export const COR_TEXTO_EIXO = CORES.neutro.marca
