// Arquivo: routes/pdfRoutes.js
// Versão Final: Adição PNG para PDF

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');
const pdfParse = require('pdf-parse');
const { exec } = require('child_process');
const { zip } = require('zip-a-folder');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- Helper: Limpeza de nomes de arquivo ---
function cleanFileName(fileName) {
    if (!fileName) return '';
    return fileName.replace(/_unido_.*|_comprimido_.*|_pdfa_.*|_separado_.*|_jpg_.*|_convertido_.*/i, '');
}

// --- Helper: Executar comando no terminal ---
function runExec(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Exec Error ("${command}"):`, stderr);
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

// --- Helper: Execução do Apache PDFBox (Java) ---
function runPDFBox(args) {
    // CORREÇÃO: Usar path.resolve para garantir que o caminho do JAR é absoluto e correto
    const jarPath = path.resolve('/app/pdfbox.jar');
    const command = `java -Xmx512m -jar ${jarPath} ${args}`;
    return runExec(command);
}

// --- Helper: Criar Definição PDF/A para Ghostscript (Removida a função) ---

// --- Configuração Upload com Sanitização ---
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const sessionPath = path.join(uploadDir, req.params.sessionId);
        fs.mkdirSync(sessionPath, { recursive: true });
        cb(null, sessionPath);
    },
    filename: (req, file, cb) => {
        const originalName = file.originalname.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
        const extension = path.extname(originalName);
        const baseName = path.basename(originalName, extension);
        const safeBaseName = baseName.replace(/[^a-zA-Z0-9\.\-_()]/g, '_');
        const finalName = `${safeBaseName}${extension}`;
        cb(null, finalName);
    }
});
const upload = multer({ storage: storage });
const jobs = new Map();

// --- Rotas Padrão (Mantidas) ---
router.get('/', (req, res) => res.render('index', { title: 'Ferramenta PDF & DOCX Completa' }));

router.post('/session/create', (req, res) => { const sessionId = uuidv4(); jobs.set(sessionId, { status: 'created' }); res.status(201).json({ sessionId }); });
router.post('/session/upload/:sessionId', upload.single('file'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'Erro no upload.' }); res.status(200).json({ fileId: req.file.filename }); });
router.post('/session/execute/:sessionId', (req, res) => { const { tool, files } = req.body; if (!jobs.has(req.params.sessionId)) return res.status(404).json({ error: 'Sessão inválida.' }); processJob(req.params.sessionId, tool, files); res.status(202).json({ message: 'Iniciado.' }); });
router.get('/session/status/:sessionId', (req, res) => { const job = jobs.get(req.params.sessionId); if (!job) return res.status(404).json({ error: 'Não encontrado.' }); res.status(200).json(job); });
router.get('/download/:sessionId/:fileName', (req, res) => {
    const { sessionId, fileName } = req.params; const filePath = path.join(uploadDir, sessionId, fileName);
    if (fs.existsSync(filePath)) { res.download(filePath, fileName, (err) => { if (!err) { fs.rm(path.join(uploadDir, sessionId), { recursive: true, force: true }, () => {}); jobs.delete(sessionId); } }); } else { res.status(404).send('Arquivo expirado.'); }
});
router.post('/pdf-para-docx', multer({ storage: multer.memoryStorage() }).single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo.' });
    try {
        const data = await pdfParse(req.file.buffer); const htmlContent = `<!DOCTYPE html><html><body><p>${data.text.replace(/\n/g, '<br>')}</p></body></html>`;
        const docFileName = req.file.originalname.replace(/\.pdf$/, '.doc'); res.setHeader('Content-Type', 'application/msword'); res.setHeader('Content-Disposition', `attachment; filename=${docFileName}`); res.send(htmlContent);
    } catch (error) { res.status(500).json({ error: 'Erro na extração de texto.' }); }
});

// --- Lógica de Processamento em Segundo Plano ---
async function processJob(sessionId, tool, files) {
    jobs.set(sessionId, { status: 'processing' });
    const sessionPath = path.join(uploadDir, sessionId);

    try {
        let outputFileName;
        const inputFile = files ? `"${path.join(sessionPath, files[0])}"` : null;
        const outputFile = `"${path.join(sessionPath, `output_${sessionId}.tmp`)}"`;
        const baseFileName = files ? cleanFileName(files[0]) : '';

        switch (tool) {
            case 'unir-pdf':
                outputFileName = `unido_${sessionId}.pdf`;
                const mergedOutputPath = path.join(sessionPath, outputFileName);
                const inputPaths = files.map(f => `"${path.join(sessionPath, f)}"`).join(' ');
                
                try {
                    await runPDFBox(`merge "${mergedOutputPath}" ${inputPaths}`);
                } catch (e) {
                    console.log("PDFBox merge falhou, tentando fallback para pdf-lib...");
                    const mergedPdf = await PDFDocument.create();
                    for (const fileName of files) {
                        const fileBuffer = fs.readFileSync(path.join(sessionPath, fileName));
                        const pdf = await PDFDocument.load(fileBuffer);
                        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                        copiedPages.forEach(page => mergedPdf.addPage(page));
                    }
                    fs.writeFileSync(mergedOutputPath, await mergedPdf.save());
                }
                break;
            
            case 'comprimir-pdf':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_comprimido_${sessionId}.pdf`);
                await runExec(`gs -dSAFER -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputFile} ${inputFile}`);
                fs.renameSync(outputFile.replace(/"/g, ''), path.join(sessionPath, outputFileName));
                break;

            case 'docx-para-pdf':
                outputFileName = baseFileName.replace(/\.docx?$/i, `_${sessionId}.pdf`);
                const { value: html } = await mammoth.convertToHtml({ path: inputFile.replace(/"/g, '') });
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                const page = await browser.newPage();
                await page.setContent(html, { waitUntil: 'networkidle0' });
                const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '2.5cm', right: '2.5cm', bottom: '2.5cm', left: '2.5cm' } });
                await browser.close();
                fs.writeFileSync(path.join(sessionPath, outputFileName), pdfBuffer);
                break;

            case 'pdf-para-jpg':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_jpg_${sessionId}.zip`);
                const jpgOutputDir = path.join(sessionPath, 'jpg_output');
                fs.mkdirSync(jpgOutputDir);
                await runExec(`pdftoppm -jpeg ${inputFile} "${path.join(jpgOutputDir, 'page')}"`);
                await zip(jpgOutputDir, path.join(sessionPath, outputFileName));
                break;
            
            case 'jpg-para-pdf':
            case 'png-para-pdf': // Novo caso para PNG (usando a mesma lógica do JPG)
                outputFileName = `convertido_${sessionId}.pdf`;
                const imgPaths = files.map(f => `"${path.join(sessionPath, f)}"`).join(' ');
                // O utilitário 'convert' (ImageMagick) lida tanto com JPG quanto com PNG
                await runExec(`convert ${imgPaths} "${path.join(sessionPath, outputFileName)}"`);
                break;

            case 'separar-pdf':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_separado_${sessionId}.zip`);
                const splitOutputDir = path.join(sessionPath, 'split_output');
                fs.mkdirSync(splitOutputDir);
                
                try {
                    process.chdir(splitOutputDir);
                    await runPDFBox(`split -i ${inputFile}`);
                    process.chdir(path.join(__dirname, '..'));
                } catch (e) {
                    console.log("PDFBox split falhou, tentando fallback js...", e);
                    process.chdir(path.join(__dirname, '..'));
                    const originalPdf = await PDFDocument.load(fs.readFileSync(inputFile.replace(/"/g, '')));
                    for (let i = 0; i < originalPdf.getPageCount(); i++) {
                        const newPdf = await PDFDocument.create();
                        const [copiedPage] = await newPdf.copyPages(originalPdf, [i]);
                        newPdf.addPage(copiedPage);
                        fs.writeFileSync(path.join(splitOutputDir, `pagina_${i + 1}.pdf`), await newPdf.save());
                    }
                }
                await zip(splitOutputDir, path.join(sessionPath, outputFileName));
                break;
            
            default:
                throw new Error(`Ferramenta '${tool}' desconhecida.`);
        }
        
        jobs.set(sessionId, { status: 'complete', downloadUrl: `/download/${sessionId}/${outputFileName}` });

    } catch (error) {
        console.error(`Erro no trabalho ${sessionId} (${tool}):`, error);
        const errorMsg = error.stderr || error.message || 'Falha desconhecida';
        jobs.set(sessionId, { status: 'error', message: `Falha em '${tool}'. Detalhes: ${errorMsg.substring(0, 100)}...` });
    }
}

module.exports = router;