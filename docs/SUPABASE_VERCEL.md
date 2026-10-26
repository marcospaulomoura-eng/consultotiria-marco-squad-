# Marcos Squad — Supabase e Vercel

A interface React/Vite e os vídeos são servidos pela Vercel. A função `api/index.mjs` atende `/api/*` usando PostgreSQL no Supabase. Os fluxos de professor, alunos, financeiro, prescrição e comunidade mantêm o contrato da interface existente.

## Banco

O projeto criado para esta migração é **Marcos Squad**, referência `avxdirsnlikufygnphoq`, região `sa-east-1`. A migração `supabase/migrations/202610220001_marcos_squad.sql` cria 20 tabelas no schema privado `marcos_squad` e já foi aplicada pela integração Supabase. Ela não altera tabelas de outros schemas nem inclui exemplos.

O registro canônico dessa versão foi reconciliado com o checksum exato do arquivo. O banco agora contém as 20 tabelas do aplicativo mais `schema_migrations`, totalizando 21 tabelas privadas com RLS, sem conceder acesso de schema aos papéis do navegador. Nenhum cadastro antigo foi importado nessa reconciliação.

O `vercel.json` define a API na região **São Paulo (`gru1`)**, próxima ao banco. Essa definição vale para o próximo deploy; não muda a região do Supabase nem comprova uma publicação. Os arquivos estáticos continuam distribuídos pela CDN da Vercel. A opção usa uma única região, conforme a [configuração de regiões das Functions](https://vercel.com/docs/functions/configuring-functions/region).

No servidor, use `SUPABASE_DB_URL` com a conexão oferecida em **Connect → Transaction pooler** no Supabase. O adaptador usa uma conexão por instância, queries sem prepared statements nomeados, transações e TLS com certificado verificado. Quando o provedor exigir um certificado raiz próprio, use `SUPABASE_DB_CA`. Não desabilite a verificação TLS. [Conexões e pooler do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

O navegador não recebe conexão PostgreSQL, service role ou senha. Os papéis `anon` e `authenticated` não têm acesso ao schema. RLS sem políticas de cliente é intencional nesta arquitetura de API no servidor; acesso operacional deve ser configurado para uma conexão autorizada do servidor, nunca abrindo as tabelas para o frontend.

Para aplicar migrações pelo CLI local, com conexão segura configurada em `.env`:

```bash
npm ci
npm run supabase:migrate
```

O migrador verifica a identidade do schema, registra checksums, usa uma transação e recusa adotar tabelas de uma instalação não identificada. Se a migração inicial foi aplicada pela integração, a primeira execução local apenas reconcilia seu registro e as estruturas idempotentes.

## Preservar os dados anteriores

Antes de compartilhar o novo aplicativo, preserve os dados anteriores com backup consistente e valide a migração em ambiente privado. O backup não integra o código, o GitHub ou o ZIP para download. Não publique registros, contagens ou valores obtidos de bancos privados.

1. Faça um backup e interrompa novas gravações no aplicativo anterior durante o corte definitivo. Uma cópia consistente representa um instante; mudanças posteriores não entram automaticamente no novo banco.
2. Prepare o Supabase e importe **antes do primeiro acesso que grava configurações/dados**, pois o importador exige destino vazio.
3. Para SQLite, utilize uma cópia consistente do arquivo, preservando a pasta original. O importador também lê a origem em um único snapshot.

```bash
npm run supabase:import -- --sqlite /CAMINHO/backup.sqlite
```

Para origem Cloudflare D1, exporte o banco original com o Wrangler autenticado, usando o vínculo existente:

```bash
node scripts/wrangler.mjs d1 export DB --remote --config .wrangler/deploy-config.json --output work/d1-export.sql
npm run supabase:import -- --d1-sql work/d1-export.sql
```

Crie a pasta `work/` antes da exportação. Ela é ignorada pelo Git e pela publicação Vercel. O export contém dados privados e deve ficar fora de arquivos compartilhados.

O importador preserva identificadores, configurações, histórico financeiro, prescrições e comunidade. Não importa demonstrações nem sessões/tentativas de login; todos entram novamente no novo endereço. Códigos individuais existentes permanecem como hashes. A origem não é alterada. O destino é bloqueado contra gravações concorrentes durante a transação e a importação é revertida se alguma inserção ou contagem falhar. Destinos com dados são recusados, sem merge automático.

## Vercel

Foi criado o projeto **marcos-squad**, ID `prj_yQHuYU7pQrW0cb4KZlO4UC6JnORY`. A configuração local `.vercel/project.json` registra o vínculo e fica ignorada pelo Git. Nenhum deploy é comprovado pela simples criação do projeto.

As configurações de build já estão em `vercel.json`: Vite, `npm run build`, saída `dist` e Node 24. A API é resolvida antes do fallback da SPA. Arquivos ausentes em `/assets`, `/brand` e `/videos` retornam 404, em vez de HTML. [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite).

Configure apenas no servidor: `SUPABASE_DB_URL`, `DASHBOARD_PASSWORD` e `CRON_SECRET`, além do certificado opcional e das variáveis WhatsApp quando utilizadas. Nenhuma delas deve ter prefixo `VITE_`. Não envie credenciais na conversa nem no código. O calendário do aplicativo usa São Paulo; o cron diário é `0 12 * * *` UTC e exige `Authorization: Bearer CRON_SECRET`. Sem credenciais da Meta a rotina não envia mensagens.

Em 26/10/2026, o build foi configurado no projeto remoto e `CRON_SECRET` foi gerado e salvo como variável sensível de Production. O usuário também salvou `DASHBOARD_PASSWORD`; a presença e o escopo foram conferidos sem ler o valor. Resta a conexão do banco nas [variáveis do Marcos Squad](https://vercel.com/marcospaulo-moura-4543/marcos-squad/settings/environment-variables), com tipo **Secret/Sensitive** e ambiente **Production**:

| Nome | Valor a preencher no painel seguro |
| --- | --- |
| `SUPABASE_DB_URL` | URI completa de [Connect → Transaction pooler](https://supabase.com/dashboard/project/avxdirsnlikufygnphoq?showConnect=true&method=transaction), substituindo `[YOUR-PASSWORD]` pela senha do banco |
| `DASHBOARD_PASSWORD` | Já definida pelo usuário; senha do professor com pelo menos 12 caracteres |

A senha do banco não é a senha da conta Supabase. A integração disponível não recupera a senha de projetos existentes, e uma chave publishable/service role não substitui essa senha no driver PostgreSQL. Não copie valores privados para a conversa nem para arquivos compartilhados. O deploy e a verificação da conexão só podem avançar depois que esses valores forem salvos.

A proteção adicional da própria Vercel precisa ser conferida antes de compartilhar `/aluno`: uma exigência de login na Vercel pode impedir que alunos externos abram o app. A proteção de dados do aplicativo continua sendo seu login e seus códigos individuais.

## Verificação antes da publicação

```bash
npm test
npm run lint
npm run build
npm run preflight
```

O preflight verifica arquivos e nomes das configurações no processo, sem ler `.env` nem exibir seus valores. Falha enquanto faltarem `SUPABASE_DB_URL`, `DASHBOARD_PASSWORD` ou `CRON_SECRET`. Com as variáveis fornecidas de forma segura ao processo, `npm run preflight -- --database` também confere a identidade do aplicativo, colunas e checksums das migrações em uma transação somente de leitura. Não migra, importa, inicializa dados nem publica. O vínculo local não comprova acesso à conta Vercel.

Os testes usam apenas dados fictícios. PGlite executa o PostgreSQL real em memória, mas não comprova rede, TLS ou o comportamento de duas conexões independentes do pooler remoto. Após publicar, execute:

```bash
npm run verify:deployment -- https://ENDERECO-CONFIRMADO.vercel.app
```

Esse teste confere saúde, autenticação, `/aluno`, rotas protegidas, marca e arquivos de exercício. Uma URL só deve ser informada como pronta após a verificação online.
