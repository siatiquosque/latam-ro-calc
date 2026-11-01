# Níveis das habilidades ofensivas

A seleção de níveis pertence ao catálogo comum de classes, não ao componente
visual. `CharacterBase.atkSkills` e `getAtkSkills()` passam as definições por
`src/app/skills/skill-levels.ts`; navegador, cálculo, rotações e ferramentas
recebem as mesmas opções.

Quando uma habilidade não declara `levelList`, o helper gera os níveis de 1
até o máximo declarado no seu `value` (`Tiger Cannon==10`, por exemplo).
O prefixo é preservado: a variante `Tiger Cannon Combo==3` continua distinta
de `Tiger Cannon==3`. Habilidades de nível único não ganham níveis fictícios.
Listas explícitas, inclusive variantes especiais e listas vazias, continuam
autoritativas. Os catálogos de rebalanceamento mantêm seus próprios limites.

Os tempos que antes eram números fixos do nível máximo passam a usar as
curvas por nível de `src/assets/demo/data/skill-delay.json`, quando esse
máximo coincide com a tabela do cliente. Callbacks e exceções explícitas
das definições são preservados. A suíte `skill-delay.spec.ts` confere todos
os níveis que o catálogo permite selecionar.

Lanças elementais, Pétalas Flamejantes, Lança Congelante, Lâmina de Vento e
Magnus Exorcismus também ajustam a quantidade de golpes ao nível. As tabelas
de golpes são descritas pelo cliente em `skill-meta.generated.ts`.

Um nível selecionado prevalece sobre aliases antigos para o nível máximo,
tanto na sessão React quanto no importador de builds do MCP. Links salvos
e rotações mantêm o nível escolhido, sem converter `Arm Cannon==3` em 5.

Esta mudança oferece níveis das habilidades já implementadas; não adiciona
habilidades ausentes nem declara todos os seus danos validados no servidor.
Ao cadastrar uma habilidade com escolhas que não sejam níveis consecutivos,
declarar `levelList` explicitamente em vez de depender da geração comum.

Validação focada:

```sh
npx vitest run src/app/skills/skill-levels.spec.ts src/app/skills/skill-delay.spec.ts src/app/jobs/Sura.flash-combo.spec.ts mcp/src/engine/share.spec.ts
```
