# Verificação antes da publicação — 22/10/2026

| Verificação | Resultado |
| --- | --- |
| Testes automatizados | 104 passaram; 0 falhas |
| Chromium desktop e celular | 17 verificações passaram |
| Erros de JavaScript | 0 |
| Requisições falhas no fluxo visual | 0 |
| Compilação React/TypeScript | Aprovada |
| Schema Supabase remoto | 20 tabelas com RLS, sem acesso anônimo |
| Gravação no Supabase remoto | Não executada: solicitação recusada |
| Deploy Vercel | Não executado nesta revisão |

Os fluxos locais usaram PostgreSQL/PGlite real em memória, a função Node da Vercel e o React compilado para publicação. Os clientes, códigos, prescrições e publicações eram fictícios. Nenhum dado pessoal real ou credencial de produção foi usado.

Foram exercitados login do professor, dashboard, treino e dieta por aluno, moderação, acesso individual, isolamento do painel, reprodução MP4, descanso, checklist, conclusão, histórico, ranking, dieta em gramas e comunidade com postagem, curtida e comentário. As telas foram verificadas em 1440 px e 390×844, sem rolagem horizontal.

Os testes de importação detectaram e levaram à correção de leitura inconsistente de uma origem SQLite ativa e importação de contratos/pagamentos de demonstração. As regressões passaram. O histórico financeiro de clientes reais excluídos é conservado.

A migração foi aplicada ao Supabase e a estrutura conferida por consulta de leitura. O teste remoto de escrita foi recusado. A conexão operacional Vercel–Supabase e o aplicativo online ainda não foram validados.

Repetir com npm test e npm run build. Após publicar, executar npm run verify:deployment -- https://URL-CONFIRMADA.
