# Usa a imagem base do Node.js 18
FROM node:18-slim
WORKDIR /app

# Define o usuário não-root
ARG NODE_USER=nodeuser
RUN useradd -m ${NODE_USER}

# Instala sudo e adiciona nodeuser ao grupo sudo (pode ser necessário para xvfb-run)
# Considerar remover se não for estritamente necessário por segurança
# RUN apt-get update && apt-get install -y sudo && \
#     echo "${NODE_USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Define o diretório home para o Puppeteer e outras configs XDG
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV XDG_CONFIG_HOME=/home/${NODE_USER}/.config

# Instala todas as dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    poppler-utils \
    imagemagick \
    libreoffice \
    xvfb \
    xauth \
    qpdf \
    wget \
    gnupg \
    ca-certificates \
    # Fontes essenciais para LibreOffice/Chrome
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    # Dependências gráficas/runtime
    libxss1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libasound2 \
    # Instala Chrome
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    # Limpeza
    && apt-get purge --auto-remove -y wget gnupg \
    && rm -rf /var/lib/apt/lists/* \
    # Remove restrição do ImageMagick para PDF (ajuste se usar política mais restrita)
    && sed -i 's/<policy domain="coder" rights="none" pattern="PDF" \/>//g' /etc/ImageMagick-6/policy.xml \
    # Cria diretórios necessários e ajusta permissões ANTES de copiar arquivos
    && mkdir -p /app/uploads /app/documents /home/${NODE_USER}/.config \
    && chown -R ${NODE_USER}:${NODE_USER} /app \
    && chown -R ${NODE_USER}:${NODE_USER} /home/${NODE_USER}

# Copia arquivos de definição de dependências com permissão correta
COPY --chown=${NODE_USER}:${NODE_USER} package*.json ./

# Muda para usuário não-root ANTES do npm install
USER ${NODE_USER}

# Instala dependências do Node.js
RUN npm install

# Copia o restante do código da aplicação com permissão correta
COPY --chown=${NODE_USER}:${NODE_USER} . .

# Expõe a porta e define o comando padrão
EXPOSE 3000
CMD ["node", "server.js"]