// public/js/main.js
import { setupUnirPdfTool } from './tool-unir-pdf.js';
import { setupSimpleAsyncTool, setupMultiFileAsyncTool, setupSimpleSyncTool } from './tool-setup.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM carregado. Inicializando ferramentas...");

    // Ferramenta customizada com preview e reordenação
    setupUnirPdfTool();

    // Ferramentas assíncronas de arquivo único
    setupSimpleAsyncTool('comprimir-pdf');
    setupSimpleAsyncTool('docx-para-pdf'); // Alta fidelidade via LibreOffice Async
    setupSimpleAsyncTool('pdf-para-pdfa');
    setupSimpleAsyncTool('pdf-para-jpg');
    setupSimpleAsyncTool('separar-pdf');
    setupSimpleAsyncTool('excel-para-pdf');
    setupSimpleAsyncTool('pdf-para-excel');
    setupSimpleAsyncTool('pdf-para-docx'); // Alias para alta fidelidade
    setupSimpleAsyncTool('proteger-pdf'); // <-- NOVO

    // Ferramentas assíncronas de múltiplos arquivos
    setupMultiFileAsyncTool('jpg-para-pdf');
    setupMultiFileAsyncTool('png-para-pdf');

    // Ferramenta síncrona (rápida) - Para Extração Simples de Texto
    // Descomente a linha abaixo E o card no index.ejs se quiser habilitar
    // setupSimpleSyncTool('pdf-para-docx-simple');

    console.log("Ferramentas inicializadas.");
});