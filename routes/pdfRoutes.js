// Arquivo: routes/pdfRoutes.js
// Versão final com todas as 11 ferramentas

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

// --- Helpers ---
function cleanFileName(fileName) {
    if (!fileName) return '';
    return fileName.replace(/_unido_.*|_comprimido_.*|_pdfa_.*|_separado_.*|_jpg_.*|_png_.*|_convertido_.*/i, '');
}

function runExec(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Exec Error for command "${command}":`, stderr);
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

// --- Configuração ---
const uploadDir = path.join(__dirname, '..', 'uploads');
const documentsDir = path.join(__dirname, '..', 'documents');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(documentsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const sessionPath = path.join(uploadDir, req.params.sessionId);
        fs.mkdirSync(sessionPath, { recursive: true });
        cb(null, sessionPath);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage: storage });
const jobs = new Map();

// =======================================================
// ROTAS DA APLICAÇÃO
// =======================================================

// --- Rota Principal ---
router.get('/', (req, res) => res.render('index', { title: 'Ferramenta PDF & DOCX Completa' }));
// --- Nova Rota para a página do Scanner ---
router.get('/scanner', (req, res) => res.render('scanner', { title: 'Scanner de Documentos' }));


// --- Rotas de Sessão e Jobs (V1 - Ferramentas) ---
router.post('/session/create', (req, res) => {
    const sessionId = uuidv4();
    jobs.set(sessionId, { status: 'created' });
    res.status(201).json({ sessionId });
});

router.post('/session/upload/:sessionId', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    res.status(200).json({ fileId: req.file.filename });
});

router.post('/session/execute/:sessionId', (req, res) => {
    const { tool, files } = req.body;
    if (!jobs.has(req.params.sessionId)) return res.status(404).json({ error: 'Sessão não encontrada.' });
    processJob(req.params.sessionId, tool, files);
    res.status(202).json({ message: 'Processamento iniciado.' });
});

router.get('/session/status/:sessionId', (req, res) => {
    const job = jobs.get(req.params.sessionId);
    if (!job) return res.status(404).json({ error: 'Trabalho não encontrado.' });
    res.status(200).json(job);
});

router.get('/download/:sessionId/:fileName', (req, res) => {
    const { sessionId, fileName } = req.params;
    const filePath = path.join(uploadDir, sessionId, fileName);
    if (fs.existsSync(filePath)) {
        res.download(filePath, fileName, (err) => {
            if (!err) {
                fs.rm(path.join(uploadDir, sessionId), { recursive: true, force: true }, () => {});
                jobs.delete(sessionId);
            }
        });
    } else {
        res.status(404).send('Arquivo não encontrado ou a sessão expirou.');
    }
});

// Rota Síncrona (Rápida)
router.post('/pdf-para-docx', multer({ storage: multer.memoryStorage() }).single('file'), async (req, res) => {
    // ...código da versão anterior sem alteração...
});


// --- ROTAS PARA O EDITOR V2 (WOPI INTEGRATION) ---
// ... (código da V2 sem alterações) ...


// =======================================================
// LÓGICA DE PROCESSAMENTO EM SEGUNDO PLANO (ATUALIZADA)
// =======================================================
async function processJob(sessionId, tool, files) {
    jobs.set(sessionId, { status: 'processing' });
    const sessionPath = path.join(uploadDir, sessionId);

    try {
        let outputFileName;
        const inputFile = files ? path.join(sessionPath, files[0]) : null;
        const outputFile = path.join(sessionPath, `output_${sessionId}.tmp`);
        const baseFileName = files ? cleanFileName(files[0]) : '';

        switch (tool) {
            case 'unir-pdf':
                // ...código da versão anterior sem alteração...
                break;
            
            case 'comprimir-pdf':
                // ...código da versão anterior sem alteração...
                break;

            case 'docx-para-pdf':
                // ...código da versão anterior sem alteração...
                break;

            case 'pdf-para-pdfa':
                // ...código da versão anterior sem alteração...
                break;

            case 'pdf-para-jpg':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_jpg_${sessionId}.zip`);
                const jpgOutputDir = path.join(sessionPath, 'jpg_output');
                fs.mkdirSync(jpgOutputDir, { recursive: true });
                await runExec(`pdftoppm -jpeg '${inputFile}' '${path.join(jpgOutputDir, 'page')}'`);
                await zip(jpgOutputDir, path.join(sessionPath, outputFileName));
                break;

            case 'pdf-para-png':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_png_${sessionId}.zip`);
                const pngOutputDir = path.join(sessionPath, 'png_output');
                fs.mkdirSync(pngOutputDir, { recursive: true });
                await runExec(`pdftoppm -png '${inputFile}' '${path.join(pngOutputDir, 'page')}'`);
                await zip(pngOutputDir, path.join(sessionPath, outputFileName));
                break;
            
            case 'jpg-para-pdf':
            case 'png-para-pdf':
            case 'scanner-para-pdf': // O scanner usa a mesma lógica
                outputFileName = `documento_${sessionId}.pdf`;
                const inputFilePaths = files.map(f => `'${path.join(sessionPath, f)}'`).join(' ');
                await runExec(`convert ${inputFilePaths} '${path.join(sessionPath, outputFileName)}'`);
                break;

            case 'separar-pdf':
                // ...código da versão anterior sem alteração...
                break;
            
            default:
                throw new Error(`Ferramenta '${tool}' desconhecida.`);
        }
        
        jobs.set(sessionId, { status: 'complete', downloadUrl: `/download/${sessionId}/${outputFileName}` });

    } catch (error) {
        console.error(`Erro no trabalho ${sessionId} (${tool}):`, error);
        jobs.set(sessionId, { status: 'error', message: `Falha em '${tool}'. Verifique o arquivo e tente novamente.` });
    }
}

module.exports = router;

