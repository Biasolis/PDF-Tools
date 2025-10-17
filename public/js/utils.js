// public/js/utils.js

/**
 * Inicia uma nova sessão no backend.
 * @param {HTMLElement} statusEl - Elemento para exibir mensagens de status.
 * @returns {Promise<object|null>} - Objeto com sessionId ou null em caso de erro.
 */
export async function startNewSession(statusEl) {
    try {
        const response = await fetch('/session/create', { method: 'POST' });
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ error: 'Falha desconhecida ao criar sessão.' }));
             throw new Error(errorData.error || `Erro ${response.status} ao criar sessão.`);
        }
        const data = await response.json();
        if (!data.sessionId) {
            throw new Error("Servidor não retornou um ID de sessão válido.");
        }
        console.log("Nova sessão iniciada:", data.sessionId); // Log para debug
        // Retorna um objeto que pode ser estendido (ex: com 'files: new Map()' onde for necessário)
        return { sessionId: data.sessionId };
    } catch (error) {
         console.error("Erro ao iniciar sessão:", error);
        showStatus(statusEl, `Erro de Sessão: ${error.message}`, 'error');
        return null;
    }
}

/**
 * Faz upload de um arquivo com barra de progresso via XHR.
 * @param {string} sessionId - ID da sessão.
 * @param {File} file - Arquivo a ser enviado.
 * @param {function(number)} onProgress - Callback para atualizar o progresso (0-100).
 * @returns {Promise<object>} - Promessa resolvida com a resposta JSON do servidor ou rejeitada com erro.
 */
export function uploadFileWithProgress(sessionId, file, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        const xhr = new XMLHttpRequest();

        if (!sessionId) {
             return reject(new Error("ID de sessão inválido para upload."));
        }

        xhr.open('POST', `/session/upload/${sessionId}`, true);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                onProgress(percentComplete);
            }
        };
        xhr.onload = () => {
            try {
                 if (!xhr.responseText) {
                     if (xhr.status >= 500) return reject(new Error(`Erro ${xhr.status} no servidor durante upload (resposta vazia).`));
                     return resolve({ warning: 'Resposta vazia do servidor no upload.', fileId: null });
                 }
                const response = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300 && response.fileId) { // Garante que fileId exista
                    resolve(response);
                } else {
                    reject(new Error(response.error || `Erro ${xhr.status} no upload.`));
                }
            } catch (e) {
                console.error("Erro ao processar resposta do upload:", e, "Resposta:", xhr.responseText);
                reject(new Error('Resposta inválida do servidor durante o upload.'));
            }
        };
        xhr.onerror = (e) => {
             console.error("Erro de rede no XHR:", e);
            reject(new Error('Erro de rede durante o upload. Verifique a conexão e o console do navegador.'));
        };
         xhr.ontimeout = () => {
             reject(new Error('Tempo limite excedido durante o upload.'));
         };
        xhr.send(formData);
    });
}

/**
 * Faz upload de um único arquivo (sem progresso explícito). Usado por multi-upload.
 * @param {string} sessionId - ID da sessão.
 * @param {File} file - Arquivo a ser enviado.
 * @returns {Promise<object|null>} - Objeto com fileId ou null em caso de erro.
 */
export async function uploadSingleFile(sessionId, file) {
     if (!sessionId) {
          console.error("uploadSingleFile chamado sem sessionId");
          return null;
     }
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await fetch(`/session/upload/${sessionId}`, { method: 'POST', body: formData });
         if (!response.ok) {
             const errorData = await response.json().catch(() => null);
             console.warn(`Falha no upload (single) para ${sessionId}: ${errorData?.error || response.status}`);
             return null;
         }
         const data = await response.json();
         // Garante que está retornando um objeto com fileId
         return data && data.fileId ? data : null;
    } catch (e) {
        console.error("Erro em uploadSingleFile:", e);
        return null;
    }
}


/**
 * Verifica periodicamente o status de um job no backend.
 * @param {string} sessionId - ID da sessão/job.
 * @param {HTMLElement} statusEl - Elemento para exibir status.
 * @param {HTMLButtonElement} button - Botão principal da ferramenta.
 * @param {HTMLElement} [addButtonLabel=null] - Label 'Adicionar Arquivos' (opcional).
 * @param {HTMLInputElement} [input=null] - Input de arquivo (opcional).
 */
export function pollJobStatus(sessionId, statusEl, button, addButtonLabel = null, input = null) {
    let attempts = 0;
    const maxAttempts = 60; // Aumentado para ~3 minutos (60 * 3s) para conversões longas
    const intervalTime = 3000;

    const cleanup = (isError = false) => {
        clearInterval(intervalId);
        if (button) button.disabled = false;
        if (addButtonLabel) addButtonLabel.classList.remove('hidden');
        if (input) input.disabled = false;
        if (input) input.value = '';
        console.log(`Polling para ${sessionId} finalizado. Erro: ${isError}`); // Log
    };

     // Validação inicial
     if (!sessionId) {
         console.error("pollJobStatus iniciado sem sessionId!");
         showStatus(statusEl, 'Erro interno: ID da sessão inválido para polling.', 'error');
         cleanup(true);
         return;
     }

    console.log(`Iniciando polling para ${sessionId}...`); // Log
    showStatus(statusEl, 'Aguardando processamento do servidor...', 'processing'); // Estado inicial

    const intervalId = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            console.warn(`Polling para ${sessionId} excedeu ${maxAttempts} tentativas.`); // Log
            showStatus(statusEl, 'Tempo limite excedido esperando resposta do servidor.', 'error');
            cleanup(true);
            return;
        }

        try {
            const response = await fetch(`/session/status/${sessionId}`);

             if (!response.ok) {
                 console.warn(`Erro ${response.status} ao buscar status para ${sessionId}.`); // Log
                 if (response.status === 404) {
                      showStatus(statusEl, 'Sessão não encontrada ou expirada no servidor.', 'error');
                 } else {
                      showStatus(statusEl, `Erro ${response.status} ao verificar status.`, 'error');
                 }
                 cleanup(true);
                 return;
             }

            const data = await response.json();
             console.log(`Status recebido para ${sessionId}:`, data.status); // Log

            if (data.status === 'processing') {
                showStatus(statusEl, 'Servidor está processamento...', 'processing');
            } else if (data.status === 'complete') {
                 if (data.downloadUrl) {
                    console.log(`Job ${sessionId} completo. URL: ${data.downloadUrl}`); // Log
                    createDownloadLinkFromUrl(data.downloadUrl, data.downloadUrl.split('/').pop(), statusEl);
                 } else {
                      console.error(`Job ${sessionId} completo mas sem downloadUrl.`); // Log
                      showStatus(statusEl, 'Processo concluído, mas URL de download não encontrada.', 'error');
                 }
                cleanup(false);
            } else if (data.status === 'error') {
                 console.error(`Erro no job ${sessionId}:`, data.message); // Log
                showStatus(statusEl, `Erro no servidor: ${data.message || 'Falha no processamento.'}`, 'error');
                cleanup(true);
            } else if (data.status === 'created') {
                 // Ainda aguardando o início, continua o polling
                 showStatus(statusEl, 'Aguardando início do processamento...', 'info');
            } else {
                 console.warn(`Status inesperado para ${sessionId}:`, data.status); // Log status desconhecido
            }
        } catch (e) {
            console.error(`Erro durante polling para ${sessionId}:`, e); // Log erro de rede/JSON
            showStatus(statusEl, 'Erro de comunicação ao verificar status.', 'error');
            cleanup(true);
        }
    }, intervalTime);
}

/**
 * Limpa a área de status.
 * @param {HTMLElement} element - O elemento de status a ser limpo.
 */
export function clearStatus(element) {
     if (!element) return;
     const container = element.querySelector('.progress-container');
     const bar = element.querySelector('.progress-bar');
     const text = element.querySelector('.status-text');

     if (container) container.style.display = 'none';
     if (bar) bar.style.width = '0%';
     // Limpa classes de cor da barra, mantendo as básicas
     if (bar) bar.className = 'progress-bar h-2.5 rounded-full';
     if (text) text.innerHTML = '';
     if (text) text.className = 'status-text text-sm'; // Reseta classes
}

/**
 * Mostra uma mensagem de status e opcionalmente uma barra de progresso.
 * @param {HTMLElement} element - Elemento pai da área de status.
 * @param {string} message - Mensagem a ser exibida.
 * @param {'info'|'progress'|'processing'|'success'|'error'} type - Tipo de status.
 * @param {number} [progress=0] - Percentual de progresso (0-100) para 'progress'.
 */
export function showStatus(element, message, type, progress = 0) {
    if (!element) {
         console.warn("showStatus chamado com elemento nulo.");
         return;
    }
    const container = element.querySelector('.progress-container');
    const bar = element.querySelector('.progress-bar');
    const text = element.querySelector('.status-text');

    if (!container || !bar || !text) {
        console.warn("Elementos internos de status não encontrados em:", element);
        element.textContent = message; // Fallback
         element.className = '';
         if (type === 'error') element.classList.add('text-red-600', 'text-sm', 'font-semibold');
         else if (type === 'success') element.classList.add('text-green-600', 'text-sm');
         else element.classList.add('text-gray-700', 'text-sm');
        return;
    }

    // --- Reset ---
     clearStatus(element); // Limpa estados anteriores antes de aplicar o novo

    // --- Aplica o novo estado ---
    text.textContent = message; // Define a mensagem para todos os tipos

     // Determina a cor baseada no botão da seção (se existir)
     let colorClass = 'blue'; // Default
     const parentSection = element.closest('section');
     const sectionButton = parentSection?.querySelector('button[id$="-button"]');
     if (sectionButton) {
         const match = sectionButton.className.match(/bg-([a-z]+)-500/);
         if (match && match[1]) {
             colorClass = match[1];
         }
     }
     const bgColorClass = `bg-${colorClass}-600`; // Classe para a barra

    if (type === 'error') {
        text.classList.add('text-red-600', 'font-semibold');
    } else if (type === 'progress') {
        container.style.display = 'block';
        bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        bar.classList.add(bgColorClass);
        text.classList.add('text-gray-700');
    } else if (type === 'processing') {
        container.style.display = 'block';
        bar.style.width = `100%`;
        bar.classList.add(bgColorClass, 'processing'); // Adiciona cor e animação
        text.classList.add('text-gray-700');
    } else if (type === 'info') {
        text.classList.add('text-gray-700');
    } else if (type === 'success') {
        text.classList.add('text-green-600');
    }
}


/**
 * Cria um link de download para um Blob.
 * @param {Blob} blob - O conteúdo do arquivo.
 * @param {string} fileName - Nome sugerido para o arquivo.
 * @param {string} mimeType - MIME type do arquivo.
 * @param {HTMLElement} element - Elemento onde o link será inserido (ou seu .status-text).
 */
export function createDownloadLink(blob, fileName, mimeType, element) {
     const targetElement = element.querySelector('.status-text') || element;
     clearStatus(element);

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.className = 'inline-block bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-all duration-300 text-sm';
    link.textContent = `Baixar ${fileName}`;
    link.onclick = () => {
         // Pequeno timeout para garantir que o download inicie antes de revogar
         setTimeout(() => {
              try { URL.revokeObjectURL(url); console.log("Blob URL revogada:", url);} catch(e){}
         }, 100);
    };

    targetElement.appendChild(link);

    // Revoga a URL após um tempo maior como fallback
    setTimeout(() => {
         try { URL.revokeObjectURL(url); console.log("Blob URL revogada (timeout):", url); } catch(e){}
    }, 120000); // 2 minutos
}

/**
 * Cria um link de download a partir de uma URL (geralmente do backend).
 * @param {string} url - A URL para download.
 * @param {string} fileName - O nome original do arquivo (pode conter ID de sessão).
 * @param {HTMLElement} element - O elemento onde o link será inserido (ou seu .status-text).
 */
export function createDownloadLinkFromUrl(url, fileName, element) {
     const targetElement = element.querySelector('.status-text') || element;
     clearStatus(element);

    // Tenta limpar o nome do arquivo para exibição
     let cleanFileNameForDisplay = fileName;
     // Remove timestamp- prefixo se existir
     cleanFileNameForDisplay = cleanFileNameForDisplay.replace(/^\d{13}-/, '');
     // Remove sufixos como _unido_..., _pdf_..., etc. mantendo a extensão
     cleanFileNameForDisplay = cleanFileNameForDisplay.replace(/_(unido|comprimido|pdfa|separado|jpg|convertido|ods|pdf|docx)_\w+(\.\w+)$/i, '$2');


    const link = document.createElement('a');
    link.href = url;
    // O atributo 'download' sugere o nome, mas o servidor define o final via Content-Disposition
    link.download = cleanFileNameForDisplay;
    link.className = 'inline-block bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-all duration-300 text-sm';
    link.textContent = `Baixar ${cleanFileNameForDisplay}`;

    targetElement.appendChild(link);
}