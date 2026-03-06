# specspb-modern (HTML/CSS + админка)

Проект делает современную лаконичную витрину каталога **на выходе в виде статических HTML/CSS**, с:

- человеко‑понятными URL
- корректными `title`/`description`/заголовками
- `canonical` на каждой странице
- генерацией `sitemap.xml` и `robots.txt`
- админкой на `/admin/` (Decap CMS)
- импортом контента со старого сайта `specspb.com/?p=...` и генерацией 301‑редиректов

## Требования

- Node.js LTS (нужен для сборки и импорта)

## Команды

Установка:

```bash
npm install
```

Сборка:

```bash
npm run build
```

Локальная разработка:

```bash
npm run dev
```

Импорт контента со старого сайта:

```bash
npm run import:specspb
```

После импорта:

- товары будут в `src/products/*.md`
- картинки/файлы будут скачаны в `src/imgs/**` и `src/fls/**` (с сохранением путей)
- карта редиректов будет в `redirects/`:
  - `redirects/p-map.json`
  - `redirects/nginx-p-redirects.conf`
  - `redirects/apache-legacy-p.htaccess`

## Админка

Админка лежит в `src/admin/` и публикуется как `/admin/`.

Файл конфигурации: `src/admin/config.yml`.

### Быстрый вариант (рекомендуется): DecapBridge

DecapBridge даёт “готовую” авторизацию для Decap CMS (и управление пользователями), без Netlify Identity.

- Зарегистрируйтесь и добавьте сайт: `https://decapbridge.com/docs/getting-started`
- Возьмите сгенерированный блок `backend:` и вставьте его в `src/admin/config.yml`

### Деплой на nic.ru

Инструкция: `docs/NICRU_DEPLOY.md`.

