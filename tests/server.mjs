import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
};

const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
        const filePath = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
        if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
            response.writeHead(403).end('Forbidden');
            return;
        }

        const contents = await readFile(filePath);
        response.writeHead(200, {
            'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        response.end(contents);
    } catch (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
    }
});

server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close());
