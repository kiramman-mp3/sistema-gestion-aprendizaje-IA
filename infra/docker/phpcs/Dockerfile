# phpcs con el estándar de codificación de Moodle (moodlehq/moodle-cs).
FROM composer:2.11.0
RUN composer global config --no-interaction allow-plugins.dealerdirect/phpcodesniffer-composer-installer true \
  && composer global require --no-interaction --no-progress moodlehq/moodle-cs:3.7.0
ENV PATH="/tmp/vendor/bin:${PATH}"
WORKDIR /app
ENTRYPOINT ["phpcs"]
