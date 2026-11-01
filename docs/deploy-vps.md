# VPS com Caddy, PM2 e pré-visualização

Configuração para `laro-calc.siatiquosque.com.br`. Use Node **24 LTS** e a versão de pnpm declarada no
`package.json`. Node 22.9, presente no ambiente local desta revisão, está abaixo
do mínimo declarado no projeto e não é a versão indicada para produção.

## Regra de publicação

Nada é publicado, ativado ou alterado na VPS sem permissão explícita para aquela alteração. Isso inclui
`deploy.ps1`, `activate.sh`, `pm2 reload`, mudanças no Caddy e no arquivo do SQLite de links. Preparar o
artefato, rodar testes e revisar o diff local não precisa de permissão.

### Caddy: sempre com backup

O `/root/web/Caddyfile` hospeda outros sites além da calculadora. Toda alteração nele, automática ou manual,
começa por uma cópia datada ao lado (`Caddyfile.before-laro-<release>` ou `Caddyfile.bak-<motivo>-<data>`),
validação com `caddy validate` antes do reload e escrita no próprio arquivo (o Docker monta o inode). O
`activate.sh` já faz isso e substitui **somente** o bloco `laro-calc.siatiquosque.com.br { … }`, preservando o
resto. O bloco de `deploy/vps/Caddyfile` é só a parte da calculadora, nunca o arquivo inteiro. Nunca cole nem
registre o conteúdo do arquivo: ele contém hashes de `basic_auth` de outros serviços.

## Componentes

Caddy (container Docker `caddy`, rede host) serve os arquivos de
`/srv/tools/laro-calc/current` e encaminha `/mcp`, `/s/*` e `/healthz`
para o processo Node em `127.0.0.1:8787`. O processo reutiliza o handler MCP e os
metadados do Worker. Não é necessário executar Wrangler em produção.

`/s/<token>/` entrega o app com título, descrição, URL canônica e imagem específicos
da build, usando `PUBLIC_APP_ORIGIN` como origem confiável. `/s/<token>/og.png`
usa a capa PNG local com cache curto. `OG_ORIGIN` fica vazio: não há chamadas ao
renderizador social anterior. Título, descrição e URL canônica continuam
específicos da build. Ícones e sprites usam o gateway próprio em
`/game-assets`; veja [game-assets.md](game-assets.md).

## Build e publicação

Para produção, prefira gerar o artefato em CI a partir de um commit identificado,
executando testes e o build com as variáveis do ambiente de destino. Transfira
somente `dist/sakai-ng`, `dist/vps` e a configuração revisada do PM2 para uma pasta
de release identificada pelo commit. O bundle Node é autocontido: a VPS executa
Node, sem precisar instalar as dependências de desenvolvimento para cada release.
Ative pelo symlink `current`, confira a saúde e mantenha a versão anterior para
rollback. Não use a cópia de uma pasta de trabalho com alterações não registradas
como processo regular de publicação.

Clonar e compilar na VPS também funciona como alternativa simples, mas consome
CPU/RAM de produção durante o build. Nesse caso, use um checkout por release,
instalação com lockfile e o mesmo procedimento de ativação/rollback.

O alias SSH é `larotools-vps`. O Node 24 e o PM2 já estão instalados.
O Caddy usa `/root/web/Caddyfile`, montado como arquivo no container, e já
monta `/srv/tools`. Por isso somente os arquivos públicos ficam nessa árvore;
o bundle servidor fica em `/srv/laro-calc/releases/<versão>`, com
`dist/sakai-ng` apontando ao release público correspondente.

Em uma pasta de release na VPS, com as dependências instaladas:

```sh
pnpm install --frozen-lockfile
PUBLIC_APP_ORIGIN=https://laro-calc.siatiquosque.com.br pnpm build:vps
```

Para um domínio alternativo de encurtador já configurado no serviço:

```sh
PUBLIC_APP_ORIGIN=https://laro-calc.siatiquosque.com.br \
SHORTENER_URL=https://SEU-DOMINIO-DO-ENCURTADOR pnpm build:vps
```

`PUBLIC_APP_ORIGIN` define o endpoint MCP embutido no frontend. `SHORTENER_URL`
define o serviço que o frontend chama. As mesmas escolhas devem constar no
ambiente do PM2, em `deploy/vps/ecosystem.config.cjs`.

Após revisar o release e apontar `/srv/laro-calc/current` para ele:

```sh
pm2 startOrReload deploy/vps/ecosystem.config.cjs --update-env
pm2 save
```

Incorpore o bloco de `deploy/vps/Caddyfile` à configuração existente sem substituir
os sites que a VPS já hospeda. Valide com `caddy validate --config /etc/caddy/Caddyfile`
antes de recarregar o serviço. O DNS do domínio deve apontar para a VPS e as portas
80/443 precisam alcançar o Caddy para a emissão automática de TLS.

Verifique `/healthz`, `/mcp/healthz`, `tools/list` via POST em `/mcp`, uma build em
`/s/.../` e o PNG correspondente. O processo Node fica em loopback, acessível
publicamente através do Caddy. Mantenha releases anteriores para rollback do
symlink e recarga do PM2; preserve também seus arquivos/configuração do Caddy.

## Encurtador

O próprio servidor Node encurta os links, em `https://laro-calc.siatiquosque.com.br/l`,
guardando `slug → URL` em um SQLite (`node:sqlite`, nativo do Node 24, sem dependências).
O arquivo fica fora dos releases, em `LINKS_DB` (`/srv/laro-calc/data/links.sqlite`), e
precisa de backup como qualquer dado persistente.

- `POST /l/api/links` com `{ "url": "..." }` devolve `{ "short_url": ".../l/<slug>" }`;
  só aceita links `/s/<token>/` deste site e devolve o mesmo slug para a mesma URL.
- `GET /l/api/links/<slug>` devolve `{ "url": "..." }` e `GET /l/<slug>` redireciona (302).
- `SHORTENER_URL=https://laro-calc.siatiquosque.com.br/l` no build do frontend e no PM2.
  O MCP troca os `share`/`url` de cada resposta pelo link curto e, se o encurtador falhar,
  mantém o link completo.

Um domínio curto separado exigiria apenas outro `SHORTENER_URL` apontando para um servidor
que cumpra o mesmo contrato; links já emitidos continuam válidos.

## Ativação na instalação atual

`deploy/vps/activate.sh <release>` executa a ativação na VPS. Antes, transfira para
`/tmp/laro-<release>/web.tar.gz` o conteúdo do build web e para `node.tar.gz`
os caminhos `dist/vps/server.mjs`, `deploy/vps/ecosystem.config.cjs` e
`deploy/vps/Caddyfile`. Verifique os SHA-256 dos arquivos transferidos.
O script valida a configuração candidata do Caddy, troca os dois symlinks,
inicia o PM2 e verifica saúde local e HTTPS. Se falhar, restaura a configuração
e o release anterior. Não edita os demais sites. O arquivo de configuração é
escrito no mesmo inode, necessário para o bind mount do Docker.

A primeira publicação foi autorizada a partir da árvore de trabalho local;
o identificador usa data, HEAD e sufixo `worktree` para não confundir esse
artefato com um commit limpo. Para as próximas publicações, use CI e commit
identificado conforme o fluxo acima.

Se um novo serviço for provisionado, configure `SHORTENER_URL` no build e no PM2.
Links antigos continuam reconhecidos somente quando fornecidos na importação.

## Resultado da revisão local

Os testes de `mcp/src/node/site.spec.ts` verificam metadados, origem confiável,
tokens com ponto, HEAD, fallback de imagem e o MCP real. O bundle Node é gerado
por `tools/build-vps.mjs`.

O bloqueio de tamanho do build web foi corrigido sem aumentar os limites:
o build remove CSS emitido em duplicidade e envia ao navegador somente as curvas
de tempo necessárias para seleção de nível das habilidades. O build de produção
isolado em `.tmp/bundle-audit` passou nos limites obrigatórios; ainda pode emitir
o aviso preventivo de tamanho. Use saída isolada quando o diretório padrão
estiver em uso pelo ambiente local.
## Publicação verificada

Release ativo: `0.1.194-beta-20261031T214850` (árvore local sobre
HEAD `e3799af7`, não representa commit limpo). Publicado em
`https://laro-calc.siatiquosque.com.br` em 31/10/2026, horário de São Paulo.
Arquivos transferidos com SHA-256 conferido; testes locais do servidor/MCP
passaram. Caddy validado e recarregado no container existente, sem instalar
Certbot. O certificado público foi validado via HTTPS, sem ignorar erros TLS.

Verificações públicas: página inicial, JavaScript de entrada e manifesto de
dados com HTTP 200; `/healthz` e `/mcp/healthz` saudáveis; `tools/list` e
`slot_options` e `optimize_build` para Loki executados no MCP publicado, com
reprodução da métrica pelo link. Ícones de itens/habilidades, sprites de Poring
e Inquisidor e `/game-assets/raw/jobs.json` verificados no domínio público.
PM2 salvo e seu serviço
de inicialização `pm2-root` habilitado. A primeira emissão teve falha transitória
na autoridade certificadora; a primeira ativação reverteu e a segunda concluiu.

A versão `0.1.194-beta` foi conferida no MCP initialize, nos dois endpoints de
saúde, em `/assets/release.json` e na primeira entrada de Novidades (três idiomas).
O fluxo atual de preparação e empacotamento está em [releases.md](releases.md).
