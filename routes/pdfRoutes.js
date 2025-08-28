// Arquivo: routes/pdfRoutes.js (Versão Robusta)
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Para gerar IDs únicos

// --- CONFIGURAÇÃO ---
// 1. Salvar arquivos no disco em vez de na memória
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

// 2. "Banco de dados" em memória para gerenciar os trabalhos (jobs)
const jobs = new Map();

// --- ROTAS ---
router.get('/', (req, res) => {
    res.render('index', { title: 'Ferramenta PDF & DOCX Completa' });
});

// [NOVO] Rota para upload de arquivos individuais
router.post('/upload-chunk', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    // Retorna o nome do arquivo salvo no servidor, que será nosso ID
    res.status(200).json({ fileId: req.file.filename });
});

// [NOVO] Rota para iniciar o trabalho de união
router.post('/start-merge', express.json(), (req, res) => {
    const { orderedFileIds } = req.body;
    if (!orderedFileIds || orderedFileIds.length < 2) {
        return res.status(400).json({ error: 'Lista de arquivos inválida.' });
    }

    const jobId = uuidv4();
    jobs.set(jobId, { status: 'pending', files: orderedFileIds });

    // Inicia o processamento em segundo plano SEM bloquear a resposta
    processMergeJob(jobId, orderedFileIds);

    // Responde imediatamente com o ID do trabalho
    res.status(202).json({ jobId: jobId });
});

// [NOVO] Rota para verificar o status de um trabalho
router.get('/merge-status/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Trabalho não encontrado.' });
    }
    res.status(200).json(job);
});

// [NOVO] Rota para baixar o arquivo finalizado
router.get('/download/:fileName', (req, res) => {
    const filePath = path.join(uploadDir, req.params.fileName);
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            // Após o download, apaga o arquivo final para economizar espaço
            if (!err) fs.unlinkSync(filePath);
        });
    } else {
        res.status(404).send('Arquivo não encontrado.');
    }
});


// --- LÓGICA DE PROCESSAMENTO EM SEGUNDO PLANO ---
async function processMergeJob(jobId, orderedFileIds) {
    try {
        jobs.set(jobId, { ...jobs.get(jobId), status: 'processing' });

        const mergedPdf = await PDFDocument.create();
        for (const fileId of orderedFileIds) {
            const filePath = path.join(uploadDir, fileId);
            if (fs.existsSync(filePath)) {
                const fileBuffer = fs.readFileSync(filePath);
                const pdf = await PDFDocument.load(fileBuffer);
                const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                copiedPages.forEach(page => mergedPdf.addPage(page));
                // Apaga o arquivo individual após usá-lo
                fs.unlinkSync(filePath);
            }
        }

        const mergedPdfBytes = await mergedPdf.save();
        const outputFileName = `merged_${jobId}.pdf`;
        const outputPath = path.join(uploadDir, outputFileName);
        fs.writeFileSync(outputPath, mergedPdfBytes);

        // Atualiza o status do trabalho para concluído
        jobs.set(jobId, { status: 'complete', downloadUrl: `/download/${outputFileName}` });

    } catch (error) {
        console.error(`Erro no trabalho ${jobId}:`, error);
        jobs.set(jobId, { status: 'error', message: 'Falha ao unir os PDFs.' });
        // Limpa os arquivos restantes em caso de erro
        orderedFileIds.forEach(fileId => {
            const filePath = path.join(uploadDir, fileId);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });
    }
}


// As outras rotas (comprimir, etc.) continuam aqui...
// ...
// Lembre-se de adicionar 'uuid' ao seu package.json: npm install uuid
module.exports = router;