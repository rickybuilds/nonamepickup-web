import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.pak': 'application/octet-stream', '.spr': 'application/octet-stream', '.data': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };
const port = Number(process.env.NONAME_PREVIEW_PORT || 4173);

http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      const upstream = await fetch(`https://nonamepickup.servehalflife.com${url.pathname}${url.search}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const filename = resolve(root, `.${relative}`);
    const extension = extname(filename);
    const type = types[extension] || (extension === '.pk3' || /^\.part\d+$/.test(extension) ? 'application/octet-stream' : null);
    if (!filename.startsWith(`${root}${sep}`) || !type) { response.writeHead(404); response.end('Not found'); return; }
    const data = await readFile(filename);
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 502, { 'Content-Type': 'text/plain' });
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Preview data unavailable');
  }
}).listen(port, '127.0.0.1', () => console.log(`NoName preview: http://127.0.0.1:${port}/refactor/`));
