# WhatsApp Cloud API do Marcos Squad

O Worker já aceita modelos aprovados da Meta, oferece envio sob demanda e verifica retornos diariamente às 9h no horário de Brasília. Nada é enviado enquanto as credenciais não estiverem configuradas; alunos e interessados também precisam ter a autorização registrada no cadastro.

## Configuração na Meta

1. Em [Meta for Developers](https://developers.facebook.com/), crie um app Business e adicione o produto WhatsApp.
2. Vincule o portfólio empresarial, a conta WhatsApp Business e um número. Se esse número já estiver no WhatsApp Business do celular, use a opção de coexistência se ela aparecer; caso contrário, siga as opções de migração da Meta ou use um número separado.
3. Em WhatsApp Manager, crie e aguarde aprovação destes modelos em português do Brasil (`pt_BR`):

   - `marcos_squad_renovacao`, categoria adequada à renovação, corpo: `Olá, {{1}}! Seu plano {{2}} da {{3}} vence em {{4}}. A renovação fica {{5}}. Quer continuar sua evolução com a gente? Responda a esta mensagem.`
   - `marcos_squad_retorno`, categoria adequada ao contato comercial, corpo: `Olá, {{1}}! Você pediu informações sobre o plano {{2}} de {{3}} da {{4}}. O investimento é {{5}}. Quer conversar sobre como começar? Responda a esta mensagem.`

   Os modelos precisam manter as cinco variáveis na ordem acima. A Meta define a categoria final e pode pedir ajustes.
4. Crie um token de usuário do sistema com `whatsapp_business_messaging` e `whatsapp_business_management`, atribuído ao app e à conta WhatsApp Business. Configure cobrança quando a Meta solicitar.

## Segredos do Worker

No painel Cloudflare, abra **Workers & Pages → marcos-squad-painel → Settings → Variables and Secrets** e configure:

- `WHATSAPP_ACCESS_TOKEN` como **Secret**. Nunca coloque esse valor no navegador, no código, em um chamado ou neste chat.
- `WHATSAPP_PHONE_NUMBER_ID` como Secret também. O ID não é uma senha, mas assim fica junto das outras configurações protegidas do Worker.

O deploy já fornece `WHATSAPP_GRAPH_API_VERSION=v23.0`, `WHATSAPP_TEMPLATE_LANGUAGE=pt_BR` e os nomes dos dois modelos acima. Se a Meta exigir outra versão Graph, atualize a variável no Worker antes de testar.

## Uso e autorização

No cadastro de cada aluno ou interessado, marque **Autorização para mensagens pelo WhatsApp** somente depois de obter essa autorização. Os dados atuais começam desmarcados. Com token e Phone Number ID configurados, a agenda envia o modelo de renovação nos dias escolhidos nas configurações e o modelo comercial na data de retorno. O painel também permite envio imediato pela API. Mensagens iniciadas pela consultoria usam modelo aprovado; respostas livres dependem da janela de atendimento da Meta.

Use apenas números com DDI e DDD. Confirme um envio com um número seu antes de marcar contatos reais. A Meta precisa aceitar a chamada e o modelo para iniciar a entrega; o painel não afirma que a mensagem foi lida.
