# Versões, Novidades e publicação na VPS

A calculadora usa versões beta sequenciais, incrementando o patch:
`0.1.193-beta` → `0.1.194-beta`. Hoje o único tipo de fragmento suportado é
`patch`; isso não representa uma promessa de estabilidade de API em versão 1.x.

`package.json` é a origem da versão. A primeira entrada de
`src/releases/history.json` deve ter o mesmo valor. O sino **Novidades** lê esse
histórico, e a identificação MCP (`initialize.serverInfo.version`), `/healthz`
e `/mcp/healthz` usam a versão do pacote. Os arquivos web e o servidor são
publicados juntos; a ativação rejeita versões divergentes.

## Notas de uma alteração

Adicione um arquivo JSON de nome único em `release-notes/` com `type: "patch"`
e três listas: `logs` (português), `logs_es` (espanhol), `logs_en` (inglês).
As listas devem ter uma linha correspondente por alteração. Mudanças internas
sem efeito visível não precisam de nota. Validação sem alteração:

```sh
node tools/release-notes.mjs
```

## Preparar a versão

```sh
pnpm release:prepare
```

O comando combina os fragmentos por nome, incrementa o patch, acrescenta a
entrada ao início de Novidades e consome os fragmentos. Datas usam
`America/Sao_Paulo`. Entradas já publicadas e marcadores de leitura não são
reescritos. Sem fragmentos novos, repetir o comando não incrementa a versão.
Ele não faz commit, push, tag, publicação ou anúncio externo.

Revise versão e notas antes de gerar o artefato. No fluxo regular, a versão
preparada deve estar em um commit aprovado, para identificar a origem do build.
Os primeiros deploys desta instalação foram snapshots de uma árvore de
trabalho; seus metadados os identificam como `dirty`, sem fingir um commit limpo.

## Sincronizar com o upstream

O fork e o upstream numeram os patches a partir da mesma base, então a mesma versão pode ter
notas diferentes. Ao sincronizar, as entradas já publicadas pelo fork não mudam, e cada versão
do upstream entra como **uma entrada própria**, renumerada em sequência depois da versão atual
do fork, com data e textos originais. Nunca se juntam notas de versões diferentes numa só.
Procedimento completo na skill `sync-upstream`.

## Validar e empacotar

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm package:vps
```

O pacote fica em `.tmp/vps-artifact/`: `web.tar.gz`, `node.tar.gz` e
`release.json`. A geração recusa fragmentos pendentes e divergência entre
pacote e Novidades. Os metadados registram versão, horário, HEAD e se a árvore
tinha alterações. O frontend recebe a mesma identificação em
`/assets/release.json`. A build usa o domínio atual e o encurtador próprio em `/l`.

O workflow manual **Build VPS release artifact** executa as verificações e
publica o artefato no GitHub Actions. Ele não aloca versões, escreve no Git nem
publica na VPS. Execute-o sobre a revisão já preparada; baixe o artefato para
publicação. Os workflows antigos de Cloudflare, Firebase e anúncios no Discord
foram retirados do fluxo desta instalação.

## Publicar e reverter

**Publicar na VPS exige permissão explícita de quem mantém o projeto**, a cada vez. Preparar a versão, as notas,
o artefato e os testes pode ser feito sem pedir; ativar um release, reiniciar o PM2, recarregar o Caddy ou
alterar arquivos na VPS só depois de um "pode publicar" para aquela alteração. Uma autorização anterior não vale
para a próxima publicação.

Com acesso SSH configurado pelo alias `larotools-vps`, na raiz do projeto:

```powershell
./deploy/vps/deploy.ps1 -ArtifactDirectory .tmp/vps-artifact
```

O script verifica os hashes transferidos e ativa uma pasta de release com versão
e horário no nome. `activate.sh` valida o Caddy, inicia o servidor e confere a
versão do servidor contra o artefato web antes de recarregar o Caddy. Falha na
ativação restaura o release/configuração anterior. A versão pública é conferida
novamente após a ativação. Os releases anteriores permanecem disponíveis.

Repetir a publicação do mesmo artefato não aloca outra versão. Para rollback,
restaure os symlinks de servidor e web ao par anterior e recarregue o PM2,
conforme [deploy-vps.md](deploy-vps.md). Não prepare novas notas para uma simples
repetição ou reversão. Notas aparecem no sino após publicar o novo frontend;
prepará-las localmente não altera o site público.

Os scripts antigos `release-main.mjs` e `announce-pending-releases.mjs` são
legados do upstream e não fazem parte desse fluxo. Não execute
`release-main.mjs` localmente: ele possui operações de Git próprias de uma
automação antiga. Não há postagem automática no Discord.
