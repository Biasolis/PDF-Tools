Para refletir as mudanças que fizemos na interface, na arquitetura do Docker para Mac (ARM64) e na personalização do seu portfólio, preparei uma versão atualizada e profissional do `README.md`.

Você pode substituir o conteúdo do seu arquivo `README.md` por este:

---

# PDF & DOCX Tools 🛠️

Uma ferramenta poderosa e intuitiva para manipulação de arquivos PDF e conversão de documentos, desenvolvida com foco em produtividade e privacidade. Os arquivos são processados no servidor e removidos automaticamente após o uso.

## 🎨 Novidades da Versão

* **Identidade Visual Renovada**: Interface moderna em *Dark Mode* com efeitos de vidro (*glassmorphism*) e transições suaves.
* **Suporte ARM64 (Apple Silicon)**: Dockerfile otimizado para rodar nativamente em Macs M1/M2/M3 através do Chromium.
* **Preview de Arquivos**: Visualize e reordene páginas antes de unir seus PDFs.

## 🚀 Tecnologias Utilizadas

* **Backend**: Node.js com Express.
* **Frontend**: EJS, CSS3 (Variáveis e Glassmorphism) e JavaScript puro.
* **Processamento**: ImageMagick, Ghostscript e Puppeteer/Chromium.
* **Infraestrutura**: Docker & Docker Compose.

## 🛠️ Como Rodar o Projeto

### Pré-requisitos

* Docker e Docker Compose instalados.
* (Usuários Mac) Colima ou Docker Desktop ativo.

### Instalação

1. Clone o repositório:
```bash
git clone https://github.com/Biasolis/PDF-Tools.git
cd PDF-Tools

```


2. Suba os containers:
```bash
docker compose up -d --build

```


3. Acesse no navegador:
`http://localhost:3000`

## 📂 Funcionalidades

* **Unir PDFs**: Combine múltiplos arquivos com pré-visualização.
* **Comprimir**: Reduza o tamanho dos arquivos sem perda de legibilidade.
* **Conversão DOCX**: Converta de/para documentos Word com alta fidelidade.
* **Imagens**: Transforme PDFs em JPG ou combine PNG/JPG em PDF.
* **Separar**: Extraia páginas individuais de um PDF.

## 👤 Desenvolvedor

Desenvolvido por **[Leonardo Biasoli](https://www.google.com/search?q=https://leonardobiasoli.com.br)**.

---