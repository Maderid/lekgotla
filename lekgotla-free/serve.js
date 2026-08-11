/**
 * A tiny static file server for working on the site locally.
 *
 * You need this because browsers refuse to load ES modules from a file:// URL,
 * so double-clicking index.html will not work. It is a development convenience
 * only — the deployed site needs no server at all.
 *
 *   node serve.js        then open http://localhost:8000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

http
  .createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, relative);

    // Never serve anything outside the project folder.
    if (!file.startsWith(ROOT)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      });
      response.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Lekgotla running on http://localhost:${PORT}`);
  });
