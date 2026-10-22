# Publicação gratuita da Marcos Squad

A versão pública usa **Cloudflare Workers + D1**: interface, API, HTTPS e banco persistente na mesma aplicação. A conta deve permanecer no plano **Workers Free**. O publicador não ativa assinatura, domínio pago ou upgrade. O plano gratuito tem limites de uso; consulte os preços e limites oficiais antes de mudar de plano:

- [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1](https://developers.cloudflare.com/d1/platform/pricing/)

## Autorizar a conta

1. Crie ou acesse sua [conta gratuita Cloudflare](https://dash.cloudflare.com/sign-up).
2. Em [API Tokens](https://dash.cloudflare.com/profile/api-tokens), crie um token personalizado limitado à sua conta, com as permissões de conta **Workers Scripts: Edit**, **D1: Edit** e **Account Settings: Read**.
3. Nas configurações seguras deste ambiente, preencha `CLOUDFLARE_API_TOKEN` com o token e `MARCOS_DASHBOARD_PASSWORD` com a senha escolhida para o painel. A senha deve ter pelo menos 12 caracteres e até 256 bytes UTF-8. Os valores não devem ser enviados na conversa nem incluídos no Git.

O token é usado somente para a API `api.cloudflare.com`. A senha do painel é enviada diretamente por HTTPS ao armazenamento de secrets do Worker, sob o nome `DASHBOARD_PASSWORD`; o publicador não grava a senha em arquivos. O nome `MARCOS_DASHBOARD_PASSWORD` separa a credencial de publicação da autenticação do servidor local.

As regras de rede necessárias são `api.cloudflare.com`, `developers.cloudflare.com` e `*.workers.dev`. Preserve os outros destinos já configurados. Salvar um rascunho de configuração não executa a publicação.

## Publicar

```bash
npm ci
npm run cloud:deploy
```

O publicador identifica a conta, cria o banco D1 e o subdomínio gratuito quando necessário, aplica as migrações, publica os arquivos e configura a senha. A aplicação permanece fechada até a senha estar configurada. Só apresenta a URL depois de verificar por HTTPS o login obrigatório, o bloqueio de dados sem autenticação, o banco e a imagem da marca.

O endereço é fornecido pela Cloudflare sob `workers.dev`; não há um endereço público válido antes da publicação real. Se o token acessar mais de uma conta, configure o identificador não secreto `CLOUDFLARE_ACCOUNT_ID`. O nome opcional `CLOUDFLARE_WORKER_NAME` tem o padrão `marcos-squad-painel`.

Os cadastros públicos começam vazios. Os clientes fictícios e o SQLite do ambiente local não são enviados à internet. Os dados de uso público ficam no D1 e são preservados nos próximos deploys. O Worker agenda a rotina diária do WhatsApp, mas ela não envia nada até configurar as credenciais, cadastrar modelos aprovados e registrar a autorização de cada contato. Veja [como configurar a Cloud API](WHATSAPP_CLOUD_API.md).

## Atualizações e retomada

Use novamente `npm run cloud:deploy` para atualizar. O script identifica o Worker por um marcador da aplicação e confere o vínculo do banco antes de alterar recursos. Bancos de mesmo nome sem comprovação de propriedade não são adotados automaticamente. O recibo em `.wrangler/provisioning.json` e a configuração em `.wrangler/deploy-config.json` permitem retomar uma publicação interrompida sem trocar silenciosamente o banco. Esses arquivos não contêm senhas e são ignorados pelo Git.

Para trocar a senha, atualize o campo seguro `MARCOS_DASHBOARD_PASSWORD` e publique novamente. Sessões anteriores deixam de ser válidas após a troca.

## Validação local

```bash
npm test
npm run lint
npm run build
npm run cloud:check
npm run cloud:migrate:local
```

`cloud:check` gera um pacote de validação sem publicar recursos e sem precisar de token. A migração com `--local` usa o emulador local do D1. Esses comandos não comprovam uma publicação remota.

Para executar a versão Workers localmente, crie um arquivo ignorado `.dev.vars` com uma senha de desenvolvimento no campo `DASHBOARD_PASSWORD` e inicie `npm run cloud:dev`. Não use credenciais de produção em fixtures. Em navegadores locais, utilize o hostname `localhost` para testar o cookie seguro. A versão pública usa HTTPS.
