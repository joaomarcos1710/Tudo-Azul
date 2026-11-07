import type { PessoaFamilia } from '../lib/pessoasFamilia'

interface Props {
  pessoas: PessoaFamilia[]
  personId: string | null
  isSharedExpense: boolean
  onChange: (value: { personId: string | null; isSharedExpense: boolean }) => void
  id?: string
}

/** Atribuição analítica da despesa. "Toda a família" nunca é uma linha em household_people. */
export function PessoaSelectField({
  pessoas, personId, isSharedExpense, onChange, id = 'despesa-pessoa',
}: Props) {
  const selecionadaInativa = personId ? pessoas.find((p) => p.id === personId && !p.ativo) : undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-marinho">Despesa de quem?</label>
      <select
        id={id}
        value={isSharedExpense ? 'shared' : personId ?? 'unassigned'}
        onChange={(event) => {
          const value = event.target.value
          if (value === 'shared') onChange({ personId: null, isSharedExpense: true })
          else if (value === 'unassigned') onChange({ personId: null, isSharedExpense: false })
          else onChange({ personId: value, isSharedExpense: false })
        }}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-700 focus:border-azul focus:outline focus:outline-2 focus:outline-azul"
      >
        <option value="unassigned">Não classificada</option>
        <option value="shared">👨‍👩‍👧‍👦 Toda a família</option>
        {pessoas.filter((p) => p.ativo).length > 0 && (
          <optgroup label="Pessoas cadastradas">
            {pessoas.filter((p) => p.ativo).map((pessoa) => (
              <option key={pessoa.id} value={pessoa.id}>{pessoa.nome}</option>
            ))}
          </optgroup>
        )}
        {selecionadaInativa && (
          <optgroup label="Histórico">
            <option value={selecionadaInativa.id}>{selecionadaInativa.nome} (inativa)</option>
          </optgroup>
        )}
      </select>
    </div>
  )
}
