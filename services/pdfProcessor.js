const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
// Importar apenas o necessário se for mover mais lógica depois
// const { PDFDocument } = require('pdf-lib');
// const mammoth = require('mammoth');
// const { zip } = require('zip-a-folder');

// --- Helpers Internos ---

/**
 * Executa um comando shell de forma assíncrona.
 * Escapa argumentos individuais para segurança básica contra injeção.
 * @param {string} command - O comando base (ex: 'qpdf', 'soffice').
 * @param {string[]} args - Array de argumentos para o comando.
 * @returns {Promise<string>} - Promessa resolvida com a saída padrão ou rejeitada com erro.
 */
function runExec(command, args = []) {
    // Timeout aumentado para operações potencialmente longas
    const execTimeout = 5 * 60 * 1000; // 5 minutos

    // Escapa argumentos para segurança básica (impede a maioria das injeções simples)
    // ATENÇÃO: Isso NÃO é infalível para todos os casos complexos.
    // Use com cuidado, especialmente com entrada do usuário em 'args'.
    const escapeArg = (arg) => {
        // Se já estiver entre aspas simples, assume-se que foi tratado
        if (arg.startsWith("'") && arg.endsWith("'")) return arg;
        // Escapa aspas simples internas e envolve com aspas simples
        return `'${arg.replace(/'/g, "'\\''")}'`;
    };

    const fullCommand = `${command} ${args.map(escapeArg).join(' ')}`;

    return new Promise((resolve, reject) => {
        console.log(`Executando: ${fullCommand}`); // Log do comando completo
        exec(fullCommand, { timeout: execTimeout }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Erro ao executar comando: ${fullCommand}`);
                console.error(`Exit Code: ${error.code}`);
                console.error(`Stderr: ${stderr}`);
                let errorMessage = `Falha na execução (código: ${error.code}).`;
                if (stderr) {
                     if (stderr.toLowerCase().includes('error:') || stdout.toLowerCase().includes('error:')) {
                         errorMessage = `Erro no processamento: ${stderr.split('\n')[0] || stdout.split('\n')[0]}`;
                     } else if (stderr.toLowerCase().includes('not found') || stderr.toLowerCase().includes('no such file')) {
                          errorMessage = 'Erro: Arquivo de entrada não encontrado ou ferramenta ausente.';
                     } else {
                          errorMessage += ` Detalhes: ${stderr.split('\n')[0]}`;
                     }
                } else if (error.signal === 'SIGTERM') {
                    errorMessage = `Processo excedeu o tempo limite (${execTimeout / 1000}s).`;
                }
                return reject(new Error(errorMessage));
            }
            resolve(stdout);
        });
    });
}

/**
 * Limpa o nome do arquivo, removendo timestamp e sufixos de ferramentas.
 * @param {string} fileName - Nome do arquivo (pode conter timestamp e sufixo).
 * @returns {string} - Nome base do arquivo com extensão original.
 */
function cleanOriginalFileName(fileName) {
    if (!fileName) return '';
    let baseName = fileName;
    baseName = baseName.replace(/^\d{13}-/, ''); // Remove timestamp- prefix
    // Remove sufixos como _unido_..., _protegido_... mantendo a extensão
    baseName = baseName.replace(/_(unido|comprimido|pdfa|separado|jpg|convertido|ods|pdf|docx|protegido)_[a-f0-9]+(\.\w+)$/i, '$2');
    return baseName;
}

// --- Funções de Processamento das Ferramentas ---

/**
 * Comprime um arquivo PDF usando LibreOffice (re-salvando).
 * @param {string} sessionId - ID da sessão.
 * @param {string} sessionPath - Caminho completo para a pasta da sessão.
 * @param {string} inputFileName - Nome do arquivo PDF de entrada (com timestamp).
 * @param {object} options - Opções adicionais (não usadas).
 * @returns {Promise<string>} - Nome do arquivo de saída gerado.
 */
async function comprimirPdf(sessionId, sessionPath, inputFileName, options) {
    const inputFilePath = path.join(sessionPath, inputFileName);
    const originalBaseName = cleanOriginalFileName(inputFileName);
    // Assegura que a extensão final seja .pdf
    const outputBaseName = originalBaseName.replace(/\.[^.]+$/, ''); // Remove extensão antiga
    const outputFileName = `${outputBaseName}_comprimido_${sessionId}.pdf`;
    const outputDir = sessionPath; // Passa o diretório diretamente

    // Comando soffice
    const args = [
        '--headless',
        '--invisible',
        '--convert-to', 'pdf',
        '--outdir', outputDir,
        inputFilePath
    ];
    // Executa via xvfb-run
    await runExec('xvfb-run', ['-a', 'soffice', ...args]);

    // O LibreOffice salva com o nome original (sem timestamp), precisamos renomear
    const libreOfficeOutputName = `${outputBaseName}.pdf`; // Nome esperado que o LO salva
    const libreOfficeOutputPath = path.join(sessionPath, libreOfficeOutputName);
    const finalOutputPath = path.join(sessionPath, outputFileName);

    if (fs.existsSync(libreOfficeOutputPath)) {
        fs.renameSync(libreOfficeOutputPath, finalOutputPath);
    } else {
         // Tenta fallback com nome completo (menos provável, mas por segurança)
         const libreOfficeOutputNameTs = `${inputFileName.replace(/\.[^.]+$/, '')}.pdf`;
         const libreOfficeOutputPathTs = path.join(sessionPath, libreOfficeOutputNameTs);
          if (fs.existsSync(libreOfficeOutputPathTs)) {
              fs.renameSync(libreOfficeOutputPathTs, finalOutputPath);
              console.warn("Compressão usou nome com timestamp como saída do LO, renomeado.");
          } else {
             // Log detalhado do erro
             console.error(`Arquivo de saída da compressão não encontrado. Esperado: '${libreOfficeOutputName}' ou '${libreOfficeOutputNameTs}' em ${sessionPath}`);
             // Tenta listar arquivos na pasta para debug
             try {
                  const filesInDir = fs.readdirSync(sessionPath);
                  console.error("Arquivos encontrados na pasta:", filesInDir);
             } catch(e) { console.error("Não foi possível listar arquivos na pasta de sessão.");}
             throw new Error(`Arquivo de saída da compressão não encontrado após execução do soffice.`);
          }
    }
    return outputFileName;
}

/**
 * Protege um PDF com senha usando qpdf.
 * @param {string} sessionId - ID da sessão.
 * @param {string} sessionPath - Caminho completo para a pasta da sessão.
 * @param {string} inputFileName - Nome do arquivo PDF de entrada (com timestamp).
 * @param {object} options - Opções, DEVE conter `password`.
 * @returns {Promise<string>} - Nome do arquivo de saída gerado.
 */
async function protegerPdf(sessionId, sessionPath, inputFileName, options) {
    const { password } = options;
    if (!password || typeof password !== 'string' || password.length === 0) {
        throw new Error("Senha inválida ou não fornecida para proteger o PDF.");
    }

    const inputFilePath = path.join(sessionPath, inputFileName);
    const originalBaseName = cleanOriginalFileName(inputFileName);
    const outputBaseName = originalBaseName.replace(/\.[^.]+$/, ''); // Remove extensão
    const outputFileName = `${outputBaseName}_protegido_${sessionId}.pdf`;
    const outputFilePath = path.join(sessionPath, outputFileName);

    // Argumentos para qpdf
    const args = [
        '--encrypt',
        password, // user-password
        password, // owner-password (igual por simplicidade)
        '256',    // key-length (AES 256)
        '--',     // Marcador de fim das opções de encriptação
        inputFilePath,
        outputFilePath
    ];

    await runExec('qpdf', args);

    // Verifica se o arquivo de saída foi realmente criado
    if (!fs.existsSync(outputFilePath)) {
         throw new Error("Falha ao criar o arquivo PDF protegido.");
    }

    return outputFileName;
}


// --- Função Principal de Processamento ---

/**
 * Processa um job de acordo com a ferramenta e arquivos especificados.
 * @param {string} sessionId - ID da sessão.
 * @param {string} tool - Identificador da ferramenta (ex: 'comprimir-pdf').
 * @param {string[]} files - Array com nomes dos arquivos de entrada (com timestamp).
 * @param {object} [options={}] - Opções adicionais (ex: senha).
 * @returns {Promise<string>} - Nome do arquivo de saída gerado (relativo à pasta da sessão).
 * @throws {Error} - Se a ferramenta for desconhecida ou ocorrer um erro no processamento.
 */
async function processTool(sessionId, tool, files, options = {}) {
    const sessionPath = path.join(__dirname, '..', 'uploads', sessionId);
    // A maioria das ferramentas opera no primeiro arquivo, mas algumas (unir) usam 'files'
    const firstInputFileName = files && files.length > 0 ? files[0] : null;

    console.log(`[${sessionId}] Iniciando ferramenta '${tool}'...`);

    // Validação básica da sessão e arquivo principal (se aplicável)
    if (!fs.existsSync(sessionPath)) {
        console.error(`[${sessionId}] Erro: Diretório da sessão não encontrado: ${sessionPath}`);
        throw new Error("Diretório da sessão não encontrado.");
    }
    if (firstInputFileName && !fs.existsSync(path.join(sessionPath, firstInputFileName))) {
        console.error(`[${sessionId}] Erro: Arquivo principal não encontrado: ${firstInputFileName}`);
        throw new Error(`Arquivo principal '${firstInputFileName}' não encontrado na sessão.`);
    }

    try {
        let outputFileName;
        switch (tool) {
            case 'comprimir-pdf':
                 if (!firstInputFileName) throw new Error("Arquivo de entrada necessário para comprimir.");
                outputFileName = await comprimirPdf(sessionId, sessionPath, firstInputFileName, options);
                break;
            case 'proteger-pdf':
                 if (!firstInputFileName) throw new Error("Arquivo de entrada necessário para proteger.");
                outputFileName = await protegerPdf(sessionId, sessionPath, firstInputFileName, options);
                break;

            // --- Adicionar outros cases aqui conforme refatora ---
            // case 'unir-pdf':
            //     outputFileName = await unirPdfs(sessionId, sessionPath, files, options);
            //     break;
            // case 'docx-para-pdf':
            //     outputFileName = await docxParaPdf(sessionId, sessionPath, firstInputFileName, options);
            //     break;
            // case 'pdf-para-pdfa':
            //     outputFileName = await pdfParaPdfa(sessionId, sessionPath, firstInputFileName, options);
            //     break;
            // ... etc ...

            default:
                console.error(`[${sessionId}] Erro: Ferramenta desconhecida '${tool}'`);
                throw new Error(`Ferramenta '${tool}' desconhecida ou não implementada.`);
        }
        console.log(`[${sessionId}] Ferramenta '${tool}' concluída. Saída: ${outputFileName}`);
        return outputFileName; // Retorna apenas o nome do arquivo, não o caminho completo

    } catch (error) {
         // Log detalhado do erro vindo das funções de processamento
         console.error(`[${sessionId}] Falha ao processar '${tool}':`, error);
         // Repassa o erro para a rota tratar o status do job
         throw error; // Não precisa criar um novo Error aqui
    }
}

module.exports = {
    processTool
};