# --- Estágio 1: Construção ---
# Usamos a imagem oficial e leve do Nginx baseada no Alpine Linux.
FROM nginx:stable-alpine

# Define o diretório de trabalho dentro do contêiner.
# Este é o diretório padrão onde o Nginx procura por arquivos para servir.
WORKDIR /usr/share/nginx/html

# Remove o arquivo de boas-vindas padrão do Nginx.
RUN rm /usr/share/nginx/html/index.html

# Copia todos os arquivos da sua pasta de projeto (o '.') para o diretório de trabalho no contêiner.
# Suas pastas 'css/' e 'js/' e o arquivo 'index.html' serão copiados.
COPY . .

# Expõe a porta 80, que é a porta padrão que o Nginx usa para HTTP.
EXPOSE 80

# O comando para iniciar o servidor Nginx quando o contêiner for executado.
# A imagem base do Nginx já cuida disso, então não precisamos de um CMD explícito.