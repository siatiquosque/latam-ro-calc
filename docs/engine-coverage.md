# Cobertura do motor: o que o `item.json` guarda e o que o cálculo usa

Resultado da auditoria "texto do cliente (GRF) × db" feita em 09/11/2026. Serve para saber, antes de corrigir um
bônus no `item.json`, se o motor realmente o usa. Fonte: `src/app/core/calculator.ts` e
`src/app/core/damage-calculator.ts`.

## Calculado

| Chave | O que o motor faz |
|---|---|
| `pow` (POD) | POD total × 5 no ATQ de status; `floor(POD / 3)` em P.ATQ |
| `con` (CON) | `floor(CON / 5)` em P.ATQ e em S.ATQM; CON × 2 em Precisão e em Esquiva |
| `spl` (FEI) | FEI × 5 no ATQM de status; `floor(FEI / 3)` em S.ATQM |
| `crt` (CRV) | `floor(CRV / 3)` em T.CRIT |
| `sta` (STA) | TEN += STA + `floor(STA / 3) × 5` |
| `wis` (SAB) | TENM += SAB + `floor(SAB / 3) × 5` |
| `res`, `mres` (TEN, TENM) | somados à TEN/TENM da build (também ganham 2 por refino em algumas peças) |
| `pAtk`, `sMatk`, `cRate` | somados direto |
| `pene_res`, `pene_mres` | Ignora TEN/TENM. Teto de 50% (`effected_pene_res` e `effected_pene_mres`) |
| `pene_res_race_*`, `pene_res_class_*` (e `mres`) | somam com `pene_res`, no mesmo teto de 50% |
| `p_pene_race_*`, `p_pene_class_*` | Ignora DEF. Teto de 100% |
| `m_pene_race_*`, `m_pene_class_*` | Ignora DEFM. Teto de 100% |
| `ignorePhysicalDef` | vira 100% de DEF ignorada |

Chaves de classe de monstro: `class_normal`, `class_boss`, `class_all`. Chaves de raça: `race_<raça>` e `race_all`.

## Guardado, mas sem efeito no cálculo

| Chave | Linha no texto | Situação |
|---|---|---|
| `hplus` (C.Mais) | `C.Mais +N` | Está no modelo, no rótulo e na busca. Nenhum cálculo de dano a usa. 12 itens a têm no db |

## Sem chave no motor

Estas linhas aparecem na descrição pt-BR e o motor não tem onde registrá-las. A auditoria as deixa de fora.

- `Ignora +N de DEFM adicional` (valor fixo de DEFM ignorada, não porcentagem). Exemplo: Cajado Perfurador (1626).
- `autobonus` e `bAutoSpell` do rAthena. Esperam o motor passar a suportar proc.

## Como ler a auditoria

- "Falta o bônus" quer dizer que o texto traz o bônus e o db não. Só vale corrigir se a chave estiver na tabela "Calculado".
- Linhas dentro de blocos `Conjunto`, `[Efeito]` e `Ao realizar ataques físicos:` não são comparadas ainda.
- As raças `Humano` e `Doram` (jogadores) são ignoradas de propósito: o motor só calcula contra monstros.
