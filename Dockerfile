# --- Estágio 1: Build ---
# Começamos com uma imagem oficial do Node.js. Use a versão que você usa em desenvolvimento.
# node:18-alpine é uma boa escolha por ser leve.
FROM node:18-alpine

# Define o diretório de trabalho dentro do contêiner.
WORKDIR /app

# Copia os arquivos package.json e package-lock.json primeiro.
# Isso aproveita o cache do Docker: se esses arquivos não mudarem, o passo 'npm install' não será executado novamente.
COPY package*.json ./

# Instala as dependências do projeto definidas no package.json.
RUN npm install

# Copia o resto do código da sua aplicação para o diretório de trabalho.
COPY . .

# Expõe a porta em que sua aplicação está rodando.
# A porta 3000 é um padrão comum para Express.js. Verifique seu arquivo server.js!
EXPOSE 3000

# O comando para iniciar sua aplicação quando o contêiner for executado.
# Substitua 'server.js' pelo nome do seu arquivo de entrada principal, se for diferente.
CMD [ "node", "server.js" ]