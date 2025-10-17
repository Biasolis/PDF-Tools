// public/js/tool-setup.js
import { startNewSession, uploadFileWithProgress, uploadSingleFile, pollJobStatus, showStatus, clearStatus, createDownloadLink } from './utils.js';

/**
 * Configura o listener para ferramentas assíncronas que processam múltiplos arquivos.
 * @param {string} toolId - ID da ferramenta (ex: 'jpg-para-pdf').
 */
export function setupMultiFileAsyncTool(toolId) {
    const cardEl = document.getElementById(`${toolId}-card`);
    if (!cardEl) return;
    const input = document.getElementById(`${toolId}-input`);
    const button = document.getElementById(`${toolId}-button`);
    const statusEl = document.getElementById(`${toolId}-status`);
    if (!button || !input || !statusEl) {
         console.error(`Elementos não encontrados para ${toolId}`);
         return;
    }

    let sessionData = null;
    let fileMap = new Map(); // { tempId: { originalName, serverId, status, message? } }

    input.addEventListener('change', async () => {
        clearStatus(statusEl);
        if (!sessionData) {
            const newSession = await startNewSession(statusEl);
            if (!newSession) return;
            sessionData = newSession;
             fileMap.clear();
        }

        const files = Array.from(input.files);
        if (files.length === 0) {
            button.disabled = true;
            return;
        };

        input.disabled = true;
        button.disabled = true;

        showStatus(statusEl, `Enviando ${files.length} arquivos... (0%)`, 'progress', 0);

        let completed = 0;
        let successful = 0;

        const uploadPromises = files.map(async (file) => {
            const tempId = `temp-${Date.now()}-${Math.random()}`;
            fileMap.set(tempId, { originalName: file.name, serverId: null, status: 'uploading' });

            try {
                // Usa uploadSingleFile (sem progresso individual visível aqui)
                const uploadData = await uploadSingleFile(sessionData.sessionId, file);
                if (uploadData && uploadData.fileId) {
                    fileMap.set(tempId, { ...fileMap.get(tempId), serverId: uploadData.fileId, status: 'uploaded' });
                    successful++;
                } else {
                    // Se uploadData for nulo ou sem fileId, lança erro
                    throw new Error(uploadData?.error || 'Falha no upload (sem ID)');
                }
            } catch (error) {
                console.warn(`Falha no upload de ${file.name}:`, error);
                fileMap.set(tempId, { ...fileMap.get(tempId), status: 'error', message: error.message });
            } finally {
                completed++;
                const percentOverall = (completed / files.length) * 100;
                // Atualiza status geral do progresso
                showStatus(statusEl, `Enviando ${files.length} arquivos... (${Math.round(percentOverall)}%)`, 'progress', percentOverall);
            }
        });

        await Promise.all(uploadPromises);

        input.disabled = false; // Reabilita input após todos os uploads tentarem
        const uploadedIds = Array.from(fileMap.values()).filter(f => f.status === 'uploaded').map(f => f.serverId);

        if (uploadedIds.length > 0) {
             button.disabled = false; // Habilita botão de conversão
             if (uploadedIds.length === files.length) {
                 showStatus(statusEl, `${files.length} arquivos prontos. Clique para converter.`, 'success');
             } else {
                 const failedCount = files.length - uploadedIds.length;
                 showStatus(statusEl, `${uploadedIds.length} de ${files.length} arquivos enviados. ${failedCount} falharam. Clique para converter os válidos.`, 'info');
             }
        } else {
             // Se nenhum arquivo foi enviado com sucesso
             showStatus(statusEl, `Falha no upload de todos os ${files.length} arquivos. Verifique os arquivos ou a conexão.`, 'error');
             button.disabled = true; // Mantém desabilitado
             sessionData = null; // Invalida sessão
             fileMap.clear();
        }
         input.value = ''; // Limpa seleção do input
    });


    button.addEventListener('click', async () => {
         clearStatus(statusEl);
        if (!sessionData) {
             showStatus(statusEl, 'Sessão expirada ou não iniciada. Selecione arquivos novamente.', 'error'); return;
        }

        const uploadedFileIds = Array.from(fileMap.values())
                                    .filter(f => f.status === 'uploaded')
                                    .map(f => f.serverId);

        if (uploadedFileIds.length === 0) {
            showStatus(statusEl, 'Nenhum arquivo válido foi enviado com sucesso para processar.', 'error');
            return;
        }

        const currentSessionId = sessionData.sessionId; // Guarda ID para o caso de resetar sessionData

        button.disabled = true;
        input.disabled = true;
        showStatus(statusEl, 'Iniciando processamento no servidor...', 'processing');

        try {
            const executeResponse = await fetch(`/session/execute/${currentSessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: toolId, files: uploadedFileIds }) // Envia apenas IDs dos arquivos válidos
            });

            if (!executeResponse.ok) {
                const errorData = await executeResponse.json().catch(() => ({ error: 'Erro desconhecido.' }));
                throw new Error(errorData.error || `Falha ao iniciar (${executeResponse.status}).`);
            }

            // Reseta estado local APÓS iniciar o job com sucesso
            sessionData = null;
            fileMap.clear();
            // input.value = ''; // Já limpo no 'change'

            // Inicia o polling com o ID da sessão que acabou de ser usada
            pollJobStatus(currentSessionId, statusEl, button, null, input);

        } catch (error) {
            console.error(`Erro ao executar ${toolId}:`, error);
            showStatus(statusEl, `Erro: ${error.message}`, 'error');
            // Reabilita controles se o INÍCIO da execução falhar
            // Mantém sessionData e fileMap para possível retentativa se erro foi só no execute
            button.disabled = uploadedFileIds.length === 0; // Só reabilita se ainda houver arquivos válidos
            input.disabled = false;
        }
    });
}


/**
 * Configura o listener para ferramentas assíncronas de arquivo único, com suporte a opções.
 * @param {string} toolId - ID da ferramenta.
 */
export function setupSimpleAsyncTool(toolId) {
    const cardEl = document.getElementById(`${toolId}-card`);
     if (!cardEl) return;
    const input = document.getElementById(`${toolId}-input`);
    const button = document.getElementById(`${toolId}-button`);
    const statusEl = document.getElementById(`${toolId}-status`);
    // Encontra todos os inputs/selects que podem ser opções DENTRO do card da ferramenta
    const optionsInputs = cardEl.querySelectorAll('input[type="password"], input[type="text"]:not([type="file"]), input[type="number"], select');

    if (!button || !input || !statusEl) {
        console.error(`Elementos básicos não encontrados para ${toolId}`);
        return;
    }

    let currentSessionId = null; // Armazena o ID da sessão ativa para esta ferramenta

    // Habilita/desabilita botão baseado no arquivo E nas opções obrigatórias
    const checkEnableButton = () => {
         let enabled = input.files.length > 0;
         optionsInputs.forEach(optInput => {
              // Verifica se tem 'required' OU se é a senha de 'proteger-pdf'
              const isRequired = optInput.hasAttribute('required') || (toolId === 'proteger-pdf' && optInput.id === 'proteger-pdf-password');
              if (isRequired && !optInput.value) {
                   enabled = false;
              }
         });
         button.disabled = !enabled;
    };

    input.addEventListener('change', () => {
         clearStatus(statusEl);
         checkEnableButton();
    });
    optionsInputs.forEach(optInput => {
         // Usa 'input' para capturar mudanças imediatamente (digitação, colar, etc.)
         optInput.addEventListener('input', checkEnableButton);
    });

    // Garante estado inicial correto do botão
    checkEnableButton();

    button.addEventListener('click', async () => {
        if (input.files.length === 0) { showStatus(statusEl, 'Selecione um arquivo.', 'error'); return; }
        const file = input.files[0];

        // Coleta valores das opções
        const options = {};
         optionsInputs.forEach(optInput => {
             const key = optInput.id.replace(`${toolId}-`, ''); // Mapeia ID para chave (ex: proteger-pdf-password -> password)
             if (key) {
                  options[key] = optInput.value;
             }
         });

         // Validação específica (ex: senha não pode estar vazia para proteger)
         if (toolId === 'proteger-pdf' && (!options.password || options.password.length === 0)) {
              showStatus(statusEl, 'Por favor, digite a senha desejada.', 'error');
              return; // Impede a execução
         }

        button.disabled = true;
        input.disabled = true;
        optionsInputs.forEach(opt => opt.disabled = true);
         clearStatus(statusEl);

        showStatus(statusEl, 'Iniciando sessão...', 'info');
        const sessionData = await startNewSession(statusEl);
        if (!sessionData) {
             // Reabilita controles se falhar ao criar sessão
             button.disabled = false; input.disabled = false; optionsInputs.forEach(opt => opt.disabled = false); checkEnableButton(); // Verifica estado correto do botão
             return;
        }
        currentSessionId = sessionData.sessionId;

        try {
            // 1. Upload
            const uploadData = await uploadFileWithProgress(currentSessionId, file, (percent) => {
                showStatus(statusEl, `Enviando: ${Math.round(percent)}%`, 'progress', percent);
            });
            if (!uploadData || !uploadData.fileId) {
                throw new Error(uploadData?.error || 'Falha no upload (sem ID).');
            }

            // 2. Execução
            showStatus(statusEl, 'Iniciando processamento...', 'processing');
            const executeResponse = await fetch(`/session/execute/${currentSessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                     tool: toolId,
                     files: [uploadData.fileId], // Envia o nome do arquivo como foi salvo
                     options: options // Envia as opções coletadas
                 })
            });
            if (!executeResponse.ok) {
                 const errorData = await executeResponse.json().catch(() => ({error: 'Erro desconhecido.'}));
                throw new Error(errorData.error || `Falha ao iniciar (${executeResponse.status}).`);
            }

            // 3. Polling (inicia SÓ se execute foi OK)
            pollJobStatus(currentSessionId, statusEl, button, null, input);

             // Limpa inputs de opções (exceto senha, talvez?) após iniciar job com sucesso
             optionsInputs.forEach(opt => {
                  if (opt.type !== 'password') opt.value = ''; // Limpa outros campos
             });
             // Limpa o input de arquivo (mas ele já está desabilitado)
             // input.value = ''; // Não necessário aqui, feito no cleanup do polling

        } catch (error) {
            console.error(`Erro no processo ${toolId}:`, error);
            showStatus(statusEl, `Erro: ${error.message}`, 'error');
            // Reabilita tudo em caso de erro
            button.disabled = false;
            input.disabled = false;
            optionsInputs.forEach(opt => opt.disabled = false);
             checkEnableButton(); // Garante estado correto do botão
             input.value = ''; // Limpa seleção de arquivo
             currentSessionId = null; // Reseta ID da sessão
        }
        // Nota: O 'finally' não é ideal aqui porque o polling continua em background.
        // A reabilitação dos inputs agora acontece dentro do 'cleanup' do pollJobStatus.
    });
}

/**
 * Configura o listener para ferramentas síncronas (execução rápida no backend).
 * @param {string} toolId - ID da ferramenta (ex: 'pdf-para-docx-simple').
 */
export function setupSimpleSyncTool(toolId) {
    const cardEl = document.getElementById(`${toolId}-card`);
     if (!cardEl) return; // Sai se o card não existir no HTML
    const input = document.getElementById(`${toolId}-input`);
    const button = document.getElementById(`${toolId}-button`);
    const statusEl = document.getElementById(`${toolId}-status`);
    if (!button || !input || !statusEl) {
        console.error(`Elementos não encontrados para ${toolId}`);
        return;
    };

     input.addEventListener('change', () => {
         clearStatus(statusEl);
         button.disabled = input.files.length === 0;
     });
     // Estado inicial do botão
     button.disabled = input.files.length === 0;


    button.addEventListener('click', async () => {
        if (input.files.length === 0) { showStatus(statusEl, 'Selecione um arquivo.', 'error'); return; }
        const file = input.files[0];
        button.disabled = true;
        input.disabled = true;
         clearStatus(statusEl);

        const formData = new FormData();
        formData.append('file', file);
        showStatus(statusEl, 'Processando...', 'processing');
        try {
            // Rota correspondente no backend (ex: /pdftodocxsimple)
             const route = `/${toolId.replace(/-/g, '')}`;
             console.log("Chamando rota síncrona:", route);

            const response = await fetch(route, { method: 'POST', body: formData });
            if (!response.ok) {
                 let errorMsg = `Erro ${response.status}.`;
                 try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; } catch (e) {}
                 throw new Error(errorMsg);
            }

            const blob = await response.blob();
            // Extrai nome do header Content-Disposition
            const disposition = response.headers.get('content-disposition');
             let fileName = `${toolId}-resultado`; // Fallback
             if (disposition && disposition.includes('filename=')) {
                const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i) || disposition.match(/filename="?([^"]+)"?/i);
                 if (filenameMatch && filenameMatch[1]) {
                    try {
                         fileName = decodeURIComponent(filenameMatch[1].replace(/['"]/g, ''));
                    } catch (e) {
                         console.warn("Falha ao decodificar nome do arquivo, usando fallback:", filenameMatch[1]);
                         fileName = filenameMatch[1].replace(/['"]/g, ''); // Usa como está se falhar
                    }
                 }
             }

            createDownloadLink(blob, fileName, blob.type, statusEl);

        } catch (e) {
            console.error(`Erro na ferramenta síncrona ${toolId}:`, e);
            showStatus(statusEl, `Falha: ${e.message}`, 'error');
        } finally {
            // Reabilita controles e limpa seleção
            button.disabled = false;
            input.disabled = false;
             input.value = '';
             checkEnableButton(); // Garante estado correto
        }
    });
}