FROM dunglas/frankenphp:php8.4-alpine

# Set up extensions needed for Laravel and PostgreSQL
RUN install-php-extensions \
    pdo_pgsql \
    pgsql \
    pcntl \
    redis \
    gd \
    bcmath \
    intl \
    zip \
    mongodb

WORKDIR /app

# Copy application files
COPY . /app

# Configure FrankenPHP
ENV SERVER_NAME=":80"
