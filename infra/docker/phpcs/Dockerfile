# phpcs con el estándar de codificación de Moodle (moodlehq/moodle-cs).
FROM composer:2.11.0@sha256:278dfc7bd35169965d03f87194816f43bf4e6b6ea61707c2114e52ad12fe24ce
RUN composer global config --no-interaction allow-plugins.dealerdirect/phpcodesniffer-composer-installer true \
  && composer global require --no-interaction --no-progress moodlehq/moodle-cs:3.7.0
ENV PATH="/tmp/vendor/bin:${PATH}"
WORKDIR /app
ENTRYPOINT ["phpcs"]
