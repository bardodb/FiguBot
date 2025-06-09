const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const qrcode = require('qrcode-terminal');
// Importando o módulo crypto explicitamente
const crypto = require('crypto');
// Módulos para processamento de vídeo
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');
const GIFEncoder = require('gif-encoder-2');

// Configurando o caminho do ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Configuração de logs
const logger = pino({ 
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
});

// Pasta para armazenar arquivos temporários
const tempDir = path.join(__dirname, 'temp');

// Garantir que as pastas necessárias existam
if (!fs.existsSync(tempDir)) {
    console.log(`Criando pasta temporária: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
}

// Pasta para armazenar informações de autenticação
const authFolder = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(authFolder)) {
    console.log(`Criando pasta de autenticação: ${authFolder}`);
    fs.mkdirSync(authFolder, { recursive: true });
}

// Função para iniciar o bot
async function startBot() {
    try {
        console.log('Iniciando o bot de figurinhas...');
        
        // Obtém a versão mais recente do Baileys
        const { version } = await fetchLatestBaileysVersion();
        console.log(`Usando a versão ${version.join('.')} do Baileys`);
        
        // Autenticação
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        console.log('Estado de autenticação carregado');
        
        // Inicializa a conexão com configurações adicionais
        let sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'warn' }),
            browser: ['Bot de Figurinhas', 'Chrome', '10.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: false,
            retryRequestDelayMs: 250,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            patchMessageBeforeSending: (message) => {
                // Reduz o tamanho das mensagens para evitar erros de stream
                const requiresPatch = !!(message.buttonsMessage || message.listMessage || message.templateMessage);
                if (requiresPatch) {
                    message = {
                        viewOnceMessage: {
                            message: {
                                messageContextInfo: {
                                    deviceListMetadataVersion: 2,
                                    deviceListMetadata: {},
                                },
                                ...message,
                            }
                        }
                    };
                }
                return message;
            }
        });
        
        console.log('Socket WhatsApp inicializado');
        
        // Salva credenciais quando atualizado
        sock.ev.on('creds.update', saveCreds);
        
        // Gerencia conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('QR Code gerado. Escaneie com seu WhatsApp:');
                // Gera o QR code diretamente no terminal
                qrcode.generate(qr, { small: true });
                
                // Também exibe o QR code como ASCII art para os logs do deploy
                console.log('\nQR CODE (ASCII):\n');
                
                // Função para converter o QR code em ASCII art simples
                const qrToAscii = (qrData) => {
                    const qrSize = Math.sqrt(qrData.length);
                    let asciiQR = '';
                    
                    for (let y = 0; y < qrSize; y++) {
                        for (let x = 0; x < qrSize; x++) {
                            const idx = y * qrSize + x;
                            asciiQR += qrData[idx] ? '██' : '  ';
                        }
                        asciiQR += '\n';
                    }
                    
                    return asciiQR;
                };
                
                // Tenta exibir o QR code como ASCII art
                try {
                    const qrcode = require('qrcode');
                    qrcode.toString(qr, { type: 'terminal' }, (err, asciiQR) => {
                        if (!err) {
                            console.log(asciiQR);
                        } else {
                            console.log('Não foi possível gerar QR code ASCII. Use o QR code acima.');
                        }
                    });
                } catch (err) {
                    console.log('Não foi possível gerar QR code ASCII. Use o QR code acima.');
                }
                
                console.log('\nEscaneie o QR code acima com seu WhatsApp para conectar o bot.');
            }
            
            if (connection === 'close') {
                // Verifica o código de status para tratamento específico
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)
                    ? statusCode !== DisconnectReason.loggedOut
                    : true;
                
                console.log(`Conexão fechada. Código de status: ${statusCode}`);
                console.log('Detalhes do erro:', lastDisconnect?.error);
                
                // Tratamento específico para erro de stream (código 515)
                if (statusCode === 515) {
                    console.log('Erro de stream detectado. Aguardando 10 segundos antes de reconectar...');
                    // Limpa recursos antes de reconectar
                    try {
                        sock.ev.removeAllListeners();
                        sock = null;
                    } catch (e) {}
                    
                    setTimeout(() => {
                        console.log('Tentando reconectar após erro de stream...');
                        startBot();
                    }, 10000);
                    return;
                }
                
                if (shouldReconnect) {
                    const reconnectDelay = statusCode === DisconnectReason.restartRequired ? 10000 : 5000;
                    console.log(`Reconectando após ${reconnectDelay/1000} segundos...`);
                    
                    // Limpa recursos antes de reconectar
                    try {
                        sock.ev.removeAllListeners();
                        sock = null;
                    } catch (e) {}
                    
                    setTimeout(() => {
                        console.log('Tentando reconectar...');
                        startBot();
                    }, reconnectDelay);
                } else {
                    console.log('Desconectado permanentemente.');
                    
                    // Se foi desconectado por logout, remova os arquivos de autenticação
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log('Removendo arquivos de autenticação...');
                        fs.rmSync(authFolder, { recursive: true, force: true });
                        fs.mkdirSync(authFolder, { recursive: true });
                    }
                }
            } else if (connection === 'open') {
                console.log('Bot conectado! Pronto para receber imagens e criar figurinhas.');
            }
        });
        
        // Função para criar GIF a partir de vídeo
        async function createVideoGif(videoPath, senderJid) {
            try {
                console.log(`Iniciando criação de GIF a partir de: ${videoPath}`);
                
                // Verificar se o arquivo existe
                if (!fs.existsSync(videoPath)) {
                    console.error(`Arquivo de vídeo não encontrado: ${videoPath}`);
                    throw new Error('Arquivo de vídeo não encontrado');
                }
                
                // Verificar a extensão do arquivo
                const fileExt = path.extname(videoPath).toLowerCase();
                console.log(`Extensão do arquivo de vídeo: ${fileExt}`);
                
                // Caminho para salvar o GIF temporário
                const gifPath = path.join(tempDir, `gif_${Date.now()}_${Math.floor(Math.random() * 10000)}.gif`);
                // Caminho para salvar a figurinha
                const outputPath = path.join(tempDir, `sticker_${Date.now()}_${Math.floor(Math.random() * 10000)}.webp`);
                
                console.log(`Caminho de saída do GIF: ${gifPath}`);
                console.log(`Caminho de saída da figurinha: ${outputPath}`);
                
                // Converter vídeo para GIF usando ffmpeg
                console.log('Iniciando conversão de vídeo para GIF...');
                console.log(`Usando ffmpeg em: ${ffmpegInstaller.path}`);
                
                await new Promise((resolve, reject) => {
                    // Configuração do ffmpeg com mais opções para melhor compatibilidade
                    const command = ffmpeg(videoPath)
                        .outputOptions([
                            '-t', '3',          // Limita para 3 segundos (WhatsApp tem limite de tamanho)
                            '-vf', 'fps=12,scale=256:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer',
                            '-loop', '0'
                        ])
                        .output(gifPath);
                    
                    // Adiciona listeners para eventos
                    command.on('start', (commandLine) => {
                        console.log('Comando ffmpeg iniciado:', commandLine);
                    });
                    
                    command.on('progress', (progress) => {
                        console.log(`Progresso da conversão: ${JSON.stringify(progress)}`);
                    });
                    
                    command.on('end', () => {
                        console.log('Conversão para GIF concluída');
                        resolve();
                    });
                    
                    command.on('error', (err) => {
                        console.error('Erro na conversão do vídeo para GIF:', err);
                        reject(new Error(`Erro na conversão do vídeo: ${err.message}`));
                    });
                    
                    // Executa o comando
                    command.run();
                });
                
                // Verificar se o GIF foi criado
                if (!fs.existsSync(gifPath)) {
                    throw new Error('Falha ao criar GIF a partir do vídeo');
                }
                
                console.log('GIF criado com sucesso, convertendo para WebP...');
                
                // Converter GIF para WebP (formato de figurinha)
                await sharp(gifPath, { animated: true })
                    .resize(512, 512, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .toFormat('webp', { quality: 80 })
                    .toFile(outputPath);
                
                // Verificar se o arquivo de saída existe
                if (!fs.existsSync(outputPath)) {
                    console.error(`Arquivo de saída não foi criado: ${outputPath}`);
                    throw new Error('Falha ao criar figurinha animada');
                }
                
                // Ler o arquivo de figurinha
                const stickerBuffer = fs.readFileSync(outputPath);
                console.log(`Figurinha animada lida como buffer, tamanho: ${stickerBuffer.length} bytes`);
                
                // Enviar a figurinha
                console.log('Enviando figurinha animada...');
                try {
                    await sock.sendMessage(
                        senderJid, 
                        { sticker: stickerBuffer }
                    );
                    console.log('Figurinha animada enviada com sucesso!');
                } catch (sendError) {
                    console.error('Erro ao enviar figurinha animada:', sendError);
                    throw new Error(`Erro ao enviar figurinha animada: ${sendError.message}`);
                }
                
                // Limpar arquivos temporários
                try {
                    fs.unlinkSync(videoPath);
                    fs.unlinkSync(gifPath);
                    fs.unlinkSync(outputPath);
                    console.log('Arquivos temporários limpos');
                } catch (err) {
                    console.error('Erro ao limpar arquivos temporários:', err);
                    // Não lançar erro aqui, pois a figurinha já foi enviada
                }
                
                return true;
            } catch (error) {
                console.error('Erro ao criar figurinha animada:', error);
                
                // Tentar enviar mensagem de erro
                try {
                    await sock.sendMessage(
                        senderJid,
                        { text: '❌ Erro ao criar figurinha animada. Detalhes do erro: ' + error.message }
                    );
                } catch (sendError) {
                    console.error('Erro ao enviar mensagem de erro:', sendError);
                }
                
                return false;
            }
        }
        
        // Função para criar figurinha a partir de uma imagem
        async function createSticker(imagePath, senderJid) {
            try {
                console.log(`Iniciando criação de figurinha a partir de: ${imagePath}`);
                
                // Verificar se o arquivo existe
                if (!fs.existsSync(imagePath)) {
                    console.error(`Arquivo de imagem não encontrado: ${imagePath}`);
                    throw new Error('Arquivo de imagem não encontrado');
                }
                
                // Caminho para salvar a figurinha
                const outputPath = path.join(tempDir, `sticker_${Date.now()}_${Math.floor(Math.random() * 10000)}.webp`);
                console.log(`Caminho de saída da figurinha: ${outputPath}`);
                
                // Ler a imagem como buffer
                const imageBuffer = fs.readFileSync(imagePath);
                console.log(`Imagem lida como buffer, tamanho: ${imageBuffer.length} bytes`);
                
                // Processar a imagem com sharp
                console.log('Processando imagem com sharp...');
                try {
                    await sharp(imageBuffer)
                        .resize(512, 512, {
                            fit: 'contain',
                            background: { r: 0, g: 0, b: 0, alpha: 0 }
                        })
                        .toFormat('webp', { quality: 80 })
                        .toFile(outputPath);
                    
                    console.log('Imagem processada com sucesso, verificando arquivo de saída...');
                } catch (sharpError) {
                    console.error('Erro específico do sharp:', sharpError);
                    throw new Error(`Erro ao processar imagem: ${sharpError.message}`);
                }
                
                // Verificar se o arquivo de saída existe
                if (!fs.existsSync(outputPath)) {
                    console.error(`Arquivo de saída não foi criado: ${outputPath}`);
                    throw new Error('Falha ao criar arquivo de figurinha');
                }
                
                // Ler o arquivo de figurinha
                const stickerBuffer = fs.readFileSync(outputPath);
                console.log(`Figurinha lida como buffer, tamanho: ${stickerBuffer.length} bytes`);
                
                // Enviar a figurinha
                console.log('Enviando figurinha...');
                try {
                    await sock.sendMessage(
                        senderJid, 
                        { sticker: stickerBuffer }
                    );
                    console.log('Figurinha enviada com sucesso!');
                } catch (sendError) {
                    console.error('Erro ao enviar figurinha:', sendError);
                    throw new Error(`Erro ao enviar figurinha: ${sendError.message}`);
                }
                
                // Limpar arquivos temporários
                try {
                    fs.unlinkSync(imagePath);
                    fs.unlinkSync(outputPath);
                    console.log('Arquivos temporários limpos');
                } catch (err) {
                    console.error('Erro ao limpar arquivos temporários:', err);
                    // Não lançar erro aqui, pois a figurinha já foi enviada
                }
                
                return true;
            } catch (error) {
                console.error('Erro ao criar figurinha:', error);
                
                // Tentar enviar mensagem de erro
                try {
                    await sock.sendMessage(
                        senderJid,
                        { text: '❌ Erro ao criar figurinha. Detalhes do erro: ' + error.message }
                    );
                } catch (sendError) {
                    console.error('Erro ao enviar mensagem de erro:', sendError);
                }
                
                return false;
            }
        }

        // Função para processar vídeos
        async function processVideos(messages, senderJid) {
            try {
                // Responde ao usuário informando quantos vídeos foram recebidos
                await sock.sendMessage(
                    senderJid,
                    { text: `⏳ Criando ${messages.length} figurinha(s) animada(s)...` }
                );
                
                // Processa cada vídeo em paralelo
                const processingPromises = messages.map(async (message) => {
                    try {
                        // Baixa o vídeo
                        console.log('Baixando vídeo...');
                        let buffer;
                        
                        try {
                            buffer = await downloadMediaMessage(
                                message,
                                'buffer',
                                {},
                                { 
                                    logger: pino({ level: 'silent' }),
                                    // Adiciona timeout para evitar que o download fique preso
                                    timeout: 30000 // Vídeos podem ser maiores, então aumentamos o timeout
                                }
                            );
                        } catch (downloadError) {
                            console.error('Erro durante o download do vídeo:', downloadError);
                            throw new Error(`Falha ao baixar vídeo: ${downloadError.message}`);
                        }
                        
                        if (!buffer || buffer.length === 0) {
                            throw new Error('Vídeo vazio ou inválido');
                        }
                        
                        console.log(`Vídeo baixado, tamanho: ${buffer.length} bytes`);
                        
                        // Determina o tipo de arquivo com base no mimetype
                        let fileExt = '.mp4'; // Padrão para vídeos
                        if (message.message && message.message.videoMessage && message.message.videoMessage.mimetype) {
                            const mimetype = message.message.videoMessage.mimetype;
                            console.log(`Mimetype do vídeo: ${mimetype}`);
                            
                            if (mimetype.includes('mp4')) {
                                fileExt = '.mp4';
                            } else if (mimetype.includes('3gp')) {
                                fileExt = '.3gp';
                            } else if (mimetype.includes('mkv')) {
                                fileExt = '.mkv';
                            } else if (mimetype.includes('avi')) {
                                fileExt = '.avi';
                            } else if (mimetype.includes('mov')) {
                                fileExt = '.mov';
                            }
                        }
                        
                        // Salva o vídeo temporariamente com a extensão correta
                        const videoPath = path.join(tempDir, `video_${Date.now()}_${Math.floor(Math.random() * 10000)}${fileExt}`);
                        try {
                            fs.writeFileSync(videoPath, buffer);
                            console.log(`Vídeo salvo em: ${videoPath} com extensão ${fileExt}`);
                        } catch (writeError) {
                            console.error('Erro ao salvar vídeo:', writeError);
                            throw new Error(`Erro ao salvar vídeo: ${writeError.message}`);
                        }
                        
                        // Cria e envia a figurinha animada
                        return await createVideoGif(videoPath, senderJid);
                    } catch (error) {
                        console.error('Erro ao processar vídeo:', error);
                        return false;
                    }
                });
                
                // Aguarda todos os vídeos serem processados
                const results = await Promise.all(processingPromises);
                
                // Conta quantas figurinhas foram criadas com sucesso
                const successCount = results.filter(result => result === true).length;
                const failCount = results.length - successCount;
                
                // Envia mensagem de resumo
                if (failCount > 0) {
                    await sock.sendMessage(
                        senderJid,
                        { text: `✅ ${successCount} figurinha(s) animada(s) criada(s) com sucesso.\n❌ ${failCount} falha(s).` }
                    );
                } else if (successCount > 1) {
                    await sock.sendMessage(
                        senderJid,
                        { text: `✅ Todas as ${successCount} figurinhas animadas foram criadas com sucesso!` }
                    );
                }
                
                console.log(`Processamento de ${messages.length} vídeos concluído. Sucesso: ${successCount}, Falhas: ${failCount}`);
            } catch (error) {
                console.error('Erro ao processar vídeos:', error);
                
                // Tentar enviar mensagem de erro
                try {
                    await sock.sendMessage(
                        senderJid,
                        { text: '❌ Erro ao processar vídeos. Detalhes: ' + error.message }
                    );
                } catch (sendError) {
                    console.error('Erro ao enviar mensagem de erro:', sendError);
                }
            }
        }
        
        // Função para processar imagens em paralelo
        async function processImages(messages, senderJid) {
            try {
                // Responde ao usuário informando quantas imagens foram recebidas
                await sock.sendMessage(
                    senderJid,
                    { text: `⏳ Criando ${messages.length} figurinha(s)...` }
                );
                
                // Processa cada imagem em paralelo
                const processingPromises = messages.map(async (message) => {
                    try {
                        // Baixa a imagem
                        console.log('Baixando imagem...');
                        let buffer;
                        
                        try {
                            buffer = await downloadMediaMessage(
                                message,
                                'buffer',
                                {},
                                { 
                                    logger: pino({ level: 'silent' }),
                                    // Adiciona timeout para evitar que o download fique preso
                                    timeout: 10000
                                }
                            );
                        } catch (downloadError) {
                            console.error('Erro durante o download da imagem:', downloadError);
                            throw new Error(`Falha ao baixar imagem: ${downloadError.message}`);
                        }
                        
                        if (!buffer || buffer.length === 0) {
                            throw new Error('Imagem vazia ou inválida');
                        }
                        
                        console.log(`Imagem baixada, tamanho: ${buffer.length} bytes`);
                        
                        // Salva a imagem temporariamente
                        const imagePath = path.join(tempDir, `image_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`);
                        try {
                            fs.writeFileSync(imagePath, buffer);
                            console.log(`Imagem salva em: ${imagePath}`);
                        } catch (writeError) {
                            console.error('Erro ao salvar imagem:', writeError);
                            throw new Error(`Erro ao salvar imagem: ${writeError.message}`);
                        }
                        
                        // Cria e envia a figurinha
                        return await createSticker(imagePath, senderJid);
                    } catch (error) {
                        console.error('Erro ao processar imagem:', error);
                        return false;
                    }
                });
                
                // Aguarda todas as imagens serem processadas
                const results = await Promise.all(processingPromises);
                
                // Conta quantas figurinhas foram criadas com sucesso
                const successCount = results.filter(result => result === true).length;
                const failCount = results.length - successCount;
                
                // Envia mensagem de resumo
                if (failCount > 0) {
                    await sock.sendMessage(
                        senderJid,
                        { text: `✅ ${successCount} figurinha(s) criada(s) com sucesso.\n❌ ${failCount} falha(s).` }
                    );
                } else if (successCount > 1) {
                    await sock.sendMessage(
                        senderJid,
                        { text: `✅ Todas as ${successCount} figurinhas foram criadas com sucesso!` }
                    );
                }
                
                console.log(`Processamento de ${messages.length} imagens concluído. Sucesso: ${successCount}, Falhas: ${failCount}`);
            } catch (error) {
                console.error('Erro ao processar imagens:', error);
                
                // Tentar enviar mensagem de erro
                try {
                    await sock.sendMessage(
                        senderJid,
                        { text: '❌ Erro ao processar imagens. Detalhes: ' + error.message }
                    );
                } catch (sendError) {
                    console.error('Erro ao enviar mensagem de erro:', sendError);
                }
            }
        }
        
        // Gerencia mensagens recebidas
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            console.log(`Recebido ${messages.length} mensagens, tipo: ${type}`);
            
            for (const message of messages) {
                // Verificar detalhes da mensagem para debug
                console.log('Detalhes da mensagem:', JSON.stringify({
                    id: message.key.id,
                    remoteJid: message.key.remoteJid,
                    fromMe: message.key.fromMe,
                    participant: message.key.participant
                }));
                
                // Verificar o tipo de mensagem e conteúdo completo para debug
                if (message.message) {
                    console.log('Conteúdo completo da mensagem:', JSON.stringify(message));
                }
                
                // Verificar se a mensagem é do tipo notify
                if (type === 'notify') {
                    console.log('Mensagem do tipo notify recebida');
                }
                
                // Ignorar mensagens enviadas pelo próprio bot, mas com verificação mais precisa
                // Modificado para ser menos restritivo
                if (message.key.fromMe === true && message.key.id.startsWith('BAE5')) {
                    console.log('Mensagem enviada pelo próprio bot, ignorando');
                    continue;
                }
                
                // Ignorar mensagens sem conteúdo
                if (!message.message) {
                    console.log('Mensagem sem conteúdo, ignorando');
                    continue;
                }
                
                const senderJid = message.key.remoteJid;
                console.log(`Mensagem recebida de: ${senderJid}`);
                
                // Verifica se a mensagem é de um grupo
                const isGroup = senderJid.endsWith('@g.us');
                
                // Obtém o nome do grupo, se for uma mensagem de grupo
                let groupName = '';
                if (isGroup && message.key.participant) {
                    try {
                        const groupMetadata = await sock.groupMetadata(senderJid);
                        groupName = groupMetadata.subject || '';
                        console.log(`Mensagem do grupo: ${groupName}`);
                    } catch (error) {
                        console.error('Erro ao obter metadados do grupo:', error);
                    }
                }
                
                // Verifica se a mensagem é do grupo "teste"
                const targetGroupName = 'teste';
                if (!isGroup || groupName.toLowerCase() !== targetGroupName.toLowerCase()) {
                    console.log(`Mensagem não é do grupo "${targetGroupName}", ignorando`);
                    continue;
                }
                
                // Ignora mensagens de boletins informativos (newsletter)
                if (senderJid.includes('@newsletter')) {
                    console.log('Mensagem de boletim informativo (newsletter), ignorando');
                    continue;
                }
                
                // Verifica o tipo de mensagem
                if (!message.message) {
                    console.log('Mensagem sem conteúdo, ignorando');
                    continue;
                }
                
                // Obtém o conteúdo da mensagem
                const messageContent = message.message;
                console.log('Conteúdo da mensagem:', JSON.stringify(messageContent));
                
                // Verifica o tipo de mensagem
                const messageType = Object.keys(messageContent)[0];
                console.log('Tipo de mensagem:', messageType);
                
                // Coletar imagens para processamento em lote
                if (messageType === 'imageMessage') {
                    // Coleta todas as imagens desta mensagem
                    const imagesToProcess = [];
                    imagesToProcess.push(message);
                    
                    // Processa todas as imagens coletadas
                    await processImages(imagesToProcess, senderJid);
                    continue;
                }
                
                // Processar vídeos para conversão em GIF
                if (messageType === 'videoMessage') {
                    console.log('Mensagem de vídeo recebida, processando para GIF...');
                    const videosToProcess = [];
                    videosToProcess.push(message);
                    
                    // Processa o vídeo para criar GIF
                    await processVideos(videosToProcess, senderJid);
                    continue;
                }
                
                // Verifica se é uma mensagem de texto
                if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
                    const text = messageType === 'conversation' 
                        ? messageContent.conversation 
                        : messageContent.extendedTextMessage.text;
                    
                    console.log('Mensagem de texto recebida:', JSON.stringify(text));
                    
                    // Verifica se é um comando
                    if (text.toLowerCase() === 'ping') {
                        console.log('Comando ping recebido');
                        await sock.sendMessage(
                            senderJid,
                            { text: '🟢 Pong! Bot online e funcionando.' }
                        );
                        continue;
                    }
                    
                    // Verifica se é um comando de ajuda
                    if (text.toLowerCase() === 'ajuda' || text.toLowerCase() === 'help') {
                        console.log('Comando de ajuda recebido');
                        await sock.sendMessage(
                            senderJid,
                            { text: '🤖 *Bot de Figurinhas*\n\n' +
                                   '- Envie uma imagem para convertê-la em figurinha\n' +
                                   '- Envie várias imagens e todas serão convertidas\n' +
                                   '- Envie um vídeo para convertê-lo em figurinha animada (GIF)\n' +
                                   '- Digite *ping* para verificar se estou online\n' +
                                   '- Digite *ajuda* para ver esta mensagem' }
                        );
                        continue;
                    }
                    
                    // Mensagem de texto genérica
                    console.log('Mensagem de texto genérica recebida, enviando dica');
                    await sock.sendMessage(
                        senderJid,
                        { text: '👋 Olá! Envie uma imagem para que eu a converta em figurinha ou um vídeo para criar uma figurinha animada.\n' +
                               'Digite *ajuda* para ver os comandos disponíveis.' }
                    );
                    continue;
                }
                
                // Coletar imagens de mensagens com várias imagens
                if (messageType === 'viewOnceMessage' || messageType === 'viewOnceMessageV2') {
                    const viewOnceContent = messageType === 'viewOnceMessage' 
                        ? messageContent.viewOnceMessage 
                        : messageContent.viewOnceMessageV2;
                    
                    if (viewOnceContent.message && viewOnceContent.message.imageMessage) {
                        // Coleta a imagem para processamento
                        const imageMessage = {...message};
                        imageMessage.message = {
                            imageMessage: viewOnceContent.message.imageMessage
                        };
                        
                        // Processa a imagem
                        await processImages([imageMessage], senderJid);
                        continue;
                    }
                    
                    // Verifica se é um vídeo para processar
                    if (viewOnceContent.message && viewOnceContent.message.videoMessage) {
                        console.log('Vídeo em mensagem viewOnce detectado');
                        // Coleta o vídeo para processamento
                        const videoMessage = {...message};
                        videoMessage.message = {
                            videoMessage: viewOnceContent.message.videoMessage
                        };
                        
                        // Processa o vídeo
                        await processVideos([videoMessage], senderJid);
                        continue;
                    }
                }
                
                // Verifica se é uma mensagem com múltiplas imagens
                if (messageType === 'messageContextInfo' || messageType === 'protocolMessage') {
                    console.log('Mensagem de contexto ou protocolo recebida, verificando conteúdo');
                    continue;
                }
                
                // Tipo de mensagem não suportado
                console.log(`Tipo de mensagem não suportado: ${messageType}`);
                continue;
            }
        });
        // Adiciona listener para erros específicos
        sock.ev.on('messaging-history.set', (data) => {
            console.log(`Histórico de mensagens atualizado: ${data.length} mensagens carregadas`);
        });
        
        // Adiciona listener para erros específicos
        process.on('uncaughtException', (err) => {
            console.error('Erro não tratado:', err);
            // Não reinicia automaticamente para evitar loops infinitos
        });
        
        // Gerencia erros de websocket
        sock.ws.on('error', (err) => {
            console.error('Erro de WebSocket:', err);
            // O evento connection.update já vai lidar com a reconexão
        });
        
        // Gerencia fechamento de websocket
        sock.ws.on('close', (code) => {
            console.log(`WebSocket fechado com código ${code}`);
            // O evento connection.update já vai lidar com a reconexão
        });
        
    } catch (error) {
        console.error('Erro ao iniciar o bot:', error);
        // Evita loops infinitos de reconexão verificando o tipo de erro
        const reconnectDelay = error.message?.includes('Stream') ? 15000 : 10000;
        setTimeout(() => {
            console.log(`Tentando reiniciar o bot após erro... (aguardando ${reconnectDelay/1000}s)`);            
            startBot();
        }, reconnectDelay);
    }
}

// Inicia o bot
startBot();
