# Estado do aplicativo — 26/10/2026

A estratégia atual é React e API Node na Vercel, com PostgreSQL no Supabase. O usuário autorizou concluir e publicar; em seguida pediu testar e mostrar os resultados antes de publicar. Nenhum deploy na Vercel foi executado nesta etapa de revisão.

O usuário pediu adiar a configuração da conexão Supabase e continuar o desenvolvimento. Essa configuração permanece pendente, sem bloquear a revisão e os testes locais e sem novas solicitações do Host nesta etapa.

## Implementação

- Adaptador PostgreSQL com pool serverless, TLS verificado, batches atômicos e repetição de conflitos de serialização.
- Schema privado marcos_squad com as 20 tabelas do aplicativo e sem grants para o navegador.
- Função Node 24 para a API, fallback React em /aluno, arquivos estáticos e cron protegido.
- Migração versionada e importador SQLite/D1 com snapshot consistente, rollback e proteção contra substituição de um destino ocupado.
- Fluxos de professor, aluno, financeiro, treinos, alimentação e comunidade preservados.
- Carregamento da prescrição iniciado pela seleção do professor, preservando a proteção contra respostas antigas ao alternar rapidamente entre alunos.
- Preflight de configuração e arquivos, com modo opcional de banco somente de leitura e sem exibir credenciais.
- Feed e painel ignoram respostas antigas; publicações e comentários preservam novos rascunhos digitados enquanto um envio anterior termina.
- Tratamento de fotos estreitas e erros de leitura; atualização do catálogo junto à prescrição do aluno e reconciliação do treino em andamento.
- Aviso visível quando uma prescrição foi salva, mas a atualização seguinte falhou, permitindo recarregar sem reenviar a criação.
- Contraste do funil de vendas, indicadores e estados de carregamento alinhado ao tema escuro.
- Saída e expiração do aluno invalidam cargas pendentes, impedindo que uma resposta antiga restaure a interface da sessão anterior.
- Biblioteca com 73 Shorts confirmados do canal do Marcos, além dos 45 exercícios anteriores, em lista com busca e filtros. Seleção direta para montar o treino do aluno e importação de novos links em lotes revisados de até 50 exercícios, sem duplicar os já cadastrados.
- O estado do acesso individual é atualizado após a gravação, mesmo quando a recarga seguinte falha; a interface permite recuperar a leitura sem repetir a liberação.
- Linhas de exercícios, refeições e alimentos mantêm a identidade durante exclusões e alterações. Os controles do editor ficam bloqueados enquanto o salvamento está em andamento.

## Verificações

127 testes automatizados passaram, sem falhas. Incluem integrações PostgreSQL/PGlite real em memória, migração/importação, autenticação, regras financeiras, isolamento entre alunos, runtime Vercel, preflight, validação de URLs do YouTube e importação da biblioteca de Shorts. O lint e o build React/TypeScript passaram.

Na rodada anterior, 18 verificações no Chromium passaram em desktop 1440 px e celular 390×844. Foram testados login, painel, treino/vídeo/descanso/conclusão, dieta e comunidade. Não foram observados erros de JavaScript ou requisições falhas nas 38 respostas da API observadas. Um teste adicional confirmou que uma resposta atrasada na troca A → B → A não substitui a seleção atual. Todos os dados eram fictícios.

A revisão adicional passou por 8 fluxos de cadastro, financeiro e vendas, incluindo pagamento parcial, quitação e persistência após recarga. Regressões específicas de concorrência, catálogo, treino ativo, fotos e recuperação após erro foram reproduzidas antes e verificadas após as correções. Consulte [revisão dos fluxos e da interface](REVISAO_INTERFACE.md).

Na rodada atual, seis verificações adicionais da biblioteca de Shorts passaram no Chromium, incluindo seleção para um aluno, gravação da ficha na API/PostgreSQL local, importação sem duplicatas e conclusão persistida pela área do aluno no celular. Não houve erros de JavaScript. O iframe remoto foi substituído no teste somente para conferir o endereço e o formato vertical; a reprodução real pelo YouTube ainda precisa ser validada no ambiente online. Consulte a [biblioteca e as telas](BIBLIOTECA_SHORTS.md).

Seis verificações separadas de acesso passaram, incluindo liberação e revogação com falha na leitura seguinte, confirmação da rotação e cópia manual quando o clipboard não está disponível. A revisão dos editores confirmou a preservação dos rascunhos ao mover ou excluir linhas e a recuperação após falha de salvamento.

A migração foi aplicada ao projeto Supabase avxdirsnlikufygnphoq. Uma consulta somente de leitura confirmou 20 tabelas com RLS, marcador correto da aplicação, sem acesso de schema para anon ou authenticated, e nenhum cliente ou contrato importado.

O teste de gravações e rollback no Supabase remoto foi recusado pela ferramenta e não foi executado. Não atribuir a recusa a um motivo que não foi informado. Os testes de gravação locais passaram, mas não validam rede/TLS/pooler remoto.

O aviso informativo rls_enabled_no_policy é esperado nesta arquitetura de schema privado e API no servidor. Nenhum acesso público foi concedido para suprimir esse aviso.

O acesso ao projeto Vercel foi confirmado pelo ID no escopo padrão da conexão, o mesmo usado na criação. A consulta com seleção explícita do workspace retornou 403, mas não exige reconexão para este projeto. A lista de variáveis remotas está vazia; o vínculo local não as substitui.

Uma leitura somente por contagens do SQLite local encontrou 9 clientes de demonstração e nenhum cliente regular. A origem Cloudflare/D1 não foi conferida nesta rodada; não confundir essas contagens com um inventário do banco remoto antigo.

## Pendências de publicação

1. Confirmar o Host do Transaction pooler em Connect no Supabase e configurar uma conexão operacional e as credenciais somente do servidor na Vercel. O conector disponível não expõe a configuração do pooler; o host não deve ser inferido pela região. Não reutilizar placeholders do ambiente Cloudflare como valores reais.
2. Transferir os dados antigos, se houver, com origem congelada durante o corte e destino vazio. Nenhum dado real foi transferido nesta revisão.
3. Validar a escrita no Supabase e realizar o deploy Vercel após a apresentação dos testes solicitada pelo usuário.
4. Conferir a proteção adicional da Vercel para permitir acesso dos alunos e executar npm run verify:deployment com a URL confirmada.

Projeto Vercel criado: marcos-squad, ID prj_yQHuYU7pQrW0cb4KZlO4UC6JnORY. A criação não equivale a publicação. Consulte [Supabase e Vercel](SUPABASE_VERCEL.md).

## Histórico

O caminho Cloudflare/D1 falhou no upload com HTTP 401 da integração do ambiente, mesmo após autorização. O Worker e o D1 anteriores não foram apagados nem substituídos na adaptação.
