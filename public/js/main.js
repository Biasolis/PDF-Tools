document.addEventListener('DOMContentLoaded', () => {
    // --- LÓGICA AVANÇADA PARA UNIR PDFS ---
    const unirPdfInput = document.getElementById('unir-pdf-input');
    const unirPdfButton = document.getElementById('unir-pdf-button');
    const previewArea = document.getElementById('pdf-preview-area');
    const unirPdfStatus = document.getElementById('unir-pdf-status');
    
    let uploadedFiles = []; // Array que mantém os arquivos na ordem correta

    // Configura o worker do PDF.js, se a biblioteca estiver carregada
    if (window.pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;
    }

    // Inicializa a funcionalidade de arrastar e soltar (drag-and-drop)
    const sortable = new Sortable(previewArea, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: (evt) => {
            // Atualiza a ordem do nosso array de arquivos para corresponder à nova ordem visual
            const movedFile = uploadedFiles.splice(evt.oldIndex, 1)[0];
            uploadedFiles.splice(evt.newIndex, 0, movedFile);
        }
    });

    // Listener para quando arquivos são selecionados
    unirPdfInput.addEventListener('change', (event) => {
        const files = Array.from(event.target.files);
        files.forEach(file => {
            if (file.type === "application/pdf") {
                const fileIdentifier = `${file.name}-${file.lastModified}`;
                // Evita adicionar o mesmo arquivo duas vezes
                if (!uploadedFiles.some(f => `${f.name}-${f.lastModified}` === fileIdentifier)) {
                    uploadedFiles.push(file);
                    generatePreviewCard(file);
                }
            }
        });
        updateMergeButtonState();
        event.target.value = ''; // Limpa o input para permitir selecionar o mesmo arquivo novamente
    });

    // Função para gerar o card de pré-visualização
    const generatePreviewCard = async (file) => {
        const fileReader = new FileReader();
        fileReader.onload = async (e) => {
            const card = document.createElement('div');
            card.className = 'relative group bg-gray-100 p-2 rounded-lg shadow-sm cursor-grab';
            
            const fileIdentifier = `${file.name}-${file.lastModified}`;
            card.dataset.identifier = fileIdentifier;

            card.innerHTML = `
                <canvas class="w-full h-auto rounded bg-white"></canvas>
                <p class="text-xs text-center truncate mt-1">${file.name}</p>
                <button class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
            `;
            previewArea.appendChild(card);

            // Botão de deletar
            card.querySelector('button').addEventListener('click', () => {
                const indexToRemove = uploadedFiles.findIndex(f => `${f.name}-${f.lastModified}` === fileIdentifier);
                if (indexToRemove > -1) {
                    uploadedFiles.splice(indexToRemove, 1);
                    card.remove();
                    updateMergeButtonState();
                }
            });

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
                console.error("Erro ao renderizar PDF:", error);
                card.innerHTML += `<div class="absolute inset-0 bg-red-100 flex items-center justify-center"><p class="text-xs text-red-700 text-center">Erro ao ler PDF</p></div>`;
            }
        };
        fileReader.readAsArrayBuffer(file);
    };
    
    const updateMergeButtonState = () => {
        unirPdfButton.disabled = uploadedFiles.length < 2;
    };

    // Listener para o botão principal de unir
    unirPdfButton.addEventListener('click', async () => {
        const formData = new FormData();
        
        // CORREÇÃO FINAL: Envia cada arquivo com uma chave única e ordenada (file-0, file-1, etc.)
        uploadedFiles.forEach((file, index) => {
            formData.append(`file-${index}`, file);
        });

        showStatus(unirPdfStatus, 'Enviando e unindo os arquivos...', 'loading');
        unirPdfButton.disabled = true;

        try {
            const response = await fetch('/unir-pdf', { method: 'POST', body: formData });
            if (!response.ok) throw new Error((await response.json()).error || 'Erro no servidor.');
            const blob = await response.blob();
            createDownloadLink(blob, 'pdf-unido.pdf', 'application/pdf', unirPdfStatus);
        } catch (error) {
            showStatus(unirPdfStatus, `Falha ao unir: ${error.message}`, 'error');
        } finally {
            unirPdfButton.disabled = false;
        }
    });
    
    // --- LÓGICA SIMPLIFICADA PARA AS OUTRAS FERRAMENTAS ---
    const setupSimpleTool = (toolId, endpoint) => {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const status = document.getElementById(`${toolId}-status`);
        
        if (!button || !input) return;

        button.addEventListener('click', async () => {
            if (input.files.length === 0) {
                showStatus(status, 'Por favor, selecione um arquivo.', 'error'); return;
            }
            const file = input.files[0];
            const formData = new FormData();
            formData.append('file', file);
            
            showStatus(status, 'Processando...', 'loading');
            button.disabled = true;

            try {
                const response = await fetch(endpoint, { method: 'POST', body: formData });
                if (!response.ok) throw new Error((await response.json()).error || 'Erro no servidor.');
                
                const blob = await response.blob();
                const disposition = response.headers.get('content-disposition');
                let fileName = `${toolId}-resultado.bin`; // Nome padrão
                if (disposition && disposition.indexOf('attachment') !== -1) {
                    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                    const matches = filenameRegex.exec(disposition);
                    if (matches != null && matches[1]) {
                        fileName = matches[1].replace(/['"]/g, '');
                    }
                }

                createDownloadLink(blob, fileName, blob.type, status);
            } catch (error) {
                showStatus(status, `Falha: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
            }
        });
    };

    // Configura as outras 4 ferramentas
    setupSimpleTool('comprimir-pdf', '/comprimir-pdf');
    setupSimpleTool('docx-para-pdf', '/docx-para-pdf');
    setupSimpleTool('pdf-para-docx', '/pdf-para-docx');
    setupSimpleTool('pdf-para-pdfa', '/pdf-para-pdfa');
    
    // Funções de Ajuda
    function showStatus(element, message, type) {
        if (!element) return;
        element.innerHTML = '';
        const statusDiv = document.createElement('div');
        let textColor = 'text-gray-700';
        if (type === 'success') textColor = 'text-green-600';
        if (type === 'error') textColor = 'text-red-600';

        if (type === 'loading') {
            const loader = document.createElement('div');
            loader.className = 'loader inline-block mr-2';
            statusDiv.appendChild(loader);
        }
        
        const textNode = document.createElement('span');
        textNode.className = `align-middle ${textColor}`;
        textNode.textContent = message;
        statusDiv.appendChild(textNode);
        
        element.appendChild(statusDiv);
    }

    function createDownloadLink(data, fileName, mimeType, element) {
        const blob = new Blob([data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.className = 'mt-4 inline-block bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-full transition-all duration-300';
        link.textContent = `Baixar ${fileName}`;
        
        element.innerHTML = '';
        element.appendChild(link);

        link.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 100);
    }
});