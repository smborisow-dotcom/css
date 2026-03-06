# Деплой на nic.ru (статический сайт)

Этот проект собирается в статические файлы (`dist/`). На nic.ru нужно заливать **содержимое** `dist/` в корень сайта.

## Вариант 1 — Автодеплой через GitHub Actions (рекомендуется)

В репозитории уже добавлены 2 workflow:

- `deploy-nicru-sftp.yml` — деплой по SFTP (предпочтительно)
- `deploy-nicru-ftp.yml` — деплой по FTP (если SFTP недоступен)

### 1) Выберите один способ

Если используете SFTP — оставьте `deploy-nicru-sftp.yml`, а `deploy-nicru-ftp.yml` удалите или отключите.

Если используете FTP — наоборот.

### 2) Добавьте секреты репозитория (GitHub → Settings → Secrets and variables → Actions)

Также добавьте:

- `SITE_URL` — полный URL сайта (например `https://ваш-домен.ru`). Он используется для `canonical`, `sitemap.xml` и `robots.txt`.

#### Для SFTP

- `NICRU_SFTP_HOST` — хост (например `example.ru` или `sftp.example.ru`)
- `NICRU_SFTP_PORT` — порт (обычно `22`)
- `NICRU_SFTP_USER` — логин
- `NICRU_SFTP_KEY` — приватный ключ (OpenSSH)
- `NICRU_SFTP_REMOTE_DIR` — удалённая папка сайта (например `/www/` или `/public_html/`)

#### Для FTP

- `NICRU_FTP_HOST` — хост FTP
- `NICRU_FTP_USER` — логин
- `NICRU_FTP_PASSWORD` — пароль
- `NICRU_FTP_REMOTE_DIR` — удалённая папка сайта (например `/www/` или `/public_html/`)

### 3) Как работает деплой

На каждый push в `main`:

- ставятся зависимости
- собирается сайт (`npm run build`)
- содержимое `dist/` заливается на nic.ru

## Вариант 2 — Ручная выгрузка

Локально:

```bash
npm install
npm run build
```

Дальше залейте **содержимое** папки `dist/` на nic.ru (FTP/SFTP).

## Важно про редиректы `?p=...`

Файл `.htaccess` лежит в `src/.htaccess` и попадает в `dist/.htaccess`.

После выполнения импорта `npm run import:specspb` он автоматически перезаписывается полным набором 301‑правил со старых URL `/?p=...` на новые человеко‑понятные.

