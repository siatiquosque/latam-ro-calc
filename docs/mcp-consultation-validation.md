# Validação da consultoria MCP — 0.1.208-beta

Executada em 02/11/2026 pelo agente desta sessão, escolhendo as chamadas a partir
das respostas do MCP HTTP local, sem chamar qualquer ferramenta Optimize.
É uma consultoria real dirigida pelo agente, não um benchmark estatístico de modelos.

## Cenário e entrada resolvida

Investigar cartas para melhorar HP, preservando os equipamentos, sem MVP, e
verificar o impacto de dano em Médio e Grande.

```json
{
  "class": 4262,
  "level": 250,
  "jobLevel": 50,
  "atkSkill": "Explosion Blaster==5",
  "gear": { "weapon": 560026, "weaponRefine": 11, "armor": 450177, "headUpper": 2221 }
}
```

## Caminho exercitado

1. `tools/list` e `guide(consultoria)` para descobrir o contrato e o roteiro.
2. `validate_build`, com MVP excluída: entrada válida.
3. `get_skill`: dependência condicional de Oleum Sanctum observada no callback
   da fórmula da Mão Explosiva; descrição e POD vêm das informações existentes.
4. `search_items` encontrou Carta Succubus e sua cláusula que referencia 4269.
5. `find_synergies`, com arma travada e `mvpPolicy: none`, encontrou o par
   Succubus/Inccubus e um patch cuja cláusula de VIT foi verificada pelo motor.
6. `evaluate_variants` comparou atual, Succubus sozinha e conjunto, nos alvos
   21077 e 21066. O conjunto foi o melhor HP entre essas três hipóteses e manteve
   o DPS em ambos. A carta sozinha perdeu HP, demonstrando que a composição importa.
7. Duas chamadas `calculate` reabriram o link curto vencedor, uma por alvo, e
   reproduziram HP e DPS exatamente. `validate_build` confirmou a saída sem MVP.

Métricas observadas: 9 chamadas de ferramentas, mais uma listagem inicial;
11.475 bytes de respostas de consultoria e 59.846 bytes incluindo a lista de
ferramentas; soma de latências das requisições de 1.265 ms. Números de uma execução
local, sem promessa de latência pública, consumo de tokens ou desempenho de outros agentes.

## Gates locais de release

- Pool de threads: 9.279 testes passaram; 3 foram ignorados.
- A tentativa anterior com forks teve `kill EPERM` no Windows; foi substituída
  pela execução completa com threads, sem alterar expectativas para acomodá-la.
- Typechecks web, Worker, backend e React passaram; checagem de imports/fronteiras passou.
- Checagens finais de superfície e anexos personalizados passaram, preservando
  o teto de 48.000 caracteres de `tools/list`.
- Artefato web/Node da versão preparado com Novidades nos três idiomas.
- Catálogo de itens e fórmulas não foram alterados. Publicação e verificações
  públicas são uma etapa separada; este documento não afirma que já ocorreram.

## Limites deliberados

As informações do catálogo e o motor são a referência. O MCP preserva expressões
que ainda não tenham decomposição estrutural; não inventa pré-requisitos nem prova
ótimo global. Propostas de refino/grau/stats/skills dependem de `allowChanges` e
de validação/ativação no motor. A amostragem dos callbacks de skills identifica
dependências observadas, sem pretender provar todos os ramos e estados privados.
