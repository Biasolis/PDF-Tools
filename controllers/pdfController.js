const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const docx = require('docx');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun } = docx;

// Função para unir PDFs
exports.unirPdfs = async (req, res) => {
    try {
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
            fs.unlinkSync(file.path);
        }
        const mergedPdfBytes = await mergedPdf.save();
        res.setHeader('Content-Disposition', 'attachment; filename="pdf-unido.pdf"');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(mergedPdfBytes));
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro ao unir os PDFs.');
    }
};

// Função para comprimir PDF usando Ghostscript
exports.comprimirPdf = (req, res) => {
    const inputPath = req.file.path;
    const outputPath = path.join('uploads/', `comprimido-${req.file.filename}.pdf`);

    // Comando Ghostscript para compressão (qualidade de eBook)
    const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

    exec(command, (error) => {
        // Limpa o arquivo de entrada original
        fs.unlinkSync(inputPath);

        if (error) {
            console.error(`Erro ao executar o Ghostscript: ${error}`);
            return res.status(500).send('Erro ao comprimir o PDF.');
        }

        // Envia o arquivo comprimido para o utilizador
        res.download(outputPath, 'pdf-comprimido.pdf', (err) => {
            if (err) {
                console.error(`Erro ao enviar o ficheiro: ${err}`);
            }
            // Limpa o ficheiro de saída comprimido após o download
            fs.unlinkSync(outputPath);
        });
    });
};


// Função para converter PDF para DOCX (extraindo texto)
exports.converterPdfParaDocx = async (req, res) => {
    try {
        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdfParse(dataBuffer);
        fs.unlinkSync(req.file.path);

        const paragraphs = data.text.split('\n').map(text => 
            new Paragraph({
                children: [new TextRun(text)],
            })
        );

        const doc = new Document({
            sections: [{
                properties: {},
                children: paragraphs,
            }],
        });

        const buffer = await Packer.toBuffer(doc);
        res.setHeader('Content-Disposition', 'attachment; filename="documento.docx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro ao converter o PDF para DOCX.');
    }
};

// Função para converter DOCX para PDF (extraindo texto)
exports.converterDocxParaPdf = async (req, res) => {
    try {
        let { value } = await mammoth.extractRawText({ path: req.file.path });
        fs.unlinkSync(req.file.path);

        // --- CORREÇÃO APLICADA AQUI ---
        // Substitui caracteres não suportados pela fonte padrão do PDF.
        const sanitizedText = value.replace(/●/g, '*').replace(/[^\u0000-\u00FF]/g, '?');

        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontSize = 12;

        page.drawText(sanitizedText, { // Usa o texto sanitizado
            x: 50,
            y: height - 4 * fontSize,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
            maxWidth: width - 100,
            lineHeight: 15,
        });

        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Disposition', 'attachment; filename="documento.pdf"');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro ao converter o DOCX para PDF.');
    }
};
