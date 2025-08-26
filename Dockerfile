# Usa a imagem base do Node.js 18
FROM node:18-slim
WORKDIR /app

# Evita que o npm instale o Chromium, pois vamos instalar via apt-get
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Instala todas as dependências do sistema
RUN apt-get update && apt-get install -y \
    ghostscript \
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
    --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]