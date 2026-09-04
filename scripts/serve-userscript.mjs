import { createReadStream, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

function readOption(name, fallback) {
    const prefix = `--${name}=`;
    const argument = process.argv.slice(2).find(value => value.startsWith(prefix));
    return argument ? argument.slice(prefix.length) : fallback;
}

const host = readOption('host', '0.0.0.0');
const port = Number(readOption('port', '3000'));
const fileName = basename(readOption('file', 'better-xcloud.user.js'));
const distDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const userscriptPath = resolve(distDirectory, fileName);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
}
if (!fileName.endsWith('.user.js') || !existsSync(userscriptPath)) {
    throw new Error(`Userscript not found: ${userscriptPath}. Build the full variant first.`);
}

const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname === `/${fileName}`) {
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/javascript; charset=utf-8',
        });
        createReadStream(userscriptPath).pipe(response);
        return;
    }

    if (requestUrl.pathname !== '/') {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found\n');
        return;
    }

    response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Better xCloud local install</title>
<style>
body{font:18px system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.25rem;background:#101214;color:#f5f5f5}
a{display:inline-block;padding:.8rem 1rem;border-radius:.5rem;background:#107c10;color:white;font-weight:700;text-decoration:none}
</style>
<h1>Better xCloud</h1>
<p>Open this page on Quest and install the userscript without copying it through the clipboard.</p>
<p><a href="/${fileName}">Install ${fileName}</a></p>
<p>Keep this terminal and the Mac on the same local network while installing.</p>
</html>\n`);
});

server.listen(port, host, () => {
    console.log(`Serving ${userscriptPath}`);
    console.log(`Local: http://127.0.0.1:${port}/`);

    for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses || []) {
            if (address.family === 'IPv4' && !address.internal) {
                console.log(`Quest: http://${address.address}:${port}/`);
            }
        }
    }

    console.log('Press Ctrl+C to stop.');
});
