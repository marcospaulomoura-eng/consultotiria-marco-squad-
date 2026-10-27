# Verificação antes da publicação — 27/10/2026

| Verificação | Resultado |
| --- | --- |
| Testes automatizados | 130 passaram; 0 falhas |
| Seleção e ficha do aluno — rodada atual | 4 verificações completas passaram em desktop e celular |
| Escolhas de catálogo com nomes iguais | 3 testes focados passaram; IDs e origens preservados |
| Chromium desktop e celular — rodada anterior | 18 verificações passaram |
| Biblioteca de Shorts — rodada anterior | 6 verificações adicionais passaram em desktop e celular |
| Fichas completas de treino e dieta — rodada anterior | 5 verificações passaram; 33 respostas da API com sucesso |
| Pacote isolado da API | Handler, driver PostgreSQL e catálogos carregaram em Node 24 |
| Player dos Shorts | ID real e formato vertical conferidos; reprodução remota ainda não validada |
| Respostas atrasadas na seleção de aluno | Troca A → B → A mantém a prescrição atual |
| Erros de JavaScript | 0 |
| Requisições falhas no fluxo visual | 0 |
| Compilação React/TypeScript | Aprovada |
| ESLint | Aprovado |
| Deploy Vercel | Não executado nesta revisão |

Os fluxos locais usaram PostgreSQL/PGlite real em memória, a função Node da Vercel e o React compilado para publicação. Os clientes, códigos, prescrições e publicações eram fictícios. Nenhum dado pessoal real ou credencial de produção foi usado.

## Seleção de exercícios e formulários — 27/10/2026

Quatro verificações completas passaram no Chromium, com interface compilada, API Node, PostgreSQL/PGlite local e dados fictícios:

1. Nomes iguais exigem a escolha da origem; as demonstrações são gravadas com seus próprios IDs em desktop e celular.
2. Editar a ficha e mudar repetições conserva os vídeos escolhidos para os exercícios de mesmo nome.
3. O aluno recebe os IDs corretos, com vídeo local para a biblioteca base e o link correspondente à demonstração do canal.
4. O checklist mantém nomes acessíveis após marcar, bloqueia alterações durante o registro e persiste a conclusão, preservando o isolamento do painel.

Não houve erro JavaScript nessa rodada. A reprodução remota do YouTube não foi validada. As três verificações focadas de escolhas de catálogo integram o total de 130 testes automatizados; as contagens de rodadas de navegador são apresentadas separadamente.

Verificações de interface com latência e erro 503 simulados também passaram: cadastro de exercício, cadastro de alimento e troca de vídeo bloqueiam os campos e o fechamento durante o envio; a falha conserva o preenchimento e libera a edição; uma nova tentativa explícita envia os valores revisados uma vez. O checklist mantém marcações após falha, e seus nomes acessíveis permanecem estáveis para uso pelo teclado e por leitores de tela. Rascunhos parciais, remoção e reordenação de linhas também foram conferidos. Veja as [telas e os detalhes da revisão](REVISAO_FORMULARIOS.md).

A conexão operacional do Supabase e a publicação foram novamente adiadas a pedido do usuário em 27/10/2026. Nenhum deploy foi realizado nesta rodada.

## Rodadas anteriores

Na rodada anterior, foram exercitados login do professor, dashboard, treino e dieta por aluno, moderação, acesso individual, isolamento do painel, reprodução MP4, descanso, checklist, conclusão, histórico, ranking, dieta em gramas e comunidade com postagem, curtida e comentário. As telas foram verificadas em 1440 px e 390×844, sem rolagem horizontal.

Na rodada da biblioteca de Shorts, foram verificados estes seis fluxos com a interface compilada, a API Node e PostgreSQL/PGlite locais:

1. Abertura de Treinos na biblioteca, com 73 Shorts e 45 exercícios anteriores, sem IDs ou nomes repetidos na coleção dos Shorts.
2. Busca e filtro encontrando Step-up, com o ID real do vídeo no player vertical.
3. “Usar no treino” pedindo a seleção do aluno, preenchendo o exercício e salvando uma ficha com dois IDs reais dos Shorts.
4. Revisão de importação e envio de dois links já cadastrados, sem duplicação ou substituição dos registros existentes.
5. Uso da biblioteca em tela de 390 px, sem rolagem horizontal da página.
6. Área do aluno recebendo os mesmos exercícios, checklist exigindo ambos e conclusão persistida, mantendo o isolamento do painel do professor.

Nenhum erro de JavaScript foi observado nessa rodada. O iframe do YouTube foi interceptado apenas para conferir URL e dimensões; isso não comprova a reprodução remota. As miniaturas exibiram o fallback quando a rede não forneceu a imagem. Os links públicos e a reprodução no ambiente online precisam ser conferidos depois da implantação. A [documentação da biblioteca](BIBLIOTECA_SHORTS.md) registra a cobertura dos 73 Shorts.

As correções adicionais preservam o estado de liberação do acesso após falha de recarga e evitam que a exclusão de uma linha transfira o texto parcial para outra linha dos editores de treino e dieta. Durante o salvamento, os controles dos editores ficam bloqueados.

Uma rodada separada com seis verificações de acesso passou sem erros JavaScript: liberação e revogação seguidas de falha de leitura mantêm o estado correto; a rotação exige confirmação; cancelar não envia gravação; atualizar repete somente a leitura; e clipboard indisponível orienta a cópia manual. Nos editores, também foram conferidos rascunhos parciais ao mover ou excluir linhas, bloqueio durante o envio e recuperação da edição após erro.

## Fichas completas: professor → aluno

Na revisão anterior, uma rodada concluiu cinco verificações com cliente fictícia, API Node, PostgreSQL/PGlite local e Chromium em 1440 px e 390 px. As 33 respostas da API observadas tiveram sucesso e não houve erro JavaScript.

1. O professor criou **Treino B**, com dois exercícios, dias da semana, séries, repetições, carga e descanso. A reordenação foi mantida na gravação.
2. O professor criou um plano fictício com duas refeições, horários e quatro alimentos. Os totais foram comparados a um cálculo independente a partir das porções.
3. A liberação do acesso e a cópia do texto individual foram conferidas, mantendo o código fora das evidências públicas.
4. No celular, o aluno recebeu os exercícios na ordem salva, concluiu o checklist e registrou o treino; a sessão de aluno não autorizou o painel do professor.
5. A dieta manteve alimentos, porções e macros após recarregar. O exemplo totalizou 650,8 kcal, 57 g de proteínas, 73 g de carboidratos e 14,2 g de gorduras; a interface arredonda a energia para 651 kcal.

O título em execução usa somente o nome escolhido para a ficha. A prévia foi atualizada para **Treino B**.

![Plano alimentar fictício no painel do professor](previews/dieta-professor-revisada.png)

![O mesmo plano na área do aluno no celular](previews/dieta-aluno-revisada.png)

Os testes de importação detectaram e levaram à correção de leitura inconsistente de uma origem SQLite ativa e importação de contratos/pagamentos de demonstração. As regressões passaram. O histórico financeiro de clientes reais excluídos é conservado.

A etapa seguinte de desenvolvimento acrescentou correções e verificações de rascunhos, fotos, respostas atrasadas, catálogo e treino ativo, além de oito fluxos de cadastro, financeiro e vendas. Consulte [revisão dos fluxos e da interface](REVISAO_INTERFACE.md). A configuração remota foi adiada a pedido do usuário.

A conexão operacional e o aplicativo online ainda precisam ser validados quando a publicação for retomada. Este relatório registra somente a implementação e as verificações locais com dados fictícios.

Repetir com npm test, npm run lint e npm run build. npm run preflight informa as configurações ausentes sem revelar valores; --database acrescenta consultas somente de leitura. Após publicar, executar npm run verify:deployment -- https://URL-CONFIRMADA.

## Empacotamento para a Vercel

Uma cópia isolada reuniu os 13 arquivos do grafo da API e 14 pacotes de dependências de produção: 152 arquivos, cerca de 785 KB. Um processo Node 24.19 com ambiente limpo importou o handler, o driver `pg`, os dois catálogos e o helper de URLs do YouTube. Foram confirmados 118 exercícios (73 Shorts e 45 anteriores) e 591 alimentos.

Sem credenciais, o status de autenticação permaneceu não autenticado; saúde, painel, catálogo e cron retornaram 503 sem cache. Nenhum banco remoto, dado de cliente ou credencial de produção foi usado. Esse pacote foi montado localmente para conferir dependências e arquivos; não é a saída do builder da Vercel e não comprova deploy.

O empacotamento local não substitui o build nem a execução no provedor. As instruções de configuração são genéricas e estão no [guia Supabase e Vercel](SUPABASE_VERCEL.md).

## Migração e preservação

Os testes isolados do migrador e do importador verificam identidade do schema, destino ocupado, consistência do snapshot, exclusão de exemplos e sessões, contagens esperadas e rollback em caso de falha. Essa evidência usa fixtures de teste; não publica registros, métricas ou resultados de bancos privados.

## Telas com dados fictícios

![Painel do professor](previews/painel-professor.png)

![Treino do aluno](previews/treino-aluno.png)

![Dieta no celular](previews/dieta-celular.png)

## Biblioteca de Shorts com dados fictícios

![Biblioteca de Shorts no painel do professor](previews/biblioteca-shorts.png)

![Revisão da importação de Shorts](previews/importar-shorts.png)

![Treino com Shorts na área do aluno no celular](previews/treino-shorts-aluno.png)
