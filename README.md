# FiguBot

Um bot para WhatsApp que converte imagens em figurinhas automaticamente.

## 📋 Descrição

Este bot utiliza a biblioteca Baileys para se conectar ao WhatsApp Web e converter imagens enviadas em um grupo específico em figurinhas (stickers). O bot é capaz de processar múltiplas imagens simultaneamente e oferece comandos simples para interação.

## ✨ Funcionalidades

- 🖼️ Converte imagens em figurinhas para WhatsApp
- 🔄 Processa múltiplas imagens simultaneamente
- 💬 Responde a comandos como "ajuda" e "ping"
- 🔍 Logs detalhados para facilitar a depuração
- 🛡️ Tratamento robusto de erros

## 🛠️ Tecnologias Utilizadas

- [Node.js](https://nodejs.org/)
- [Baileys](https://github.com/WhiskeySockets/Baileys) - API não oficial do WhatsApp Web
- [Sharp](https://sharp.pixelplumbing.com/) - Processamento de imagens
- [Pino](https://getpino.io/) - Logging

## 📦 Pré-requisitos

- Node.js (versão 14 ou superior)
- NPM (gerenciador de pacotes do Node.js)

## 🚀 Instalação

1. Clone o repositório:
   ```bash
   git clone https://github.com/bardodb/figubot.git
   cd figubot
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

## ⚙️ Configuração

1. Abra o arquivo `index.js` e localize a seguinte linha:
   ```javascript
   const targetGroupName = 'teste';
   ```

2. Altere `'teste'` para o nome do grupo do WhatsApp onde você deseja que o bot funcione.

## 🚀 Executando o Bot

1. Inicie o bot:
   ```bash
   npm start
   ```

2. Na primeira execução, será exibido um QR code no terminal.

3. Escaneie o QR code com seu WhatsApp (Configurações > WhatsApp Web > Adicionar novo dispositivo).

4. Após a autenticação, o bot estará conectado e pronto para uso.

## 📱 Uso

1. Adicione o número do WhatsApp usado para autenticar o bot ao grupo com o nome configurado (por padrão, "teste").

2. Envie uma ou várias imagens no grupo para que o bot as converta em figurinhas.

3. Comandos disponíveis:
   - `ajuda` ou `help`: Exibe instruções de uso
   - `ping`: Verifica se o bot está online

## 📂 Estrutura do Projeto

- `index.js`: Arquivo principal contendo toda a lógica do bot
- `package.json`: Configurações e dependências do projeto
- `auth_info_baileys/`: Pasta onde são armazenadas as informações de autenticação
- `temp/`: Pasta para armazenamento temporário de imagens durante o processamento

## 🔧 Personalização

Para personalizar o bot, você pode modificar:

- **Nome do grupo**: Altere a constante `targetGroupName` no arquivo `index.js`
- **Qualidade das figurinhas**: Modifique o valor de `quality` na função `sharp()` (padrão: 80)
- **Tamanho das figurinhas**: Altere os valores de `resize()` (padrão: 512x512)

## 📝 Notas

- O bot precisa estar rodando para funcionar. Se você fechar o terminal ou desligar o computador, o bot ficará offline.
- Para manter o bot rodando permanentemente, considere hospedar em um servidor ou usar serviços como PM2 para gerenciamento de processos.

## 🔒 Segurança

Este bot utiliza a biblioteca Baileys, que é uma implementação não oficial da API do WhatsApp Web. Use por sua conta e risco, pois o WhatsApp pode banir números que utilizam APIs não oficiais.

## 📄 Licença

Este projeto está licenciado sob a licença MIT - veja o arquivo LICENSE para mais detalhes.

## 👨‍💻 Autor

Braian - [Seu GitHub](https://github.com/bardodb)

---

⭐️ Se este projeto te ajudou, considere dar uma estrela no GitHub!
