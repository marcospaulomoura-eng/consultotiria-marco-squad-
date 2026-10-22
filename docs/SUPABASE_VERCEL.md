# Marcos Squad — Supabase e Vercel

A interface React/Vite e os vídeos são servidos pela Vercel. A função `api/index.mjs` atende `/api/*` usando PostgreSQL no Supabase. Os fluxos de professor, alunos, financeiro, prescrição e comunidade mantêm o contrato da interface existente.

## Banco

O projeto criado para esta migração é **Marcos Squad**, referência `avxdirsnlikufygnphoq`, região `sa-east-1`. A migração `supabase/migrations/202610220001_marcos_squad.sql` cria 20 tabelas no schema privado `marcos_squad` e já foi aplicada pela integração Supabase. Ela não altera tabelas de outros schemas nem inclui exemplos.

No servidor, use `SUPABASE_DB_URL` com a conexão oferecida em **Connect → Transaction pooler** no Supabase. O adaptador usa uma conexão por instância, queries sem prepared statements nomeados, transações e TLS com certificado verificado. Quando o provedor exigir um certificado raiz próprio, use `SUPABASE_DB_CA`. Não desabilite a verificação TLS. [Conexões e pooler do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

O navegador não recebe conexão PostgreSQL, service role ou senha. Os papéis `anon` e `authenticated` não têm acesso ao schema. RLS sem políticas de cliente é intencional nesta arquitetura de API no servidor; acesso operacional deve ser configurado para uma conexão autorizada do servidor, nunca abrindo as tabelas para o frontend.

Para aplicar migrações pelo CLI local, com conexão segura configurada em `.env`:

```bash
npm ci
npm run supabase:migrate
```

O migrador verifica a identidade do schema, registra checksums, usa uma transação e recusa adotar tabelas de uma instalação não identificada. Se a migração inicial foi aplicada pela integração, a primeira execução local apenas reconcilia seu registro e as estruturas idempotentes.

## Preservar os dados anteriores

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

A proteção adicional da própria Vercel precisa ser conferida antes de compartilhar `/aluno`: uma exigência de login na Vercel pode impedir que alunos externos abram o app. A proteção de dados do aplicativo continua sendo seu login e seus códigos individuais.

## Verificação antes da publicação

```bash
npm test
npm run build
```

Os testes usam apenas dados fictícios. PGlite executa o PostgreSQL real em memória, mas não comprova rede, TLS ou o comportamento de duas conexões independentes do pooler remoto. Após publicar, execute:

```bash
npm run verify:deployment -- https://ENDERECO-CONFIRMADO.vercel.app
```

Esse teste confere saúde, autenticação, `/aluno`, rotas protegidas, marca e arquivos de exercício. Uma URL só deve ser informada como pronta após a verificação online.
