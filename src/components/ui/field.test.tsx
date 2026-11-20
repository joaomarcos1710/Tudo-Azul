// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Field } from './Field'
import { parseBRL } from '../../lib/format'

afterEach(cleanup)

function Host({ valorEmReais }: { valorEmReais?: boolean }) {
  const [texto, setTexto] = useState('')
  return <>
    <Field rotulo="Valor" valorEmReais={valorEmReais} inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} />
    <output data-testid="centavos">{String(parseBRL(texto))}</output>
  </>
}

describe('Field com valorEmReais (centavos entram da direita)', () => {
  it('digitar só os números preenche os centavos primeiro e o teclado é o numérico', async () => {
    const u = userEvent.setup()
    render(<Host valorEmReais />)
    const campo = screen.getByLabelText('Valor') as HTMLInputElement
    expect(campo.getAttribute('inputmode')).toBe('numeric')
    await u.type(campo, '1')
    expect(campo.value).toBe('0,01')
    await u.type(campo, '250')
    expect(campo.value).toBe('12,50')
    expect(screen.getByTestId('centavos').textContent).toBe('1250')
    await u.type(campo, '00')
    expect(campo.value).toBe('1.250,00')
    expect(screen.getByTestId('centavos').textContent).toBe('125000')
  })

  it('apagar dígito a dígito volta pelos mesmos passos e esvazia o campo', async () => {
    const u = userEvent.setup()
    render(<Host valorEmReais />)
    const campo = screen.getByLabelText('Valor') as HTMLInputElement
    await u.type(campo, '1250')
    await u.type(campo, '{Backspace}')
    expect(campo.value).toBe('1,25')
    await u.type(campo, '{Backspace}{Backspace}')
    expect(campo.value).toBe('0,01')
    await u.type(campo, '{Backspace}')
    expect(campo.value).toBe('')
  })

  it('colar "1.250,50" mantém o valor', async () => {
    const u = userEvent.setup()
    render(<Host valorEmReais />)
    const campo = screen.getByLabelText('Valor') as HTMLInputElement
    await u.click(campo)
    await u.paste('1.250,50')
    expect(campo.value).toBe('1.250,50')
  })

  it('sem valorEmReais o campo é o de sempre (o texto e o inputMode passam como vieram)', async () => {
    const u = userEvent.setup()
    render(<Host />)
    const campo = screen.getByLabelText('Valor') as HTMLInputElement
    expect(campo.getAttribute('inputmode')).toBe('decimal')
    await u.type(campo, '12,5')
    expect(campo.value).toBe('12,5')
  })
})
