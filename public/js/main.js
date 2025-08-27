document.addEventListener('DOMContentLoaded', () => {
    // Helper para simplificar a criação de listeners para cada ferramenta
    const setupTool = (toolId) => {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const status = document.getElementById(`${toolId}-status`);
        
        if (!button) return; // Se o botão não existir, não faz nada

        button.addEventListener('click', async () => {
            const files = input.files;
            if (files.length === 0) {
                showStatus(status, 'Por favor, selecione um arquivo.', 'error');
                return;
            }
            
            const formData = new FormData();
            
            // A URL do endpoint é o ID da ferramenta, ex: /unir-pdf
            const endpoint = `/${toolId}`;

            // Lida com múltiplos arquivos para a ferramenta de unir
            if (input.multiple) {
                 if (files.length < 2) {
                    showStatus(status, 'Selecione pelo menos 2 arquivos.', 'error');
                    return;
                }
                for (const file of files) formData.append('files', file);
            } else {
                formData.append('file', files[0]);
            }
            
            showStatus(status, 'Processando...', 'loading');
            button.disabled = true;

            try {
                const response = await fetch(endpoint, { method: 'POST', body: formData });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Ocorreu um erro no servidor.');
                }
                
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

    // Configura todas as 5 ferramentas
    setupTool('unir-pdf');
    setupTool('comprimir-pdf');
    setupTool('docx-para-pdf');
    setupTool('pdf-para-docx');
    setupTool('pdf-para-pdfa');

    // Funções de Ajuda (showStatus, createDownloadLink)
    function showStatus(element, message, type) {
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