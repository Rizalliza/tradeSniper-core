#!/usr/bin/env node
/**
 * Simple HTTP server for the TradeSniper webapp.
 *
 * Usage: node scripts/serve.js [--port 3000] [--host 127.0.0.1]
 *
 * Serves the webapp from /webapp with source modules from /src.
 * All imports resolve relative to project root.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 3000;
const hostIdx = args.indexOf('--host');
const host = hostIdx >= 0 ? args[hostIdx + 1] : '0.0.0.0';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.csv': 'text/csv',
    '.md': 'text/markdown; charset=utf-8',
};

function resolveUrl(url) {
    // Remove query string
    const cleanUrl = url.split('?')[0].split('#')[0];

    // Root path serves webapp index
    if (cleanUrl === '/' || cleanUrl === '') {
        return path.join(projectRoot, 'webapp', 'index.html');
    }

    // /webapp/* serves from webapp/
    if (cleanUrl.startsWith('/webapp/')) {
        return path.join(projectRoot, cleanUrl.slice(1));
    }

    // /src/* serves from src/ (for module imports)
    if (cleanUrl.startsWith('/src/')) {
        return path.join(projectRoot, cleanUrl.slice(1));
    }

    // /data/* serves from data/
    if (cleanUrl.startsWith('/data/')) {
        return path.join(projectRoot, cleanUrl.slice(1));
    }

    // Try webapp/ first, then root
    const webappPath = path.join(projectRoot, 'webapp', cleanUrl);
    if (fs.existsSync(webappPath)) return webappPath;

    return path.join(projectRoot, cleanUrl);
}

const server = http.createServer((req, res) => {
    try {
        const filePath = resolveUrl(req.url);

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        // Security: ensure file is within project root
        const realPath = fs.realpathSync(filePath);
        const realRoot = fs.realpathSync(projectRoot);
        if (!realPath.startsWith(realRoot)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        res.writeHead(500);
        res.end('Server Error: ' + err.message);
    }
});

server.listen(port, host, () => {
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  SNIPER AI // TERMINAL                   ║`);
    console.log(`╠══════════════════════════════════════════╣`);
    console.log(`║  Server running at http://${host}:${port}  ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);
    console.log(`Open http://${host}:${port} in your browser\n`);
});
