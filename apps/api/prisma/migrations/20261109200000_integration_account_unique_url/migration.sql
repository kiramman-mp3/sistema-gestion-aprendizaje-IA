-- Un sitio Moodle tiene una sola cuenta de integración.
CREATE UNIQUE INDEX "integration_accounts_moodle_base_url_key" ON "integration_accounts"("moodle_base_url");
