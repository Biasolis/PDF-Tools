// public/js/tool-unir-pdf.js
import { startNewSession, uploadFileWithProgress, pollJobStatus, showStatus, clearStatus } from './utils.js';

export function setupUnirPdfTool() {
    const toolId = 'unir-pdf';
    const cardEl = document.getElementById(`${toolId}-card`);
    if (!cardEl) return;

    const input = document.getElementById(`${toolId}-input`);
    const button = document.getElementById(`${toolId}-button`);
    const previewArea = document.getElementById('pdf-preview-area');
    const statusEl = document.getElementById(`${toolId}-status`);
    const addButtonLabel = cardEl.querySelector('label[for="unir-pdf-input"]'); // Mais específico

    if (!input || !button || !previewArea || !statusEl || !addButtonLabel) {
        console.error("Elementos essenciais para 'Unir PDF' não encontrados.");
        return;
    }

    let sessionData = null; // Incluirá { sessionId, files: new Map() }

    // Inicializa pdf.js worker se a biblioteca estiver carregada
    if (window.pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;
    } else {
         console.warn("pdf.js não carregado, previews não funcionarão.");
    }
    // Inicializa SortableJS para drag-and-drop
    if (window.Sortable) {
        new Sortable(previewArea, { animation: 150, ghostClass: 'sortable-ghost' });
    } else {
         console.warn("SortableJS não carregado, reordenação não funcionará.");
    }


    input.addEventListener('change', async (event) => {
        clearStatus(statusEl);
        if (!sessionData) {
            const newSession = await startNewSession(statusEl);
            if (!newSession) return;
            sessionData = { ...newSession, files: new Map() }; // Inicializa o Map aqui
        }

        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        input.disabled = true;
        addButtonLabel.classList.add('cursor-not-allowed', 'opacity-50');

        for (const file of files) {
            // Validação de tipo antes de criar card
            if (!file.type || file.type !== 'application/pdf') {
                showStatus(statusEl, `Arquivo '${file.name}' não é PDF.`, 'error');
                continue; // Pula para o próximo arquivo
            }
            const card = generatePreviewCard(file);
            if (card) { // Só processa se o card foi criado
                await uploadAndTrackFile(sessionData, file, card);
            }
        }

        input.disabled = false;
        addButtonLabel.classList.remove('cursor-not-allowed', 'opacity-50');
        updateMergeButtonState();
        event.target.value = ''; // Limpa seleção para permitir selecionar o mesmo arquivo novamente
    });

    const generatePreviewCard = (file) => {
        const cardId = `preview-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const card = document.createElement('div');
        card.id = cardId;
        card.className = 'relative group bg-gray-100 p-2 rounded-lg shadow-sm cursor-grab';
        card.innerHTML = `
            <div class="absolute inset-0 bg-blue-200 rounded-lg progress-bar" style="width: 0%; transition: width 0.3s;"></div>
            <div class="relative">
                <canvas class="w-full h-auto rounded bg-white min-h-[50px]"></canvas>
                <p class="text-xs text-center truncate mt-1 px-1">${file.name}</p>
                <button class="delete-btn absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hidden" title="Remover">&times;</button>
            </div>
        `;
        previewArea.appendChild(card);

        // Gera preview usando pdf.js (se disponível)
        if (window.pdfjsLib) {
             const fileReader = new FileReader();
             fileReader.onload = async (e) => {
                 try {
                     const typedarray = new Uint8Array(e.target.result);
                     const pdf = await pdfjsLib.getDocument({ data: typedarray, password: '' }).promise.catch(err => {
                          if (err.name === 'PasswordException') throw new Error('PDF protegido');
                          throw err;
                     });
                     if (pdf.numPages === 0) throw new Error('PDF vazio');
                     const page = await pdf.getPage(1);
                     const canvas = card.querySelector('canvas');
                     if(!canvas) return;
                     const context = canvas.getContext('2d');
                     const viewport = page.getViewport({ scale: 0.3 });
                     canvas.height = viewport.height;
                     canvas.width = viewport.width;
                     await page.render({ canvasContext: context, viewport: viewport }).promise;
                 } catch (error) {
                     console.warn(`Erro preview ${file.name}:`, error);
                     displayPreviewError(card, error.message || 'Erro preview');
                 }
             };
             fileReader.onerror = () => { displayPreviewError(card, 'Erro leitura'); };
             fileReader.readAsArrayBuffer(file);
        } else {
             // Fallback se pdf.js não estiver carregado
             displayPreviewError(card, 'Preview indisponível');
        }

        return card;
    };

    const displayPreviewError = (card, message) => {
         const relativeDiv = card?.querySelector('.relative');
         if (relativeDiv) {
             // Adiciona overlay de erro
             const errorOverlay = document.createElement('div');
             errorOverlay.className = "absolute inset-0 bg-red-100 bg-opacity-80 flex items-center justify-center p-1";
             errorOverlay.innerHTML = `<p class="text-xxs text-red-700 text-center font-semibold">${message}</p>`;
             relativeDiv.appendChild(errorOverlay);
         }
    };

    const displayUploadError = (card, message) => {
        displayPreviewError(card, message); // Reutiliza a função de erro de preview para upload
        if(sessionData && card) sessionData.files.set(card, { status: 'error' });
        updateMergeButtonState();
    };

    const uploadAndTrackFile = async (session, file, card) => {
        if (!card || !session || !session.files) return;
        session.files.set(card, { originalName: file.name, serverId: null, status: 'uploading' });

        const progressBar = card.querySelector('.progress-bar');
        if (!progressBar) return;

        try {
            const uploadData = await uploadFileWithProgress(session.sessionId, file, (percent) => {
                progressBar.style.width = `${percent}%`;
            });

            // Verifica se o upload foi bem-sucedido E retornou um fileId
            if (uploadData && uploadData.fileId) {
                session.files.get(card).serverId = uploadData.fileId;
                session.files.get(card).status = 'uploaded';
                const deleteBtn = card.querySelector('.delete-btn');
                if (deleteBtn) {
                    deleteBtn.classList.remove('hidden');
                    deleteBtn.onclick = () => { // Usar onclick para evitar múltiplos listeners
                        card.remove();
                        session.files.delete(card);
                        updateMergeButtonState();
                    };
                }
            } else {
                 // Trata caso onde uploadData é nulo ou não tem fileId
                 throw new Error(uploadData?.error || 'Falha no upload (sem ID).');
            }
        } catch (error) {
             console.error(`Erro upload ${file.name}:`, error);
             displayUploadError(card, error.message || 'Falha Upload');
             // A linha abaixo já está em displayUploadError
             // session.files.set(card, { status: 'error' });
        } finally {
             updateMergeButtonState(); // Garante que o botão principal é atualizado
        }
    };

    const updateMergeButtonState = () => {
        if (!sessionData || !button || !sessionData.files) return;
        const filesReady = Array.from(sessionData.files.values()).filter(f => f.status === 'uploaded').length;
        button.disabled = filesReady < 2;
    };

    button.addEventListener('click', async () => {
        clearStatus(statusEl);
        if (!sessionData || !previewArea || !sessionData.files) return;

        const orderedCards = Array.from(previewArea.children);
        const orderedFileIds = orderedCards
            .map(card => sessionData.files.get(card)?.serverId)
            .filter(id => id); // Garante que só IDs válidos sejam enviados

        if (orderedFileIds.length < 2) {
            showStatus(statusEl, 'São necessários pelo menos 2 arquivos válidos para unir.', 'error');
            return;
        }

        const currentSessionId = sessionData.sessionId; // Guarda o ID antes de resetar

        showStatus(statusEl, 'Iniciando a união...', 'processing');
        button.disabled = true;
        addButtonLabel.classList.add('hidden');
        input.disabled = true;

        try {
            const response = await fetch(`/session/execute/${currentSessionId}`, { // Usa o ID guardado
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: toolId, files: orderedFileIds })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido.' }));
                throw new Error(errorData.error || `Erro ${response.status}.`);
            }

            // Limpa a UI e o estado local APÓS iniciar o job com sucesso
            previewArea.innerHTML = '';
            sessionData = null;
            updateMergeButtonState();

            // Inicia o polling com o ID da sessão que acabou de ser usada
            pollJobStatus(currentSessionId, statusEl, button, addButtonLabel, input);

        } catch (error) {
            console.error("Erro ao executar união:", error);
            showStatus(statusEl, `Erro: ${error.message}`, 'error');
            // Reabilita controles em caso de falha ao iniciar
            button.disabled = false; // Pode precisar reavaliar com base em orderedFileIds.length >= 2
            addButtonLabel.classList.remove('hidden');
            input.disabled = false;
        }
    });
} // Fim de setupUnirPdfTool