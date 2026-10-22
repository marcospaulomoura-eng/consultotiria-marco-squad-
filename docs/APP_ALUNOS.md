# Marcos Squad · treinos, dieta e comunidade

## Professor

O painel de gestão continua em `/`, com a senha atual. Clientes, contratos, recebimentos, renovações e WhatsApp são preservados.

1. Em **Treinos**, selecione um cliente existente ou cadastre um pela aba **Clientes**.
2. Crie os treinos com dias da semana, exercícios, séries, repetições, descanso em segundos e orientação de carga. A ordem pode ser ajustada pelas setas.
3. Em **Dietas e alimentos**, monte refeições e informe todas as quantidades em **gramas**. As calorias e os macros se atualizam durante a edição. O aluno vê a última versão salva.
4. Clique em **Liberar acesso**, copie o código individual e compartilhe diretamente com o aluno junto do endereço `/aluno`. O código só é mostrado ao gerar; não é recuperável pelo painel. **Novo código** encerra todas as sessões anteriores. **Revogar acesso** preserva prescrições, histórico e publicações.
5. Use **Comunidade Squad** para acompanhar o feed, o top 5 e moderar publicações/comentários.

## Vídeos do YouTube

Em **Treinos → Biblioteca de exercícios → Escolher vídeo do YouTube**, o botão de busca abre o YouTube com o nome do movimento. Cole o link do vídeo escolhido e clique em **Usar este vídeo**. Links comuns, compartilhados e Shorts são normalizados; buscas e canais não são aceitos como vídeos. A alteração vale para todas as fichas que usam aquele exercício. **Restaurar vídeo original** recupera a demonstração incorporada.

O aplicativo reproduz por `youtube-nocookie.com` e oferece o link externo. Vídeos privados, removidos, com restrições regionais ou com incorporação desativada dependem das regras do canal. Não é necessário configurar uma chave de API; não há importação automática, download ou cópia de vídeos do YouTube.

Também é possível cadastrar novos exercícios com vídeo HTTPS MP4/WebM ou YouTube e orientação de execução.

## Área do aluno

- Acesso em `/aluno` com código individual; sessão de até 30 dias em cookie HttpOnly/SameSite.
- Abas **Meu dia**, **Treinos**, **Minha dieta** e **Squad**.
- Para registrar um treino, marque todos os exercícios e conclua. Há temporizador de descanso e demonstração de cada movimento. O mesmo treino só é registrado uma vez no mesmo dia; o servidor usa a data de São Paulo.
- O top 5 usa **dias distintos com treino concluído no mês corrente**. Vários treinos no mesmo dia contam um ponto. Empates consideram o primeiro registro do mês. Não são geradas atividades fictícias.
- O aluno escolhe o nome público e ativa sua participação para aparecer no ranking e publicar/interagir. Ao sair, seu conteúdo fica oculto; o histórico privado permanece.
- Feed privado da consultoria: texto, foto, curtidas, comentários e exclusão. Alunos só removem o próprio conteúdo; o professor pode moderar todo o feed. O feed tem paginação.

## Catálogos e fontes

- **45 vídeos** de exercícios do wger, autoria **Goulart**, licença **CC BY-SA 4.0**. Redimensionados e recodificados em H.264 sem áudio para compatibilidade. Autoria e licença aparecem em cada vídeo; os originais estão referenciados em `server/fitness-catalog.json`. Os vídeos derivados mantêm a mesma licença. Miniaturas são quadros derivados desses vídeos.
- **591 alimentos com energia informada**, da TACO, NEPA/UNICAMP, 4ª edição (2011), normalizada no projeto [taco-api](https://github.com/raulfdm/taco-api/tree/main/references). A base original tem 597 itens; seis sem energia informada foram excluídos. São valores por 100 g de parte comestível; nome/preparo e categoria são preservados. Campos ausentes aparecem como “—” na tabela e tornam os totais de macros parciais. Não se afirma cobrir todos os alimentos ou marcas existentes.
- O professor pode adicionar alimentos e suplementos com valores por 100 g.
- `scripts/import-fitness-catalog.py` reproduz a importação e conversão (Python + ffmpeg). O vídeo de face pull foi excluído porque o arquivo fornecido não era decodificável durante a importação.

## Armazenamento e segurança

Migração aditiva `0006_student_app.sql` usa o D1 já existente em produção. O desenvolvimento local aplica as mesmas tabelas no SQLite e usa a mesma lógica de negócio. Não há novo serviço pago ou chave obrigatória.

Fotos são comprimidas no navegador para JPEG de até 180 KB e persistidas no banco, com limite de cinco posts por aluno em 24 horas. Fotos não ficam em URLs públicas: o endpoint exige sessão e participação do autor. São aceitos JPG/PNG/WebP de até 12 MB antes da compressão; o canvas remove metadados do arquivo original. Para comunidades grandes, migre as fotos para armazenamento de objetos antes de atingir os limites do banco. Não há moderação automática de imagem.

Códigos de acesso de 192 bits e sessões são armazenados apenas como hashes. Credenciais dos alunos não autorizam rotas do professor nem permitem escolher outro aluno para consultar ou registrar treino. Não há recuperação por e-mail: o professor emite um novo código.

Dados do aplicativo dependem de conexão; é um aplicativo web responsivo, acessível pelo navegador no celular e no computador. O histórico mostra os 60 registros mais recentes; o total mensal e o ranking consultam todos os registros do mês.

## Verificação

`npm test`, `npm run lint`, `npm run build` e `npm run cloud:check`. Os testes de `server/fitness.test.mjs` cobrem isolamento entre alunos e professor, rotação/revogação, CSRF, limites, cálculos, gravação, ranking, comunidade, fotos e troca/restauração de vídeos do YouTube. O fluxo visual também foi verificado com Chromium, incluindo vídeo local, foto, dieta em gramas e celular.
