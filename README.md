# 📄 Ferramenta PDF Completa

![Demonstração da Ferramenta PDF](https://github.com/biasolis/pdf-tools/blob/main/public/images/layout.png)

Uma **aplicação web moderna e intuitiva** para manipulação de arquivos **PDF diretamente no navegador**.  
Todas as operações são realizadas **no lado do cliente**, garantindo que seus arquivos permaneçam **privados e seguros**, sem a necessidade de upload para servidores externos.

---

## ✨ Funcionalidades

Esta ferramenta oferece **três funcionalidades principais**:

- 🔗 **Unir PDFs** – combine múltiplos arquivos PDF em um único documento, na ordem que preferir.  
- 📉 **Comprimir PDF** – reduza o tamanho de arquivos PDF, ideal para otimizar armazenamento e compartilhamento. *(Funciona melhor em documentos com imagens)*.  
- 🔄 **Converter PDF para DOC** – extraia texto de um PDF e salve em um arquivo `.doc` (Word 97-2003).  
  ⚠️ *Limitação: imagens, tabelas e formatação complexa não são preservadas.*  

---

## 🚀 Tecnologias Utilizadas

### 🔹 Frontend
- **HTML5**  
- **CSS3**  
- [Tailwind CSS](https://tailwindcss.com/) – design moderno e responsivo  
- **JavaScript (ES6+)** – lógica e interatividade  

### 🔹 Manipulação de PDF
- [pdf-lib.js](https://pdf-lib.js.org/) – criação, modificação e união de PDFs  
- [PDF.js](https://mozilla.github.io/pdf.js/) – renderização e leitura de PDFs no navegador  

### 🔹 Infraestrutura
- **Docker** – empacotamento da aplicação  
- **Nginx** – servidor web leve para servir os arquivos estáticos  
- **Kubernetes** – orquestração e deploy em ambiente de produção  

---

## ⚙️ Como Executar o Projeto

Você pode executar a aplicação **localmente** ou via **Docker**.

### 🔹 1. Execução Local
Requer apenas um navegador web moderno.

```bash
# Clone o repositório
git clone https://github.com/Biasolis/PDF-Tools.git

# Acesse o diretório
cd ferramenta-pdf-online
