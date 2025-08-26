// Arquivo: routes/pdfRoutes.js
// Data da Geração: 26 de agosto de 2025

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
router.post('/unir-pdf', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length < 2) {
        return res.status(400).json({ error: 'Por favor, envie pelo menos dois arquivos PDF.' });
    }
    try {
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdfToMerge = await PDFDocument.load(file.buffer);
            const copiedPages = await mergedPdf.copyPages(pdfToMerge, pdfToMerge.getPageIndices());
            copiedPages.forEach((page) => {
                mergedPdf.addPage(page);
            });
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
        fs.unlinkSync(tempInputPath); // Apaga o arquivo de entrada temporário

        if (error) {
            console.error('Erro do Ghostscript:', error);
            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath); // Limpa o arquivo de saída se houver erro
            return res.status(500).json({ error: 'Erro ao comprimir o PDF.' });
        }

        const pdfBuffer = fs.readFileSync(tempOutputPath);
        fs.unlinkSync(tempOutputPath); // Apaga o arquivo de saída temporário

        const compressedFileName = req.file.originalname.replace(/\.pdf$/, '_comprimido.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${compressedFileName}`);
        res.send(pdfBuffer);
    });
});

// Rota para Converter DOCX para PDF
router.post('/docx-para-pdf', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    try {
        const { value: html } = await mammoth.convertToHtml({ buffer: req.file.buffer });
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();
        const pdfFileName = req.file.originalname.replace(/\.docx?$/, '.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${pdfFileName}`);
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Servidor: Erro ao converter DOCX para PDF:', error);
        res.status(500).json({ error: 'Ocorreu um erro interno ao converter o arquivo.' });
    }
});

// Rota para Converter PDF para DOCX (extração de texto para um arquivo .doc compatível)
router.post('/pdf-para-docx', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    try {
        const data = await pdfParse(req.file.buffer);
        const extractedText = data.text;
        const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><p>${extractedText.replace(/\n/g, '<br>')}</p></body></html>`;
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

    // O caminho para PDFA_def.ps pode variar, mas este é o padrão para a versão do Ghostscript no Debian/Ubuntu
    const command = `gs -dPDFA=2 -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sColorConversionStrategy=UseDeviceIndependentColor -sOutputFile=${tempOutputPath} /usr/share/ghostscript/9.55.0/lib/PDFA_def.ps ${tempInputPath}`;

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