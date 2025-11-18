document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // SETUP DAS FERRAMENTAS
    // =================================================================================

    setupUnirPdfTool();
    setupSimpleAsyncTool('comprimir-pdf');
    setupSimpleAsyncTool('docx-para-pdf');
    setupSimpleAsyncTool('pdf-para-pdfa');
    setupSimpleAsyncTool('pdf-para-jpg');
    setupSimpleAsyncTool('separar-pdf');
    setupMultiFileAsyncTool('jpg-para-pdf');
    // setupMultiFileAsyncTool('png-para-pdf'); // Se existir no HTML
    setupSimpleSyncTool('pdf-para-docx');

    // =================================================================================
    // LÓGICA: UNIR PDF
    // =================================================================================
    function setupUnirPdfTool() {
        const toolId = 'unir-pdf';
        const cardEl = document.getElementById(`${toolId}-card`);
        if (!cardEl) return;

        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const previewArea = document.getElementById('pdf-preview-area');
        const statusEl = document.getElementById(`${toolId}-status`);
        const addButtonLabel = cardEl.querySelector('label');
        let sessionData = null;

        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;
        }
        new Sortable(previewArea, { animation: 150, ghostClass: 'sortable-ghost' });

        input.addEventListener('change', async (event) => {
            if (!sessionData) {
                sessionData = await startNewSession(statusEl);
                if (!sessionData) return;
            }
            const files = Array.from(event.target.files);
            input.disabled = true;
            addButtonLabel.classList.add('cursor-not-allowed');

            for (const file of files) {
                const card = generatePreviewCard(file);
                await uploadAndTrackFile(sessionData, file, card);
            }
            
            input.disabled = false;
            addButtonLabel.classList.remove('cursor-not-allowed');
            updateMergeButtonState();
            event.target.value = '';
        });

        const generatePreviewCard = (file) => {
            const card = document.createElement('div');
            card.className = 'preview-card'; // Classe CSS pura
            card.innerHTML = `
                <div class="absolute inset-0 rounded-lg progress-bar" style="background-color: rgba(37, 99, 235, 0.2); width: 0%; transition: width 0.3s; position: absolute; top:0; left:0; height:100%; z-index:0;"></div>
                <div style="position: relative; z-index: 1;">
                    <canvas></canvas>
                    <p>${file.name}</p>
                    <button class="delete-btn hidden">&times;</button>
                </div>
            `;
            previewArea.appendChild(card);
            
            const fileReader = new FileReader();
            fileReader.onload = async (e) => {
                try {
                    const typedarray = new Uint8Array(e.target.result);
                    const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
                    const page = await pdf.getPage(1);
                    const canvas = card.querySelector('canvas');
                    const context = canvas.getContext('2d');
                    const viewport = page.getViewport({ scale: 0.5 });
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                } catch (error) {
                    // Fallback visual
                    card.innerHTML += `<p style="color:red; font-size:10px;">Erro PDF</p>`;
                }
            };
            fileReader.readAsArrayBuffer(file);
            return card;
        };
        
        const uploadAndTrackFile = async (session, file, card) => {
            session.files.set(card, { originalName: file.name, serverId: null, status: 'uploading' });
            
            // Atualiza barra de progresso interna do card (opcional)
            // const progressBar = card.querySelector('.progress-bar');
            
            const uploadData = await uploadFileWithProgress(session.sessionId, file, (percent) => {
                // progressBar.style.width = `${percent}%`;
            });

            if (uploadData && uploadData.fileId) {
                session.files.get(card).serverId = uploadData.fileId;
                session.files.get(card).status = 'uploaded';
                const deleteBtn = card.querySelector('.delete-btn');
                deleteBtn.classList.remove('hidden');
                deleteBtn.addEventListener('click', () => {
                    card.remove();
                    session.files.delete(card);
                    updateMergeButtonState();
                });
            } else {
                session.files.get(card).status = 'error';
            }
        };

        const updateMergeButtonState = () => {
            if (!sessionData) return;
            const filesReady = Array.from(sessionData.files.values()).filter(f => f.status === 'uploaded').length;
            button.disabled = filesReady < 2;
        };

        button.addEventListener('click', async () => {
            const orderedCards = Array.from(previewArea.children);
            const orderedFileIds = orderedCards.map(card => sessionData.files.get(card)?.serverId).filter(id => id);
            
            showStatus(statusEl, 'Iniciando a união...', 'processing');
            button.disabled = true;
            addButtonLabel.classList.add('hidden');
            input.disabled = true;

            try {
                const response = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolId, files: orderedFileIds })
                });
                if (!response.ok) throw new Error((await response.json()).error || 'Falha ao iniciar a tarefa.');
                pollJobStatus(sessionData.sessionId, statusEl, button, addButtonLabel, input);
            } catch (error) {
                showStatus(statusEl, `Erro: ${error.message}`, 'error');
                button.disabled = false;
                addButtonLabel.classList.remove('hidden');
                input.disabled = false;
            }
        });
    }

    // =================================================================================
    // FERRAMENTAS GENÉRICAS
    // =================================================================================

    function setupMultiFileAsyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!button || !input) return;

        let sessionData = null;
        let uploadedFileIds = [];

        input.addEventListener('change', async () => {
            if (!sessionData) {
                sessionData = await startNewSession(statusEl);
                if (!sessionData) return;
            }
            
            const files = Array.from(input.files);
            input.disabled = true;
            button.disabled = true;

            showStatus(statusEl, `Enviando ${files.length} arquivos...`, 'progress', 5);
            
            const uploadPromises = files.map(file => uploadSingleFile(sessionData.sessionId, file));
            const results = await Promise.all(uploadPromises);
            
            uploadedFileIds = results.filter(r => r && r.fileId).map(r => r.fileId);

            input.disabled = false;
            button.disabled = false;
            if(uploadedFileIds.length === files.length) {
                showStatus(statusEl, `${files.length} arquivos prontos. Clique para converter.`, 'success');
            } else {
                showStatus(statusEl, `Erro no upload de ${files.length - uploadedFileIds.length} arquivos.`, 'error');
            }
        });

        button.addEventListener('click', async () => {
            if (uploadedFileIds.length === 0) {
                showStatus(statusEl, 'Selecione pelo menos um arquivo.', 'error'); return;
            }
            button.disabled = true;
            input.disabled = true;
            showStatus(statusEl, 'Iniciando processamento...', 'processing');

            try {
                const executeResponse = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolId, files: uploadedFileIds })
                });

                if (!executeResponse.ok) throw new Error((await executeResponse.json()).error || 'Falha ao iniciar.');
                pollJobStatus(sessionData.sessionId, statusEl, button, null, input);
                sessionData = null; 
                uploadedFileIds = [];
            } catch (error) {
                showStatus(statusEl, error.message, 'error');
                button.disabled = false;
                input.disabled = false;
            }
        });
    }

    function setupSimpleAsyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!button || !input) return;

        button.addEventListener('click', async () => {
            if (input.files.length === 0) { showStatus(statusEl, 'Selecione um arquivo.', 'error'); return; }
            const file = input.files[0];
            button.disabled = true;
            input.disabled = true;

            showStatus(statusEl, 'Iniciando...', 'info');
            const sessionData = await startNewSession(statusEl);
            if (!sessionData) { button.disabled = false; input.disabled = false; return; }

            await uploadFileWithProgress(sessionData.sessionId, file, (percent) => {
                showStatus(statusEl, `Enviando: ${Math.round(percent)}%`, 'progress', percent);
            }).then(async (uploadData) => {
                showStatus(statusEl, 'Processando...', 'processing');
                const executeResponse = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolId, files: [uploadData.fileId] })
                });
                if (!executeResponse.ok) throw new Error((await executeResponse.json()).error);
                pollJobStatus(sessionData.sessionId, statusEl, button, null, input);
            }).catch(err => {
                showStatus(statusEl, 'Falha no upload.', 'error');
                button.disabled = false;
                input.disabled = false;
            });
        });
    }
    
    function setupSimpleSyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!button || !input) return;
        
        button.addEventListener('click', async () => {
            if (input.files.length === 0) { showStatus(statusEl, 'Selecione um arquivo.', 'error'); return; }
            const file = input.files[0];
            button.disabled = true;
            input.disabled = true;

            const formData = new FormData();
            formData.append('file', file);
            showStatus(statusEl, 'Processando...', 'processing');
            try {
                const response = await fetch(`/${toolId}`, { method: 'POST', body: formData });
                if (!response.ok) throw new Error((await response.json()).error);
                const blob = await response.blob();
                const disposition = response.headers.get('content-disposition');
                const fileName = disposition ? disposition.split('filename=')[1].replace(/"/g, '') : `${toolId}-resultado.docx`;
                createDownloadLink(blob, fileName, blob.type, statusEl);
            } catch (e) {
                showStatus(statusEl, `Falha: ${e.message}`, 'error');
            } finally {
                button.disabled = false;
                input.disabled = false;
            }
        });
    }

    // =================================================================================
    // UTILITÁRIOS
    // =================================================================================

    async function startNewSession(statusEl) {
        try {
            const response = await fetch('/session/create', { method: 'POST' });
            if (!response.ok) throw new Error('Falha na sessão.');
            const data = await response.json();
            return { sessionId: data.sessionId, files: new Map() };
        } catch (error) {
            showStatus(statusEl, error.message, 'error');
            return null;
        }
    }
    
    function uploadFileWithProgress(sessionId, file, onProgress) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', file);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/session/upload/${sessionId}`, true);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percent = (event.loaded / event.total) * 100;
                    onProgress(percent);
                }
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
                else reject(new Error('Falha no upload.'));
            };
            xhr.onerror = () => reject(new Error('Erro de rede.'));
            xhr.send(formData);
        });
    }
    
    async function uploadSingleFile(sessionId, file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const response = await fetch(`/session/upload/${sessionId}`, { method: 'POST', body: formData });
            return response.ok ? await response.json() : null;
        } catch (e) { return null; }
    }

    function pollJobStatus(sessionId, statusEl, button, addButtonLabel = null, input = null) {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/session/status/${sessionId}`);
                if (!response.ok) {
                    clearInterval(interval);
                    showStatus(statusEl, 'Erro de conexão.', 'error');
                    resetControls(button, addButtonLabel, input);
                    return;
                }
                const data = await response.json();
                
                if (data.status === 'processing') {
                    showStatus(statusEl, 'Processando...', 'processing');
                } else if (data.status === 'complete') {
                    clearInterval(interval);
                    createDownloadLinkFromUrl(data.downloadUrl, data.downloadUrl.split('/').pop(), statusEl);
                    resetControls(button, addButtonLabel, input);
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    showStatus(statusEl, `Erro: ${data.message}`, 'error');
                    resetControls(button, addButtonLabel, input);
                }
            } catch (e) {
                clearInterval(interval);
                showStatus(statusEl, 'Erro status.', 'error');
                resetControls(button, addButtonLabel, input);
            }
        }, 3000);
    }

    function resetControls(button, label, input) {
        if (button) button.disabled = false;
        if (label) label.classList.remove('hidden', 'cursor-not-allowed');
        if (input) input.disabled = false;
    }
    
    function showStatus(element, message, type, progress = 0) {
        if (!element) return;
        const container = element.querySelector('.progress-container');
        const bar = element.querySelector('.progress-bar');
        const text = element.querySelector('.status-text');

        if (!container || !bar || !text) {
            element.textContent = message; return;
        }

        text.classList.remove('status-error', 'status-success', 'status-info');
        container.style.display = 'none';

        if (type === 'error') {
            text.textContent = message;
            text.classList.add('status-error');
        } else if (type === 'progress') {
            container.style.display = 'block';
            bar.style.width = `${progress}%`;
            text.textContent = message;
            text.classList.add('status-info');
        } else if (type === 'processing') {
            container.style.display = 'block';
            bar.style.width = `100%`;
            text.innerHTML = '<div class="loader"></div> Processando...';
            text.classList.add('status-info');
        } else if (type === 'success') {
            text.textContent = message;
            text.classList.add('status-success');
        } else {
            text.innerHTML = '';
        }
    }

    function createDownloadLink(blob, fileName, mimeType, element) {
        const url = URL.createObjectURL(blob);
        const target = element.querySelector('.status-text') || element;
        createDownloadLinkFromUrl(url, fileName, target);
    }

    function createDownloadLinkFromUrl(url, fileName, element) {
        // Limpa status anterior
        if(element.classList.contains('status-text')) {
             const container = element.parentElement.querySelector('.progress-container');
             if(container) container.style.display = 'none';
        }
        
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        // Classes do nosso CSS novo
        link.className = 'btn-action btn-blue'; 
        link.style.display = 'inline-block';
        link.style.width = 'auto';
        link.style.marginTop = '10px';
        link.style.textDecoration = 'none';
        link.textContent = `Baixar ${fileName}`;
        
        element.innerHTML = '';
        element.appendChild(link);
        
        const msg = document.createElement('div');
        msg.textContent = 'Sucesso!';
        msg.className = 'status-success';
        msg.style.marginBottom = '5px';
        element.prepend(msg);
    }
});