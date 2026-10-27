# Marcos Squad — consultoria, treinos e nutrição

Aplicativo em português para uma consultoria de treino e dieta, com painel do professor e área individual do aluno. A arquitetura atual usa **React/TypeScript/Vite + API Node.js na Vercel + PostgreSQL no Supabase**. A implantação na Vercel ainda depende das configurações de servidor e da revisão antes da publicação. Os modos SQLite e Cloudflare/D1 anteriores foram mantidos para compatibilidade e testes.

Inclui uma biblioteca inicial de **73 Shorts confirmados do canal do Marcos e 45 exercícios anteriores** (118 exercícios), 591 alimentos TACO, prescrições em gramas, registro de treinos, top 5 mensal e comunidade com fotos, curtidas e comentários. Veja o [guia do aplicativo e dos acessos dos alunos](docs/APP_ALUNOS.md) e a [biblioteca de Shorts com a lista de exercícios](docs/BIBLIOTECA_SHORTS.md).

## Executar

Use Node.js 24 (validado com 24.19). Para desenvolver com o Supabase, copie `config/environment.example` para `.env`, preencha as variáveis somente nesse arquivo ignorado e execute:

```bash
npm ci
npm run supabase:migrate
npm run dev:supabase
```

O comando inicia a interface na porta 5173 e a API na porta 3001, ambas vinculadas ao computador atual. A interface encaminha as chamadas da API automaticamente. Para parar os dois serviços, use Ctrl+C.

Para compilar e servir a aplicação completa com Supabase em um único processo:

```bash
npm run build
npm run start:supabase
```

O servidor Node serve a interface compilada e a API na porta 3001. `npm run preview` é apenas a prévia do Vite e não substitui o servidor completo. `npm run dev` detecta `SUPABASE_DB_URL`; sem essa variável, mantém a demonstração SQLite anterior. A função da Vercel sempre exige Supabase e nunca grava em SQLite.

## Usar o painel

- Cadastre nome, contato, serviço, valor, plano e vencimento de cada cliente.
- Consulte clientes ativos, planos e vencimentos. O financeiro separa contratos vendidos, pagamentos recebidos, saldos a receber e previsão mensal dos planos ativos.
- Renove um plano para atualizar o vencimento. Renovações antecipadas preservam os dias restantes; planos vencidos começam a nova vigência a partir da data atual. Datas no fim do mês são ajustadas ao último dia válido do próximo período.
- Sem a API, abra o WhatsApp com a mensagem preenchida ou copie o texto. Com a Cloud API configurada, envie modelos aprovados pelo painel e automatize lembretes e retornos.
- Personalize a consultoria, o treinador, os dias de aviso e o texto da mensagem em Configurações. Os padrões são 7, 3 e 1 dia antes do vencimento.
- Os lembretes aparecem no painel; notificações opcionais do navegador funcionam enquanto ele estiver aberto, com a permissão concedida. Em produção, a Cloud API configurada permite envios agendados mesmo com o painel fechado.

O modo SQLite local inclui nove clientes **fictícios** para demonstrar a interface. Os exemplos não têm números de telefone, evitando abrir conversas com pessoas reais. Use “Começar com meus clientes” para remover os exemplos; clientes reais já cadastrados são preservados. O Supabase inicia vazio e não recebe dados de demonstração automaticamente.

## Biblioteca de exercícios e treinos

Em **Treinos**, a biblioteca abre na lista “Shorts do Marcos”. Busque pelo nome, grupo ou equipamento, filtre a origem e use “Assistir Short” para conferir o vídeo. “Usar no treino” abre a ficha do aluno selecionado; quando nenhum aluno está selecionado, o painel pede a seleção antes de abrir a ficha com o exercício. Ajuste séries, repetições e descanso e salve para disponibilizar o treino na área individual do aluno.

“Adicionar Shorts” permite colar uma lista ou abrir um arquivo CSV com nome e link de cada exercício. Revise de 1 a 50 linhas por vez antes de importar; links repetidos ou já cadastrados não duplicam exercícios nem substituem seus nomes. Os 45 exercícios anteriores continuam disponíveis em “Outros exercícios”. A lista inicial inclui 73 Shorts confirmados, sem afirmar que cobre todos os Shorts do canal. Veja [cobertura, formato de importação e telas](docs/BIBLIOTECA_SHORTS.md).

Ao montar a ficha, exercícios com o mesmo nome mostram a origem, como **Seu canal** ou **Biblioteca base**. Escolha a opção correspondente ao vídeo desejado. Alimentos de mesmo nome também distinguem a fonte e o cadastro personalizado. A ficha conserva o cadastro escolhido ao editar repetições ou quantidades. Os formulários de catálogo e troca de vídeo bloqueiam os campos durante o envio e preservam o preenchimento quando ocorre uma falha. Veja a [revisão dos formulários e da seleção de exercícios](docs/REVISAO_FORMULARIOS.md).

## Dados e configuração

No Supabase, os dados ficam no schema privado `marcos_squad`. As credenciais de conexão ficam apenas na API da Vercel; nenhuma variável `VITE_` contém senha, chave administrativa ou URL do banco. As tabelas têm RLS e não concedem acesso aos papéis públicos `anon` e `authenticated`: o navegador usa as rotas protegidas da API.

O modo SQLite anterior persiste em `data/app.sqlite`. A pasta `data/` fica fora do Git e deve ser preservada. Para migrar dados anteriores, consulte [Supabase e Vercel](docs/SUPABASE_VERCEL.md); o importador trabalha em transação, usa um snapshot da origem e recusa substituir um destino com dados.

Variáveis da API Vercel:

| Variável | Uso |
| --- | --- |
| `SUPABASE_DB_URL` | Conexão PostgreSQL pelo Transaction pooler, somente no servidor |
| `DASHBOARD_PASSWORD` | Senha do professor, de 12 caracteres a 256 bytes UTF-8 |
| `CRON_SECRET` | Segredo de pelo menos 16 caracteres para a rotina diária |
| `SUPABASE_DB_CA` | Certificado raiz opcional; a verificação TLS permanece obrigatória |

Variáveis opcionais:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3001` | Porta do servidor Node |
| `HOST` | `127.0.0.1` | Endereço de escuta do servidor |
| `WEB_PORT` | `5173` | Porta da interface em `npm run dev` |
| `DATABASE_PATH` | `data/app.sqlite` no projeto | Arquivo SQLite alternativo, útil para testes |

O calendário usa o fuso `America/Sao_Paulo`. Fontes e ícones são incluídos no build. Para configurar envio automático pela Meta, siga [WhatsApp Cloud API](docs/WHATSAPP_CLOUD_API.md). Sem credenciais, os atalhos manuais continuam disponíveis.

O painel inclui login por senha para um operador. No modo Supabase/Vercel, o login é sempre obrigatório e a ausência de senha ou banco mantém os dados bloqueados. Sessões de professor e aluno usam cookies HttpOnly; em produção também usam Secure. O modo SQLite local anterior pode ser usado sem senha para demonstração.

## Publicar na Vercel com Supabase

Veja o guia [Supabase e Vercel](docs/SUPABASE_VERCEL.md) e o [estado da publicação](docs/PUBLICACAO_STATUS.md). `vercel.json` configura o build Vite, a função Node 24, as rotas da API, o acesso direto a `/aluno` e o cron diário.

Em 27/10/2026, o usuário pediu continuar o desenvolvimento e deixar a conexão operacional do Supabase para depois. A versão Vercel continua sem publicação; os testes locais e as telas de revisão permanecem disponíveis.

Depois de publicar, valide o endereço real:

```bash
npm run verify:deployment -- https://SEU-ENDERECO.vercel.app
```

O comando só confirma sucesso depois de conferir autenticação, saúde do banco, área do aluno, marca, miniatura e vídeo. Os limites e a elegibilidade dos planos de hospedagem devem ser conferidos nas contas dos provedores; a adaptação não contrata nem altera planos.

## Publicação anterior na Cloudflare

A versão Cloudflare Workers + D1 inclui banco persistente, login e hospedagem no plano gratuito dentro das cotas da plataforma. Consulte [as instruções de publicação](docs/PUBLICAR.md). A autorização da conta Cloudflare é necessária para criar o endereço público.

```bash
npm run cloud:check
npm run cloud:deploy
```

O primeiro comando valida o pacote sem publicar. O segundo exige `CLOUDFLARE_API_TOKEN` e `MARCOS_DASHBOARD_PASSWORD` nas configurações seguras do ambiente e só informa uma URL depois de testar o serviço publicado. A senha escolhida deve ter pelo menos 12 caracteres. O publicador não contrata um plano pago.

## Verificar

```bash
npm test
npm run lint
npm run build
npm run preflight
```

Na revisão de 27/10/2026, os **130 testes automatizados passaram, sem falhas**, e o lint e o build passaram. Os testes validam datas, financeiro, autenticação, isolamento entre alunos, APIs, persistência SQLite/D1, PostgreSQL real em memória com PGlite, adaptação Node/Vercel, migração/importação, biblioteca/importação de Shorts e seleção de cadastros com nomes iguais. Dados de teste são isolados dos dados de uso. Testes PGlite não substituem a verificação da conexão ao Supabase e do deploy real da Vercel. O preflight falha enquanto as configurações necessárias estiverem ausentes; não publica nem revela credenciais. Veja os [resultados e telas da revisão](docs/TESTES_SUPABASE_VERCEL.md). O pacote Workers anterior ainda pode ser verificado com `npm run cloud:check`.
