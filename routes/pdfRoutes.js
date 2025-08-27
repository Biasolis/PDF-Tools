// Arquivo: routes/pdfRoutes.js
// Data da Geração: 27 de agosto de 2025

const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configura o multer para receber os uploads de arquivos em memória
const upload = multer({ storage: multer.memoryStorage() });

// Rota principal: renderiza a página inicial (index.ejs)
router.get('/', (req, res) => {
    res.render('index', { title: 'Ferramenta PDF & DOCX Completa' });
});

// Rota para Unir PDFs
router.post('/unir-pdf', upload.any(), async (req, res) => {
    if (!req.files || req.files.length < 2) {
        return res.status(400).json({ error: 'Envie pelo menos dois arquivos.' });
    }
    try {
        const sortedFiles = req.files.sort((a, b) => {
            const indexA = parseInt(a.fieldname.split('-')[1], 10);
            const indexB = parseInt(b.fieldname.split('-')[1], 10);
            return indexA - indexB;
        });
        const mergedPdf = await PDFDocument.create();
        for (const file of sortedFiles) {
            const pdfToMerge = await PDFDocument.load(file.buffer);
            const copiedPages = await mergedPdf.copyPages(pdfToMerge, pdfToMerge.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
        const mergedPdfBytes = await mergedPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=pdf-unido.pdf');
        res.send(Buffer.from(mergedPdfBytes));
    } catch (error) {
        console.error('Servidor: Erro ao unir PDFs:', error);
        res.status(500).json({ error: 'Ocorreu um erro interno ao unir os arquivos.' });
    }
});

// Rota para Comprimir PDF
router.post('/comprimir-pdf', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    const tempInputPath = path.join(__dirname, `temp_input_${Date.now()}.pdf`);
    const tempOutputPath = path.join(__dirname, `temp_output_${Date.now()}.pdf`);
    fs.writeFileSync(tempInputPath, req.file.buffer);
    const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${tempOutputPath} ${tempInputPath}`;
    exec(command, (error) => {
        fs.unlinkSync(tempInputPath);
        if (error) {
            console.error('Erro do Ghostscript:', error);
            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
            return res.status(500).json({ error: 'Erro ao comprimir o PDF.' });
        }
        const pdfBuffer = fs.readFileSync(tempOutputPath);
        fs.unlinkSync(tempOutputPath);
        const compressedFileName = req.file.originalname.replace(/\.pdf$/, '_comprimido.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${compressedFileName}`);
        res.send(pdfBuffer);
    });
});

// Rota para Converter DOCX para PDF (Versão Final e Mais Robusta)
router.post('/docx-para-pdf', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    let browser = null;
    // [NOVO] Define o caminho do arquivo HTML temporário
    const tempHtmlPath = path.join(__dirname, `temp_conversion_${Date.now()}.html`);

    try {
        console.log('Servidor: Iniciando conversão DOCX > HTML...');
        const { value: html } = await mammoth.convertToHtml({ buffer: req.file.buffer });
        console.log(`Servidor: HTML gerado com ${html.length} caracteres.`);

        // 1. [NOVO] Salva o HTML em um arquivo temporário
        fs.writeFileSync(tempHtmlPath, html);
        
        console.log('Servidor: Iniciando Puppeteer...');
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        
        // 2. [ALTERADO] Puppeteer agora abre o ARQUIVO HTML local
        // Isso é muito mais estável do que usar um Data URI
        await page.goto(`file://${tempHtmlPath}`, {
            waitUntil: 'networkidle0'
        });

        console.log('Servidor: Gerando o buffer do PDF...');
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '2.5cm', right: '2.5cm', bottom: '2.5cm', left: '2.5cm' }
        });
        console.log(`Servidor: Buffer do PDF gerado com ${pdfBuffer.length} bytes.`);

        if (pdfBuffer.length === 0) {
            throw new Error("O buffer do PDF gerado está vazio.");
        }

        const pdfFileName = req.file.originalname.replace(/\.docx?$/, '.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${pdfFileName}`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Servidor: Erro ao converter DOCX para PDF:', error);
        res.status(500).json({ error: 'Ocorreu um erro interno ao converter o arquivo.' });
    } finally {
        // 3. [IMPORTANTE] Garante que o navegador e o arquivo temporário sejam sempre removidos
        if (browser) {
            await browser.close();
            console.log('Servidor: Navegador Puppeteer fechado.');
        }
        if (fs.existsSync(tempHtmlPath)) {
            fs.unlinkSync(tempHtmlPath);
            console.log('Servidor: Arquivo HTML temporário removido.');
        }
    }
});


// Rota para Converter PDF para DOCX (extração de texto)
router.post('/pdf-para-docx', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    try {
        const data = await pdfParse(req.file.buffer);
        const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><p>${data.text.replace(/\n/g, '<br>')}</p></body></html>`;
        const docFileName = req.file.originalname.replace(/\.pdf$/, '.doc');
        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename=${docFileName}`);
        res.send(htmlContent);
    } catch (error) {
        console.error('Servidor: Erro ao extrair texto do PDF:', error);
        res.status(500).json({ error: 'Ocorreu um erro ao extrair texto do PDF.' });
    }
});

// Rota para Converter PDF para PDF/A
router.post('/pdf-para-pdfa', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    const tempInputPath = path.join(__dirname, `temp_input_${Date.now()}.pdf`);
    const tempOutputPath = path.join(__dirname, `temp_output_${Date.now()}.pdf`);
    fs.writeFileSync(tempInputPath, req.file.buffer);
    const gsDefPath = '/usr/share/ghostscript/10.00.0/lib/PDFA_def.ps'; // Confirme este caminho no seu contêiner se houver erro
    const command = `gs -dPDFA=2 -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sColorConversionStrategy=UseDeviceIndependentColor -sOutputFile=${tempOutputPath} ${gsDefPath} ${tempInputPath}`;
    exec(command, (error) => {
        fs.unlinkSync(tempInputPath);
        if (error) {
            console.error('Erro do Ghostscript na conversão para PDF/A:', error);
            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
            return res.status(500).json({ error: 'Erro ao converter para PDF/A. O arquivo pode não ser compatível.' });
        }
        const pdfBuffer = fs.readFileSync(tempOutputPath);
        fs.unlinkSync(tempOutputPath);
        const pdfaFileName = req.file.originalname.replace(/\.pdf$/, '_pdfa.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${pdfaFileName}`);
        res.send(pdfBuffer);
    });
});

module.exports = router;