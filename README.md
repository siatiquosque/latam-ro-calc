# Simulador RO LATAM

Simulador de dano de **Ragnarok Online** adaptado para o servidor **LATAM** — interface
em português (pt-BR) e rebalanceamento de classes/habilidades para a versão LATAM.

Fork e tradução do projeto [tong-calc-ro](https://github.com/turugrura/tong-calc-ro), de
turugrura.

🔗 **Acesse online:** https://simulador.latam-tools.com.br

> ⚠️ **Beta.** Alguns itens podem estar faltando ou imprecisos. A classe totalmente
> validada até agora é **Falcão do Vento**. As notas de cada versão ficam em
> **Novidades**, no próprio app (botão da versão, na barra superior).

## Recursos

- **Cálculo de dano** para 70+ classes, incluindo as 4ª classes (Cavaleiro Draconiano,
  Magus, Cardeal, Engenheiro, etc.), com fórmulas rebalanceadas para o LATAM.
- **Importação por replay** — carregue classe, nível, atributos e equipamento a partir de
  um arquivo `.rrf` exportado do jogo.
- **Simulações salvas** com renderização do personagem (paper-doll) via CDN ragassets.
- **Compartilhamento por link** — o build da simulação é codificado na URL.
- **Tabelas de resumo** de status, HP/SP e dano por habilidade.

## Stack

- [React 19](https://react.dev/) + [design system próprio](docs/design-system.md)
- TypeScript 7, esbuild
- [Vitest](https://vitest.dev/) para testes unitários da engine de cálculo
- Playwright para interações reais e comparação visual da interface
- Node 24 LTS + [pnpm](https://pnpm.io/); deploy na VPS com Caddy e PM2

A aplicação usa React com serviços explícitos e uma sessão de cálculo externa ao
render. A comparação com a versão Angular, dependências e medições ficam em
[docs/react-migration.md](docs/react-migration.md).

## Como rodar

Requer **Node 22.12+**, Node 24 ou Node 26+, e **pnpm 12.8.1**:

```bash
pnpm install --frozen-lockfile
pnpm start          # servidor local em http://localhost:4200
```

> O build usa TypeScript 7 e esbuild com TSX e JSX automático.
> O servidor Node recompila em um processo separado e recarrega a página por SSE após
> um build bem-sucedido; continua servindo o último build durante a recompilação.
> `pnpm start -- --host 127.0.0.1 --port 4200` altera host/porta.
> As configurações do pnpm ficam em `pnpm-workspace.yaml`; apenas esbuild executa
> postinstall na raiz. Os peers necessários são declarados explicitamente.

## Scripts úteis

A origem, atualização e validação das tabelas de HP/SP estão documentadas em
[HP/SP base](docs/hp-sp.md).
A seleção comum de níveis está descrita em [Níveis das habilidades](docs/skill-levels.md).

| Comando             | Descrição                                      |
| ------------------- | ---------------------------------------------- |
| `pnpm start`        | Dev server (AOT/esbuild, reload) na porta 4200        |
| `pnpm build`        | Build de produção (esbuild)                    |
| `pnpm test`         | Testes unitários (Vitest)                      |
| `pnpm test:watch`   | Vitest em modo watch                           |
| `pnpm test:cov`     | Testes com cobertura                           |
| `pnpm e2e`         | Comparação visual e interações no navegador    |
| `pnpm e2e:ci`      | Mesma suíte sem comparar imagens (usada no CI) |
| `pnpm typecheck`   | React, Worker e testes de backend        |
| `pnpm typecheck:react` | Tipos dos componentes e serviços React       |
| `pnpm lint:check`  | Imports não usados e fronteiras da engine                    |
| `pnpm lint`         | Mesmas verificações, sem alterar arquivos                             |

## Estrutura

```
src/react/       # aplicação, telas TSX, controles/hooks, serviços e sessão
src/app/
├── ui/          # estilos compartilhados e nomes dos ícones
├── core/        # engine de cálculo (calculator, damage, hp/sp) — coberta por testes
├── jobs/        # uma classe por arquivo (70+); fórmulas e habilidades
├── replay/      # parser de replay .rrf → modelo de personagem
├── domain/      # tipos e modelos de domínio
├── api-services/, layout/ # modelos compatíveis e referências dos estilos
├── constants/, utils/
tools/           # scripts de build da base LATAM (itens, monstros, habilidades, ícones)
```

A pasta `tools/` contém os scripts que geram a base de dados LATAM
(`sync-latam-db.mjs`, `sync-monster-db.mjs`, `build-latam-monsters.mjs`) a partir das
tabelas que o [ragassets](https://github.com/adsonpleal/ragassets) publica em
`https://laro-calc.siatiquosque.com.br/game-assets/raw/` — é ele que lê os arquivos do jogo; aqui só se
baixa o JSON pronto. As habilidades (nomes, descrições e ids) ficam no catálogo estático
em `src/app/skills/`.

## Base de dados de itens

O banco de itens fica em `src/assets/demo/data/item.json`. O campo `script` (os bônus de
cada item) usa uma sintaxe compacta de condições e valores. A referência completa — todos
os campos, chaves de bônus, condições e exemplos comentados — está em
**[docs/item-json.md](docs/item-json.md)**.

## Deploy

A instalação atual usa a VPS com Caddy, PM2 e o gateway próprio de imagens.
A política de versões e Novidades está em [docs/releases.md](docs/releases.md).

```sh
pnpm release:prepare
pnpm typecheck
pnpm lint
pnpm test
pnpm package:vps
```

Depois de revisar o artefato, publique com
`./deploy/vps/deploy.ps1 -ArtifactDirectory .tmp/vps-artifact` no PowerShell.
O workflow manual **Build VPS release artifact** gera esse mesmo pacote no CI,
sem publicar ou alterar o Git. Configuração e rollback:
[docs/deploy-vps.md](docs/deploy-vps.md). Imagens e dados do cliente:
[docs/game-assets.md](docs/game-assets.md).

Os workflows de publicação no Cloudflare, previews no Firebase e anúncios no
Discord não fazem parte dessa instalação. O Worker permanece no código como
alternativa de runtime e para testes; seu desenvolvimento usa
`pnpm --dir tooling/cloudflare install --frozen-lockfile` e `pnpm dev:worker`.

## Créditos

Projeto original: [tong-calc-ro](https://github.com/turugrura/tong-calc-ro) por turugrura.
Esta é uma adaptação não-oficial para a comunidade LATAM. Ícones de itens/classes e render
de personagem fornecidos pelo [ragassets](https://github.com/adsonpleal/ragassets).
