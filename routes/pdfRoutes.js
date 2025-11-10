// Arquivo: routes/pdfRoutes.js
// Atualizado para adicionar o middleware express.json() localmente.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { processTool } = require('../services/pdfProcessor'); // Importa o serviço

// Cria um parser JSON SÓ PARA AS ROTAS QUE PRECISAM DELE
const jsonParser = express.json();

// --- Configuração ---
const uploadDir = path.join(__dirname, '..', 'uploads');
const documentsDir = path.join(__dirname, '..', 'documents'); // Para WOPI
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hora

// Cria diretórios se não existirem (feito na inicialização)
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(documentsDir, { recursive: true });

// Configuração do Multer (armazenamento em disco)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const sessionPath = path.join(uploadDir, req.params.sessionId);
        cb(null, sessionPath); // Passa o caminho DIRETAMENTE e SINCRONAMENTE
    },
    filename: (req, file, cb) => {
         // Sanitiza nome original e adiciona timestamp
         const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_').substring(0, 100);
         cb(null, `${Date.now()}-${safeOriginalName}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        // Validação de tipo de arquivo
        const allowedTypes = [
            'application/pdf', 
            'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
            'image/jpeg', 
            'image/png', 
            'application/vnd.ms-excel', 
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            console.warn(`[${req.params.sessionId}] Upload rejeitado: tipo de arquivo inválido - ${file.mimetype} (${file.originalname})`);
            cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}`), false);
        }
    }
});

// Gerenciamento de status de jobs em memória
const jobs = new Map();

// Middleware para validar sessão
const validateSession = (req, res, next) => {
    const { sessionId } = req.params;
    if (!sessionId || !jobs.has(sessionId)) {
         console.warn(`Tentativa de acesso à sessão inválida ou expirada: ${sessionId}`);
        return res.status(404).json({ error: 'Sessão não encontrada ou expirada.' });
    }
    const sessionPath = path.join(uploadDir, sessionId);
    if (!fs.existsSync(sessionPath)) {
        console.warn(`[${sessionId}] Diretório da sessão não encontrado no disco. Limpando job.`);
        jobs.delete(sessionId);
        return res.status(404).json({ error: 'Sessão não encontrada (diretório inexistente).' });
    }
    next();
};

// =======================================================
// ROTAS DA APLICAÇÃO
// =======================================================

// --- Rota Principal ---
router.get('/', (req, res) => res.render('index', { title: 'Ferramenta PDF & DOCX Completa' }));


// --- Rotas de Sessão e Jobs ---
router.post('/session/create', (req, res) => {
    const sessionId = uuidv4();
    const sessionPath = path.join(uploadDir, sessionId);
    try {
        fs.mkdirSync(sessionPath, { recursive: true });
        jobs.set(sessionId, { status: 'created', startTime: Date.now() });
        console.log(`Sessão criada: ${sessionId}`);
        res.status(201).json({ sessionId });
    } catch (error) {
         console.error(`Erro ao criar diretório para sessão ${sessionId}:`, error);
         res.status(500).json({ error: 'Falha ao iniciar sessão no servidor.' });
    }
});

// Rota de Upload (NÃO usa jsonParser)
router.post('/session/upload/:sessionId', validateSession, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: `Arquivo excede o limite de ${MAX_FILE_SIZE / 1024 / 1024}MB.` });
                }
                return res.status(400).json({ error: `Erro no upload: ${err.message}` });
            } else if (err) {
                 return res.status(400).json({ error: err.message || 'Erro durante o upload.' });
            }
             if (!req.file) {
                return res.status(400).json({ error: 'Nenhum arquivo válido enviado.' });
            }
            console.log(`[${req.params.sessionId}] Arquivo recebido: ${req.file.filename}`);
            res.status(200).json({ fileId: req.file.filename });
        }
    });
});


// Rota de Execução (USA jsonParser)
router.post('/session/execute/:sessionId', validateSession, jsonParser, (req, res) => {
    const { sessionId } = req.params;
    const { tool, files, options } = req.body;

    if (!tool || !files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Parâmetros inválidos: ferramenta e arquivos são obrigatórios.' });
    }

    const currentJob = jobs.get(sessionId);
    if (currentJob.status === 'processing') {
         console.warn(`[${sessionId}] Tentativa de executar job enquanto outro está processando.`);
         return res.status(409).json({ error: 'Um processo já está em andamento para esta sessão.' });
    }

    jobs.set(sessionId, { ...currentJob, status: 'processing', tool: tool });
    console.log(`[${sessionId}] Iniciando job '${tool}' com arquivos: ${files.join(', ')} | Opções:`, options || {});

    processTool(sessionId, tool, files, options)
        .then(outputFileName => {
            console.log(`[${sessionId}] Job '${tool}' concluído. Saída: ${outputFileName}`);
            jobs.set(sessionId, { ...jobs.get(sessionId), status: 'complete', downloadUrl: `/download/${sessionId}/${outputFileName}` });
        })
        .catch(error => {
            console.error(`[${sessionId}] Erro no job '${tool}':`, error.message);
            jobs.set(sessionId, { ...jobs.get(sessionId), status: 'error', message: error.message || `Falha desconhecida em '${tool}'.` });
        });

    res.status(202).json({ message: 'Processamento iniciado.' });
});

// Rota de Status (NÃO usa jsonParser)
router.get('/session/status/:sessionId', validateSession, (req, res) => {
    const job = jobs.get(req.params.sessionId);
    res.status(200).json(job);
});

// Rota de Download (NÃO usa jsonParser)
router.get('/download/:sessionId/:fileName', validateSession, (req, res) => {
    const { sessionId, fileName } = req.params;
    const sessionPath = path.join(uploadDir, sessionId);
    const filePath = path.join(sessionPath, fileName);

    if (!filePath.startsWith(uploadDir)) {
         console.error(`[${sessionId}] Tentativa de download inválida (Path Traversal?): ${fileName}`);
         return res.status(400).send('Caminho de arquivo inválido.');
    }

    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`[${sessionId}] Iniciando download de ${fileName} (${stats.size} bytes)`);

        const cleanupCallback = (err) => {
            if (err) {
                 if (err.code === 'ECONNRESET' || err.message.includes('client closed request')) {
                      console.log(`[${sessionId}] Download de ${fileName} interrompido pelo cliente.`);
                 } else {
                      console.error(`[${sessionId}] Erro durante o envio do download de ${fileName}:`, err);
                 }
            } else {
                 console.log(`[${sessionId}] Download de ${fileName} concluído. Limpando sessão.`);
                 fs.rm(sessionPath, { recursive: true, force: true }, (rmErr) => {
                     if (rmErr) console.error(`[${sessionId}] Erro ao limpar pasta da sessão:`, rmErr);
                 });
                 jobs.delete(sessionId);
            }
        };

        const originalName = cleanOriginalFileName(fileName);
        res.download(filePath, originalName || fileName, cleanupCallback);

    } else {
        console.warn(`[${sessionId}] Tentativa de download falhou: Arquivo não encontrado ${filePath}`);
        res.status(404).send('Arquivo não encontrado ou a sessão expirou.');
    }
});


// Rota Síncrona PDF->DOC Simples (NÃO usa jsonParser)
router.post('/pdftodocxsimple', multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } }).single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(req.file.buffer);
        const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><p>${data.text.replace(/\n/g, '<br>')}</p></body></html>`;
        const originalNameClean = (req.file.originalname || 'documento').replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\.pdf$/i, '');
        const docFileName = `${originalNameClean}.doc`;

        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename="${docFileName}"`);
        res.send(htmlContent);
    } catch (error) {
        console.error("Erro na conversão PDF->DOC (simples):", error);
        res.status(500).json({ error: 'Ocorreu um erro ao extrair texto do PDF.' });
    }
});

// ROTAS WOPI (sem alterações)
router.get('/editor/:fileName', (req, res) => { /* ... */ });
router.get('/wopi/files/:fileName', (req, res) => { /* ... */ });
router.get('/wopi/files/:fileName/contents', (req, res) => { /* ... */ });
router.post('/wopi/files/:fileName/contents', (req, res) => { /* ... */ });

// Limpeza de jobs em memória
function cleanupExpiredJobs() {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [sessionId, job] of jobs.entries()) {
        const age = now - (job.startTime || 0);
        if (age > SESSION_TIMEOUT_MS) {
             if (job.status !== 'complete' && job.status !== 'error') {
                 console.log(`[Cleanup] Removendo job '${job.status || 'unknown'}' expirado: ${sessionId}`);
                 jobs.delete(sessionId);
                 cleanedCount++;
             } else if (age > SESSION_TIMEOUT_MS * 2) {
                  console.log(`[Cleanup] Removendo job finalizado antigo ('${job.status}'): ${sessionId}`);
                  jobs.delete(sessionId);
                  cleanedCount++;
             }
        }
    }
    if(cleanedCount > 0) console.log(`[Cleanup] Limpeza de memória de jobs concluída. Removidos: ${cleanedCount}`);
}
setInterval(cleanupExpiredJobs, SESSION_TIMEOUT_MS / 2);

// Helper para pegar nome original limpo
function cleanOriginalFileName(fileName) {
     if (!fileName) return '';
     let baseName = fileName.replace(/^\d{13}-/, '');
     baseName = baseName.replace(/_(unido|comprimido|pdfa|separado|jpg|convertido|ods|pdf|docx|protegido)_[a-f0-9]+(\.\w+)$/i, '$2');
     return baseName;
}

module.exports = router;