# Marcos Squad · treinos, dieta e comunidade

## Professor

O painel de gestão continua em `/`, com a senha atual. Clientes, contratos, recebimentos, renovações e WhatsApp são preservados.

1. Em **Treinos → Treinos dos alunos**, selecione um cliente existente ou cadastre um pela aba **Clientes**. A biblioteca de exercícios também permite escolher um exercício e usar **Usar no treino** antes de selecionar o aluno.
2. Dê um nome à ficha, como **Treino B**, e defina dias da semana, exercícios, séries, repetições, descanso em segundos e orientação de carga. A ordem pode ser ajustada pelas setas. Na execução, o aluno vê o nome definido na ficha.
3. Em **Dietas e alimentos**, monte refeições e informe todas as quantidades em **gramas**. As calorias e os macros se atualizam durante a edição. O aluno vê a última versão salva.
4. Clique em **Liberar acesso**, copie o código individual e compartilhe diretamente com o aluno junto do endereço `/aluno`. O código só é mostrado ao gerar; não é recuperável pelo painel. **Novo código** encerra todas as sessões anteriores. **Revogar acesso** preserva prescrições, histórico e publicações.
5. Use **Comunidade Squad** para acompanhar o feed, o top 5 e moderar publicações/comentários.

## Vídeos do YouTube

**Treinos** abre na biblioteca, com 73 Shorts confirmados do canal do Marcos e os 45 exercícios anteriores. Use a busca e os filtros para encontrar um movimento, **Assistir Short** para conferir o vídeo e **Usar no treino** para montar a ficha do aluno. **Adicionar Shorts** recebe uma lista revisada de nomes e links, sem duplicar os já cadastrados. Veja o [guia da biblioteca e a lista completa](BIBLIOTECA_SHORTS.md).

Para substituir uma demonstração, use **Trocar vídeo** na linha do exercício. O botão de busca abre o YouTube com o nome do movimento. Cole o link escolhido e clique em **Usar este vídeo**. Links comuns, compartilhados e Shorts são normalizados; buscas e canais não são aceitos como vídeos. A alteração vale para todas as fichas que usam aquele exercício. Nos exercícios da biblioteca anterior, **Restaurar vídeo original** recupera a demonstração local.

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
- **73 Shorts confirmados** do canal Marcos Paulo Treinador, cadastrados com metadados e links públicos; os vídeos não foram baixados nem copiados. A [documentação da biblioteca](BIBLIOTECA_SHORTS.md) explica a origem e os limites da cobertura.
- **591 alimentos com energia informada**, da TACO, NEPA/UNICAMP, 4ª edição (2011), normalizada no projeto [taco-api](https://github.com/raulfdm/taco-api/tree/main/references). A base original tem 597 itens; seis sem energia informada foram excluídos. São valores por 100 g de parte comestível; nome/preparo e categoria são preservados. Campos ausentes aparecem como “—” na tabela e tornam os totais de macros parciais. Não se afirma cobrir todos os alimentos ou marcas existentes.
- O professor pode adicionar alimentos e suplementos com valores por 100 g.
- `scripts/import-fitness-catalog.py` reproduz a importação e conversão (Python + ffmpeg). O vídeo de face pull foi excluído porque o arquivo fornecido não era decodificável durante a importação.

## Armazenamento e segurança

A arquitetura atual usa React e API Node na Vercel com PostgreSQL no Supabase. As tabelas ficam no schema privado `marcos_squad`, acessado somente pela API; o navegador não recebe credenciais de banco. A migração versionada fica em `supabase/migrations`. Os adaptadores anteriores SQLite e Cloudflare/D1 permanecem disponíveis para compatibilidade e testes.

A conexão operacional com o Supabase continua adiada a pedido do usuário. A versão Vercel ainda não foi publicada nem validada online; consulte o [estado da publicação](PUBLICACAO_STATUS.md).

Fotos são comprimidas no navegador para JPEG de até 180 KB e persistidas no banco, com limite de cinco posts por aluno em 24 horas. Fotos não ficam em URLs públicas: o endpoint exige sessão e participação do autor. São aceitos JPG/PNG/WebP de até 12 MB antes da compressão; o canvas remove metadados do arquivo original. Para comunidades grandes, migre as fotos para armazenamento de objetos antes de atingir os limites do banco. Não há moderação automática de imagem.

Códigos de acesso de 192 bits e sessões são armazenados apenas como hashes. Credenciais dos alunos não autorizam rotas do professor nem permitem escolher outro aluno para consultar ou registrar treino. Não há recuperação por e-mail: o professor emite um novo código.

Dados do aplicativo dependem de conexão; é um aplicativo web responsivo, acessível pelo navegador no celular e no computador. O histórico mostra os 60 registros mais recentes; o total mensal e o ranking consultam todos os registros do mês.

## Verificação

`npm test`, `npm run lint` e `npm run build`. Os testes cobrem isolamento entre alunos e professor, rotação/revogação, CSRF, limites, cálculos, gravação, ranking, comunidade, fotos, troca/restauração de vídeos e importação dos Shorts. Os fluxos visuais usam Chromium, incluindo vídeo local, foto, dieta em gramas e celular. A reprodução remota do YouTube ainda precisa ser validada online. Veja os [resultados e telas](TESTES_SUPABASE_VERCEL.md). O pacote Cloudflare anterior pode ser conferido separadamente com `npm run cloud:check`.
