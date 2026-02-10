# Dockerfile atualizado
FROM node:18-bookworm

WORKDIR /app

# Instala todas as dependências do sistema usando Chromium em vez de Google Chrome
RUN apt-get update && apt-get install -y \
    ghostscript \
    poppler-utils \
    imagemagick \
    wget \
    gnupg \
    ca-certificates \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libasound2 \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i 's/<policy domain="coder" rights="none" pattern="PDF" \/>//g' /etc/ImageMagick-6/policy.xml

# Variáveis de ambiente para o Puppeteer encontrar o Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]