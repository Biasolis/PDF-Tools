document.addEventListener('DOMContentLoaded', () => {
    
    // =================================================================================
    // 1. INICIALIZAÇÃO DAS FERRAMENTAS
    // =================================================================================

    setupUnirPdfTool();
    
    // Ferramentas de Arquivo Único (Async)
    setupSimpleAsyncTool('comprimir-pdf');
    setupSimpleAsyncTool('docx-para-pdf');
    // setupSimpleAsyncTool('pdf-para-pdfa'); // Removido (Link Externo)
    setupSimpleAsyncTool('pdf-para-jpg');
    setupSimpleAsyncTool('separar-pdf');
    
    // Ferramentas de Múltiplos Arquivos (Async)
    setupMultiFileAsyncTool('jpg-para-pdf');
    setupMultiFileAsyncTool('png-para-pdf');
    
    // Ferramentas Síncronas (Rápida)
    setupSimpleSyncTool('pdf-para-docx');

    // Ativa Drag and Drop Global
    enableCardDragAndDrop();

    // =================================================================================
    // 2. DRAG AND DROP GLOBAL
    // =================================================================================
    function enableCardDragAndDrop() {
        const cards = document.querySelectorAll('.tool-card');
        cards.forEach(card => {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                card.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            });

            ['dragenter', 'dragover'].forEach(eventName => {
                card.addEventListener(eventName, () => card.classList.add('drag-active'));
            });

            ['dragleave', 'drop'].forEach(eventName => {
                card.addEventListener(eventName, () => card.classList.remove('drag-active'));
            });

            card.addEventListener('drop', (e) => {
                const input = card.querySelector('input[type="file"]');
                const dt = e.dataTransfer;
                const files = dt.files;

                if (input && files.length > 0) {
                    input.files = files;
                    input.dispatchEvent(new Event('change')); // Dispara a lógica da ferramenta
                }
            });
        });
    }

    // =================================================================================
    // 3. LÓGICA: MÚLTIPLOS ARQUIVOS (JPG/PNG para PDF)
    // =================================================================================
    function setupMultiFileAsyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!button || !input) return;

        let sessionData = null;
        let uploadedFileIds = [];

        input.addEventListener('change', async () => {
            const files = Array.from(input.files);
            uploadedFileIds = []; // Reset
            
            if (files.length === 0) {
                showStatus(statusEl, 'Nenhum arquivo selecionado.', 'error');
                button.disabled = true;
                return;
            }

            button.disabled = true;
            input.disabled = true;
            showStatus(statusEl, 'Iniciando sessão...', 'processing');

            if (!sessionData) {
                sessionData = await startNewSession(statusEl);
                if (!sessionData) {
                    button.disabled = false;
                    input.disabled = false;
                    return;
                }
            }
            
            showStatus(statusEl, `Enviando ${files.length} arquivos...`, 'processing');
            
            // Upload em paralelo
            const uploadPromises = files.map(file => uploadSingleFile(sessionData.sessionId, file));
            const results = await Promise.all(uploadPromises);
            
            uploadedFileIds = results.filter(r => r && r.fileId).map(r => r.fileId);

            input.disabled = false;
            
            if (uploadedFileIds.length === files.length) {
                showStatus(statusEl, `${files.length} arquivos prontos. Clique em Criar PDF.`, 'success');
                button.disabled = false;
            } else {
                showStatus(statusEl, `Erro no upload de ${files.length - uploadedFileIds.length} arquivo(s).`, 'error');
                button.disabled = true; 
            }
        });

        button.addEventListener('click', async () => {
            if (uploadedFileIds.length === 0) {
                showStatus(statusEl, 'Nenhum arquivo pronto.', 'error'); return;
            }
            button.disabled = true;
            input.disabled = true;
            showStatus(statusEl, 'Gerando PDF...', 'processing');

            try {
                const executeResponse = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolId, files: uploadedFileIds })
                });

                if (!executeResponse.ok) {
                    throw new Error((await executeResponse.json()).error || 'Falha ao iniciar.');
                }
                
                pollJobStatus(sessionData.sessionId, statusEl, button, input);
                sessionData = null; 
                uploadedFileIds = [];
            } catch (error) {
                showStatus(statusEl, error.message, 'error');
                button.disabled = false;
                input.disabled = false;
            }
        });
    }

    // =================================================================================
    // 4. LÓGICA: UNIR PDF (Customizada com Preview)
    // =================================================================================
    function setupUnirPdfTool() {
        const toolId = 'unir-pdf';
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const previewArea = document.getElementById('pdf-preview-area');
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!input) return;

        let sessionData = null;
        if(typeof Sortable !== 'undefined') {
            new Sortable(previewArea, { animation: 150 });
        }

        input.addEventListener('change', async (event) => {
            if (!sessionData) sessionData = await startNewSession(statusEl);
            if (!sessionData) return;
            
            const files = Array.from(event.target.files);
            input.disabled = true;

            for (const file of files) {
                const card = createPreviewCard(file);
                previewArea.appendChild(card);
                await uploadFileWithCard(sessionData.sessionId, file, card);
            }
            input.disabled = false;
            updateUnirButtonState();
            event.target.value = ''; 
        });

        function createPreviewCard(file) {
            const div = document.createElement('div');
            div.className = 'preview-card';
            div.innerHTML = `<canvas></canvas><p>${file.name}</p><button class="delete-btn" title="Remover">&times;</button>`;
            
            if (window.pdfjsLib) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const typedarray = new Uint8Array(e.target.result);
                        const pdf = await pdfjsLib.getDocument(typedarray).promise;
                        const page = await pdf.getPage(1);
                        const canvas = div.querySelector('canvas');
                        const viewport = page.getViewport({ scale: 0.5 });
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                    } catch(err) {}
                };
                reader.readAsArrayBuffer(file);
            }

            div.querySelector('.delete-btn').onclick = (e) => {
                e.stopPropagation();
                div.remove();
                sessionData.files.delete(div);
                updateUnirButtonState();
            };
            sessionData.files.set(div, { status: 'uploading', serverId: null });
            return div;
        }

        async function uploadFileWithCard(sessionId, file, card) {
            const formData = new FormData();
            formData.append('file', file);
            try {
                const res = await fetch(`/session/upload/${sessionId}`, { method: 'POST', body: formData });
                if(!res.ok) throw new Error();
                const data = await res.json();
                sessionData.files.get(card).serverId = data.fileId;
                sessionData.files.get(card).status = 'uploaded';
            } catch (e) {
                card.style.border = '1px solid red';
                sessionData.files.get(card).status = 'error';
            }
            updateUnirButtonState();
        }

        function updateUnirButtonState() {
            const ready = Array.from(sessionData.files.values()).filter(f => f.status === 'uploaded').length;
            button.disabled = ready < 2;
        }

        button.addEventListener('click', async () => {
            const orderedIds = Array.from(previewArea.children)
                .map(card => sessionData.files.get(card)?.serverId)
                .filter(id => id);
            
            showStatus(statusEl, 'Unindo arquivos...', 'processing');
            button.disabled = true;

            try {
                const res = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ tool: toolId, files: orderedIds })
                });
                if(!res.ok) throw new Error((await res.json()).error || 'Falha');
                pollJobStatus(sessionData.sessionId, statusEl, button);
            } catch(e) {
                showStatus(statusEl, e.message || 'Erro ao iniciar.', 'error');
                button.disabled = false;
            }
        });
    }

    // =================================================================================
    // 5. LÓGICA: FERRAMENTAS SIMPLES (1 ARQUIVO)
    // =================================================================================
    function setupSimpleAsyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if(!input) return;

        input.addEventListener('change', () => {
             if (input.files.length > 0) {
                 showStatus(statusEl, `Arquivo selecionado: ${input.files[0].name}`, 'info');
             }
        });

        button.addEventListener('click', async () => {
            if(!input.files.length) return showStatus(statusEl, 'Selecione um arquivo.', 'error');
            
            button.disabled = true;
            showStatus(statusEl, 'Enviando...', 'processing');
            
            const session = await startNewSession(statusEl);
            if (!session) { button.disabled = false; return; }

            const formData = new FormData();
            formData.append('file', input.files[0]);
            
            try {
                const upRes = await fetch(`/session/upload/${session.sessionId}`, { method: 'POST', body: formData });
                if(!upRes.ok) throw new Error('Falha no upload');
                const upData = await upRes.json();

                const execRes = await fetch(`/session/execute/${session.sessionId}`, {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ tool: toolId, files: [upData.fileId] })
                });
                if(!execRes.ok) throw new Error('Falha na execução');
                
                showStatus(statusEl, 'Processando...', 'processing');
                pollJobStatus(session.sessionId, statusEl, button);
            } catch(e) {
                showStatus(statusEl, e.message, 'error');
                button.disabled = false;
            }
        });
    }
    
    // =================================================================================
    // 6. LÓGICA SÍNCRONA (PDF -> DOCX)
    // =================================================================================
    function setupSimpleSyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if(!input) return;

        input.addEventListener('change', () => {
             if (input.files.length > 0) {
                 showStatus(statusEl, `Arquivo selecionado: ${input.files[0].name}`, 'info');
             }
        });

        button.addEventListener('click', async () => {
            if(!input.files.length) return showStatus(statusEl, 'Selecione um arquivo.', 'error');
            
            button.disabled = true;
            showStatus(statusEl, 'Convertendo (Aguarde)...', 'processing');
            
            const fd = new FormData();
            fd.append('file', input.files[0]);
            
            try {
                const res = await fetch(`/${toolId}`, { method: 'POST', body: fd });
                if(!res.ok) throw new Error();
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                createDownloadLink(url, 'documento-convertido.doc', statusEl);
                button.disabled = false;
            } catch(e) {
                showStatus(statusEl, 'Erro na conversão.', 'error');
                button.disabled = false;
            }
        });
    }

    // =================================================================================
    // 7. FUNÇÕES AUXILIARES (HELPERS)
    // =================================================================================

    async function startNewSession(statusEl) {
        try {
            const r = await fetch('/session/create', { method: 'POST' });
            if(!r.ok) throw new Error();
            return { sessionId: (await r.json()).sessionId, files: new Map() };
        } catch(e) {
            showStatus(statusEl, 'Erro de conexão.', 'error');
            return null;
        }
    }

    async function uploadSingleFile(sessionId, file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const response = await fetch(`/session/upload/${sessionId}`, { method: 'POST', body: formData });
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    function pollJobStatus(sessionId, statusEl, button, input = null) {
        const interval = setInterval(async () => {
            try {
                const r = await fetch(`/session/status/${sessionId}`);
                if(!r.ok) return;
                const d = await r.json();
                if (d.status === 'complete') {
                    clearInterval(interval);
                    button.disabled = false;
                    if(input) input.disabled = false;
                    createDownloadLink(d.downloadUrl, d.downloadUrl.split('/').pop(), statusEl);
                } else if (d.status === 'error') {
                    clearInterval(interval);
                    button.disabled = false;
                    if(input) input.disabled = false;
                    showStatus(statusEl, d.message, 'error');
                }
            } catch(e) { 
                clearInterval(interval); 
                button.disabled = false; 
                if(input) input.disabled = false;
            }
        }, 2000);
    }

    // --- CORREÇÃO PRINCIPAL: Padronização do nome da função ---
    function showStatus(el, msg, type) {
        el.innerHTML = '';
        if(type === 'processing') el.innerHTML = `<div class="loader"></div> <span class="status-info">${msg}</span>`;
        else if (type === 'error') el.innerHTML = `<span class="status-error">${msg}</span>`;
        else if (type === 'success') el.innerHTML = `<span class="status-success">${msg}</span>`;
        else el.innerHTML = `<span class="status-info">${msg}</span>`;
    }

    function createDownloadLink(url, fileName, element) {
        element.innerHTML = '';
        
        const msg = document.createElement('div');
        msg.className = 'status-success';
        msg.style.marginBottom = '5px';
        msg.textContent = 'Concluído!';
        element.appendChild(msg);

        const link = document.createElement('a');
        link.href = url; 
        link.download = fileName;
        link.className = 'btn-action btn-green'; 
        link.style.display = 'inline-block'; 
        link.style.width = 'auto'; 
        link.style.textDecoration = 'none';
        link.textContent = `Baixar Arquivo`;
        element.appendChild(link);
    }
});