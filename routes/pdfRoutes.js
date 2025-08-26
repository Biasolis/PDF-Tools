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

const upload = multer({ storage: multer.memoryStorage() });

router.get('/', (req, res) => {
    res.render('index', { title: 'Ferramenta PDF & DOCX Completa' });
});

// Rota para Unir PDFs
router.post('/unir-pdf', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length < 2) return res.status(400).json({ error: 'Envie pelo menos dois arquivos.' });
    try {
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdf = await PDFDocument.load(file.buffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach(page => mergedPdf.addPage(page));
        }
        const mergedPdfBytes = await mergedPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=pdf-unido.pdf');
        res.send(Buffer.from(mergedPdfBytes));
    } catch (e) { res.status(500).json({ error: 'Erro ao unir os PDFs.' }); }
});

// Rota para Comprimir PDF
router.post('/comprimir-pdf', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const tempInputPath = path.join(__dirname, `temp_input_${Date.now()}.pdf`);
    const tempOutputPath = path.join(__dirname, `temp_output_${Date.now()}.pdf`);

    fs.writeFileSync(tempInputPath, req.file.buffer);

    const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${tempOutputPath} ${tempInputPath}`;

    exec(command, (error) => {
        fs.unlinkSync(tempInputPath); // Apaga o arquivo de entrada
        if (error) {
            console.error('Erro do Ghostscript:', error);
            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
            return res.status(500).json({ error: 'Erro ao comprimir o PDF.' });
        }
        const pdfBuffer = fs.readFileSync(tempOutputPath);
        fs.unlinkSync(tempOutputPath); // Apaga o arquivo de saída
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=comprimido.pdf`);
        res.send(pdfBuffer);
    });
});

// Rota para Converter DOCX para PDF
router.post('/docx-para-pdf', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
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
    } catch (e) { res.status(500).json({ error: 'Erro ao converter o arquivo.' }); }
});

// Rota para Converter PDF para DOCX (extração de texto)
router.post('/pdf-para-docx', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    try {
        console.log('Servidor: Iniciando extração de texto do PDF...');

        // 1. Extrai o texto puro usando pdf-parse (isto continua igual)
        const data = await pdfParse(req.file.buffer);
        const extractedText = data.text;

        // 2. [NOVO] Cria um conteúdo HTML simples envolvendo o texto extraído
        //    Substituímos as quebras de linha por tags <br> para manter a formatação
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"></head>
            <body>
                <p>${extractedText.replace(/\n/g, '<br>')}</p>
            </body>
            </html>
        `;

        // Define o nome do arquivo com a extensão .doc
        const docFileName = req.file.originalname.replace(/\.pdf$/, '.doc');

        // 3. [ALTERADO] Define os cabeçalhos para o formato .doc (MS Word)
        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename=${docFileName}`);
        
        // 4. Envia o conteúdo HTML, que o Word irá interpretar e abrir corretamente
        res.send(htmlContent);

        console.log('Servidor: Extração de texto concluída.');

    } catch (error) {
        console.error('Servidor: Erro ao extrair texto do PDF:', error);
        res.status(500).json({ error: 'Ocorreu um erro ao extrair texto do PDF.' });
    }
});

module.exports = router;