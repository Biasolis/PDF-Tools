// Arquivo: public/js/main.js (Seção de Unir PDFs Atualizada)

// --- LÓGICA ROBUSTA PARA UNIR PDFS ---
const unirPdfInput = document.getElementById('unir-pdf-input');
const unirPdfButton = document.getElementById('unir-pdf-button');
const previewArea = document.getElementById('pdf-preview-area');
const unirPdfStatus = document.getElementById('unir-pdf-status');
const unirPdfAddButtonLabel = document.querySelector('label[for="unir-pdf-input"]');

let uploadedFiles = new Map(); // Mapa para associar elementos DOM a informações de arquivo

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;
}

const sortable = new Sortable(previewArea, { animation: 150, ghostClass: 'sortable-ghost' });

unirPdfInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    unirPdfInput.disabled = true;
    unirPdfAddButtonLabel.textContent = "Enviando...";

    for (const file of files) {
        if (file.type === "application/pdf") {
            const card = await generatePreviewCard(file);
            await uploadFile(file, card);
        }
    }
    
    unirPdfInput.disabled = false;
    unirPdfAddButtonLabel.textContent = "Adicionar Arquivos";
    updateMergeButtonState();
    event.target.value = '';
});

const generatePreviewCard = async (file) => {
    const card = document.createElement('div');
    card.className = 'relative group bg-gray-100 p-2 rounded-lg shadow-sm cursor-grab';
    card.innerHTML = `
        <div class="absolute inset-0 bg-blue-200 rounded-lg" style="width: 0%; transition: width 0.3s;"></div>
        <div class="relative">
            <canvas class="w-full h-auto rounded bg-white"></canvas>
            <p class="text-xs text-center truncate mt-1">${file.name}</p>
            <button class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hidden">&times;</button>
        </div>
    `;
    previewArea.appendChild(card);
    uploadedFiles.set(card, { file: file, serverId: null, status: 'rendering' });

    // Renderiza a thumbnail
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
        } catch (error) { /* ... */ }
    };
    fileReader.readAsArrayBuffer(file);
    return card;
};

const uploadFile = async (file, card) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await fetch('/upload-chunk', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Falha no upload.');

        // Atualiza o card para "enviado"
        card.querySelector('.absolute.inset-0').style.width = '100%';
        uploadedFiles.get(card).serverId = data.fileId;
        uploadedFiles.get(card).status = 'uploaded';
        card.querySelector('button').classList.remove('hidden');
    } catch (error) {
        card.innerHTML += `<div class="absolute inset-0 bg-red-100 flex items-center justify-center"><p class="text-xs text-red-700 text-center">Falha no Upload</p></div>`;
        uploadedFiles.get(card).status = 'error';
    }
};

const updateMergeButtonState = () => {
    const filesReady = Array.from(uploadedFiles.values()).filter(f => f.status === 'uploaded').length;
    unirPdfButton.disabled = filesReady < 2;
};

// Listener para o botão de iniciar a união
unirPdfButton.addEventListener('click', async () => {
    const orderedCards = Array.from(previewArea.children);
    const orderedFileIds = orderedCards.map(card => uploadedFiles.get(card)?.serverId).filter(id => id);

    if (orderedFileIds.length < 2) {
        showStatus(unirPdfStatus, 'Arquivos insuficientes ou com erro de upload.', 'error');
        return;
    }

    showStatus(unirPdfStatus, 'Iniciando a união no servidor...', 'loading');
    unirPdfButton.disabled = true;
    unirPdfAddButtonLabel.classList.add('hidden');

    try {
        const response = await fetch('/start-merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderedFileIds: orderedFileIds })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        // Inicia a verificação de status
        pollJobStatus(data.jobId);
    } catch (error) {
        showStatus(unirPdfStatus, `Erro: ${error.message}`, 'error');
        unirPdfButton.disabled = false;
        unirPdfAddButtonLabel.classList.remove('hidden');
    }
});

const pollJobStatus = (jobId) => {
    const interval = setInterval(async () => {
        try {
            const response = await fetch(`/merge-status/${jobId}`);
            const data = await response.json();
            
            if (data.status === 'processing') {
                showStatus(unirPdfStatus, 'Servidor está unindo os arquivos...', 'loading');
            } else if (data.status === 'complete') {
                clearInterval(interval);
                unirPdfStatus.innerHTML = ''; // Limpa status de processando
                createDownloadLinkFromUrl(data.downloadUrl, 'pdf-unido.pdf', unirPdfStatus);
                // Reset UI
                previewArea.innerHTML = '';
                uploadedFiles.clear();
                unirPdfAddButtonLabel.classList.remove('hidden');
            } else if (data.status === 'error') {
                clearInterval(interval);
                showStatus(unirPdfStatus, `Erro no servidor: ${data.message}`, 'error');
                unirPdfButton.disabled = false;
                unirPdfAddButtonLabel.classList.remove('hidden');
            }
        } catch (error) {
            clearInterval(interval);
            showStatus(unirPdfStatus, 'Erro ao verificar o status.', 'error');
            unirPdfButton.disabled = false;
            unirPdfAddButtonLabel.classList.remove('hidden');
        }
    }, 3000); // Verifica a cada 3 segundos
};

function createDownloadLinkFromUrl(url, fileName, element) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.className = 'mt-4 inline-block bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-full transition-all duration-300';
    link.textContent = `Baixar ${fileName}`;
    element.innerHTML = '';
    element.appendChild(link);
}
// ... As outras funções (setupSimpleTool, etc.) e as funções de ajuda (showStatus, etc.) continuam aqui