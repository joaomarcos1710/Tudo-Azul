# Origem dos ícones de bandeira

Arquivos `flat/*.svg` de https://github.com/aaronfagan/svg-credit-card-payment-icons (licença **Apache 2.0**, texto em
`LICENSE-Apache-2.0.txt`; os arquivos não foram alterados). As bandeiras (Visa, Mastercard, Elo, American Express,
Hipercard, Diners Club) continuam sendo marcas dos respectivos titulares: aqui só identificam a bandeira do cartão.

O nome do arquivo é a chave gravada no banco (`debts.brand`). Bandeira nova = arquivo novo + chave em `src/lib/bancos.ts`
**e** na lista de `debts_brand_check` (migration nova).
