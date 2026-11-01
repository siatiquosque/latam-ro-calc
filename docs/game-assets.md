# Ícones e sprites no domínio da calculadora

O app usa `https://laro-calc.siatiquosque.com.br/game-assets` para ícones e
sprites. O Caddy remove esse prefixo e encaminha ao gateway local em
`127.0.0.1:8789`. O gateway lê arquivos locais; não é proxy do serviço anterior.

O código do renderizador é [ragassets](https://github.com/adsonpleal/ragassets),
MIT, revisão `2d106a4dd8639878e378e4d9dd821033d93a947c`. Sua licença deve
acompanhar o binário em `/srv/laro-assets/service`. Os arquivos gráficos do
cliente continuam sujeitos aos direitos dos respectivos titulares.

Layout da VPS:

- `/srv/laro-assets/mirror/data/{sprite,palette,imf}`: arquivos extraídos do GRF.
- `/srv/laro-assets/icons`: ícones PNG por categoria e ID.
- `/srv/laro-assets/raw`: snapshots JSON de itens, classes, monstros, skills e status.
- `/srv/laro-assets/service`: binário Linux, Dockerfile, Compose e licença.

O GRF local usado como base tem data de 19/04/2025. Ícones adicionais do banco
da calculadora são migrados como snapshot para suprir IDs posteriores. Um item
ou visual posterior ao cliente base pode exigir atualização do GRF/mirror;
trocar o domínio não atualiza o conteúdo do cliente automaticamente.

As tabelas `/raw` também foram migradas como snapshots locais. As ferramentas de
sincronização e as instruções do projeto consultam o novo domínio. Atualizações
posteriores exigem regenerar essas tabelas a partir de um cliente atualizado;
não há sincronização automática com o serviço anterior.

Para reproduzir a extração, no checkout da revisão acima:

```powershell
node extract-grf.mjs --extract mirror --grf CAMINHO/data.grf --match 'data\\(sprite|palette|imf)\\'
node extract-grf.mjs --icons icons --grf CAMINHO/data.grf --iteminfo CAMINHO/System/itemInfo_true.lub
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
go -C gateway build -o ../gateway-linux .
```

Transfira o mirror e os ícones para os diretórios acima e o binário como
`/srv/laro-assets/service/gateway`. Copie `deploy/vps/assets.Dockerfile` e
`assets-compose.yml` ao diretório do serviço e execute:

```sh
docker compose -f /srv/laro-assets/service/assets-compose.yml up -d --build
curl --fail http://127.0.0.1:8789/healthz
```

O container é somente leitura, sem capabilities, com memória limitada e porta
publicada apenas em loopback. Sua reinicialização automática independe do release
da calculadora. O Caddy já existente cuida do HTTPS.

Compartilhamento usa URLs completas `/s/<token>/` na origem atual, sem encurtador
externo. A capa PNG foi regenerada a partir do SVG local, sem marca do domínio
anterior. As páginas compartilhadas mantêm título e metadados específicos da
build; a imagem usa a capa local, sem chamar o antigo renderizador social.

Links promocionais, Discord e o formulário que enviava replays ao projeto
anterior foram retirados da interface. Importação/análise local de replays
continua disponível. A importação de links antigos mantém compatibilidade
somente quando o próprio usuário fornece um desses links.
