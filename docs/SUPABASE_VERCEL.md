# Marcos Squad — configurar Supabase e Vercel

Este guia descreve como preparar uma instalação do código com React/Vite, API Node.js na Vercel e PostgreSQL no Supabase.

## Arquitetura do código

A função `api/index.mjs` atende `/api/*`. A interface e os vídeos ficam nos arquivos estáticos do build. O navegador usa as rotas autenticadas da API; a conexão PostgreSQL fica somente no servidor.

A migração em `supabase/migrations` define o schema privado `marcos_squad`. O migrador verifica a identidade do aplicativo, usa transação e registra as versões e os checksums em `schema_migrations`. Revise esse arquivo antes de aplicá-lo na sua instalação.

O `vercel.json` configura Vite, Node 24, build `npm run build`, saída `dist` e API em São Paulo (`gru1`). Ao escolher o banco, confira a proximidade entre as regiões. A API é resolvida antes do fallback da SPA; arquivos ausentes em `/assets`, `/brand` e `/videos` retornam 404. Consulte [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite) e [regiões das Functions](https://vercel.com/docs/functions/configuring-functions/region).

## Configuração do servidor

Escolha os projetos da sua instalação nos painéis do [Supabase](https://supabase.com/dashboard) e da [Vercel](https://vercel.com/dashboard). Vincule o repositório ao projeto Vercel que receberá o aplicativo.

No Supabase, obtenha a URI em **Connect → Transaction pooler**, incluindo a senha do banco no campo correspondente. Use o host fornecido pelo painel. A senha do banco e as chaves de API têm finalidades diferentes; uma chave publishable ou service role não substitui a conexão PostgreSQL usada pelo adaptador.

Defina as variáveis no ambiente de servidor da Vercel, com o tipo Secret/Sensitive quando aplicável:

| Nome | Finalidade |
| --- | --- |
| `SUPABASE_DB_URL` | URI PostgreSQL do Transaction pooler |
| `DASHBOARD_PASSWORD` | Senha do professor, com pelo menos 12 caracteres e até 256 bytes UTF-8 |
| `CRON_SECRET` | Segredo aleatório de pelo menos 16 caracteres para o agendamento interno |
| `SUPABASE_DB_CA` | Certificado raiz opcional, quando exigido pelo provedor |

O modelo vazio fica em `config/environment.example`:

```dotenv
SUPABASE_DB_URL=
DASHBOARD_PASSWORD=
CRON_SECRET=
SUPABASE_DB_CA=
```

Para execução local, copie o modelo para um arquivo `.env` ignorado pelo Git e preencha os valores somente nesse arquivo. Na hospedagem, salve-os nas configurações seguras do projeto e confira o ambiente de destino. Preserve a separação entre produção e testes.

O adaptador usa uma conexão por instância, transações, queries sem prepared statements nomeados e TLS com certificado verificado. Quando necessário, forneça o certificado em `SUPABASE_DB_CA`; mantenha a validação TLS habilitada. Consulte [conexões e pooler do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

Credenciais e conexões privadas devem ficar fora da conversa, do código, dos arquivos compartilhados e de variáveis com prefixo `VITE_`. O frontend deve acessar os dados pela API autenticada, conforme o desenho do aplicativo.

## Aplicar migrações

Com a conexão segura configurada para o processo local:

```bash
npm ci
npm run supabase:migrate
```

O migrador recusa adotar um schema pertencente a outra aplicação e recusa um checksum incompatível com o histórico registrado. Se uma versão já tiver sido aplicada por outro fluxo, confira a identidade e o histórico antes de reconciliá-la usando o procedimento do código.

## Preservar e importar dados anteriores

Antes do corte, faça um backup consistente e valide a restauração em ambiente privado. Interrompa gravações no aplicativo anterior durante o corte definitivo e obtenha um snapshot atualizado.

Importe antes do primeiro acesso que grava configurações ou dados no novo aplicativo: o importador exige destino vazio. Para SQLite, use uma cópia consistente, preservando o arquivo original:

```bash
npm run supabase:import -- --sqlite /CAMINHO/backup.sqlite
```

Para uma instalação anterior em Cloudflare D1, use o Wrangler autenticado e a configuração correspondente à sua própria instalação:

```bash
mkdir -p work
node scripts/wrangler.mjs d1 export DB --remote --config .wrangler/deploy-config.json --output work/d1-export.sql
npm run supabase:import -- --d1-sql work/d1-export.sql
```

A pasta `work/` é ignorada pelo Git e pela publicação Vercel. Mantenha backups e relatórios com permissões restritas, fora dos ZIPs de código e de qualquer repositório público. Registros, contagens e valores de bancos privados não pertencem à documentação compartilhada.

O importador lê um único snapshot da origem, preserva identificadores e dados do aplicativo e exclui demonstrações, sessões e tentativas de login. O destino é bloqueado durante a transação; uma falha de inserção ou contagem reverte a importação. Um destino ocupado é recusado, sem substituição ou merge automático.

## Verificar e publicar

Execute os checks locais antes de publicar:

```bash
npm test
npm run lint
npm run build
npm run preflight
```

O preflight confere os arquivos e as configurações fornecidas ao processo, sem ler `.env` nem mostrar valores. Com a conexão segura disponível, `npm run preflight -- --database` também verifica a identidade, as colunas e os checksums em transação somente de leitura.

Os testes locais com PostgreSQL/PGlite conferem o comportamento do código. A conexão de rede, o certificado, o pooler e o runtime da hospedagem precisam de validação na instalação de destino.

Confira a proteção de acesso da Vercel antes de compartilhar `/aluno`, para que ela permita o público pretendido. O login do professor e os códigos individuais continuam sendo a autenticação do aplicativo.

O cron configurado no código é `0 12 * * *` UTC e exige `Authorization: Bearer CRON_SECRET`. Para usar envios automáticos, configure separadamente as credenciais e os modelos do provedor descritos no [guia de WhatsApp](WHATSAPP_CLOUD_API.md).

Após o deploy, valide a URL confirmada:

```bash
npm run verify:deployment -- https://ENDERECO-DA-INSTALACAO.vercel.app
```

Esse comando confere saúde, autenticação, área do aluno, rotas protegidas, marca e arquivos de exercício. Considere a instalação pronta depois que essas verificações passarem.
