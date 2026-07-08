import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json',
    '.wasm': 'application/wasm',
};

createServer((request, response) => {
    if (request.url === '/api/value') {
        response.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'text/plain',
        });
        response.end('browser');
        return;
    }

    const pathname =
        request.url === '/' ? '/test/browser/index.html' : request.url;
    const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, relative);
    try {
        const stat = statSync(file);
        if (!stat.isFile()) {
            throw new Error('not a file');
        }
        response.writeHead(200, {
            'Content-Type':
                contentTypes[extname(file)] ?? 'application/octet-stream',
        });
        createReadStream(file).pipe(response);
    } catch {
        response.writeHead(404);
        response.end('Not found');
    }
}).listen(4173, '127.0.0.1');
