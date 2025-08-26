# Use Node 18
FROM node:18

# Diretório de trabalho
WORKDIR /app

# Atualiza pacotes e instala Ghostscript
RUN apt-get update && apt-get install -y \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Copia package.json e package-lock.json e instala dependências
COPY package*.json ./
RUN npm install

# Copia o restante do código
COPY . .

# Exponha a porta interna do Node
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["node", "server.js"]
