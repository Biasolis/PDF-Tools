const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfController = require('../controllers/pdfController');

// Configuração do Multer para salvar arquivos temporariamente
const upload = multer({ dest: 'uploads/' });

// Rota para a página inicial
router.get('/', (req, res) => {
    res.render('index', { title: 'Ferramenta PDF Avançada' });
});

// Rota para unir PDFs
router.post('/unir', upload.array('files', 10), pdfController.unirPdfs);

// Rota para comprimir PDF
router.post('/comprimir', upload.single('file'), pdfController.comprimirPdf);

// Rota para converter PDF para DOCX
router.post('/pdf-para-docx', upload.single('file'), pdfController.converterPdfParaDocx);

// Rota para converter DOCX para PDF
router.post('/docx-para-pdf', upload.single('file'), pdfController.converterDocxParaPdf);

module.exports = router;
