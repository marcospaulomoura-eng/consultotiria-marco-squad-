# Estado do aplicativo — 27/10/2026

A versão atual reúne React/TypeScript/Vite, API Node e suporte a PostgreSQL no Supabase. A conexão operacional e a publicação foram deixadas para depois a pedido do usuário. Esta revisão avançou nos formulários e na experiência do aluno; nenhum deploy foi executado nesta rodada.

## Funcionalidades revisadas

- Biblioteca com 73 Shorts confirmados e 45 exercícios anteriores, com busca, filtros e inclusão na ficha do aluno.
- Exercícios e alimentos de mesmo nome mostram opções distintas; a ficha preserva o cadastro escolhido ao editar séries, repetições ou quantidades.
- Formulários de catálogo e troca de vídeo bloqueiam os campos durante o envio e preservam o preenchimento após erro.
- Checklist do aluno com nomes acessíveis estáveis, uso pelo teclado e bloqueio durante o registro da conclusão.
- Planos alimentares em gramas, 591 alimentos TACO, histórico de treinos e comunidade.
- Fluxos de clientes, financeiro, vendas e acesso individual mantidos.

## Verificações locais

130 testes automatizados passaram, sem falhas. ESLint e build React/TypeScript passaram.

Quatro verificações completas passaram com interface compilada, API Node, PostgreSQL/PGlite local e dados fictícios: escolha do vídeo entre nomes iguais, edição preservando a escolha, entrega das demonstrações ao aluno e conclusão persistida do checklist. Também passaram verificações de rascunhos, recuperação após falha e uso no celular.

As rodadas anteriores ficam separadas no [relatório de testes](TESTES_SUPABASE_VERCEL.md). As novas telas e correções estão na [revisão dos formulários](REVISAO_FORMULARIOS.md). O player do YouTube teve o vínculo conferido, mas a reprodução remota ainda precisa ser validada online.

## Próxima etapa de publicação

Quando a configuração for retomada, seguir o [guia genérico Supabase e Vercel](SUPABASE_VERCEL.md), preparar a conexão de servidor, preservar dados anteriores em ambiente privado e validar o endereço publicado. Os testes locais não comprovam conectividade ou funcionamento da hospedagem real.

O código compartilhado inclui apenas fontes, arquivos públicos do app, testes e telas fictícias. Credenciais, identificadores da conta, backups, registros e relatórios de bancos privados ficam fora do material público.
