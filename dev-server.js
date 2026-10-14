/**
 * Local Development Server for MyGeotab Add-In v2
 *
 * This creates a simple HTTP server with integrated AI proxy
 * for testing the add-in locally before deploying.
 *
 * Usage: node dev-server.js
 * Then open: http://localhost:8080
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const ADDIN_DIR = path.join(__dirname, 'addin');

// Load GenAI gateway credentials from ~/genai.json
let genaiConfig = null;
try {
    const genaiPath = path.join(os.homedir(), 'genai.json');
    genaiConfig = JSON.parse(fs.readFileSync(genaiPath, 'utf8'));
    console.log('GenAI gateway configured:', genaiConfig.base_url);
} catch (e) {
    console.warn('GenAI gateway not configured. Create ~/genai.json with token and base_url');
}

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

// Web search function using Google Custom Search (simulated with scraping for dev)
async function searchWebForFault(faultCode, faultName) {
    const query = encodeURIComponent(`${faultCode} ${faultName} fix solution`);

    // Search YouTube and Reddit via GenAI to summarize findings
    const searchPrompt = `Search the web for information about vehicle fault code "${faultCode}" (${faultName}).

Focus on:
1. YouTube videos about diagnosing and fixing this fault code
2. Reddit discussions (r/MechanicAdvice, r/Cartalk, r/AskMechanics) about this issue

Provide a concise summary (3-5 bullet points) of:
- Common causes mentioned by mechanics and DIYers
- Recommended diagnostic steps from video tutorials
- Real-world fixes that worked for people
- Estimated repair costs mentioned
- Any warnings or things to avoid

Keep each point brief (1 sentence). Focus on practical, actionable advice from real people's experiences.`;

    return searchPrompt;
}

const server = http.createServer((req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Proxy for Claude API via GenAI Gateway
    if (req.url === '/api/claude' && req.method === 'POST') {
        if (!genaiConfig) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'GenAI gateway not configured. Create ~/genai.json' }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { prompt } = JSON.parse(body);

                // GenAI gateway uses OpenAI-compatible format
                const postData = JSON.stringify({
                    model: 'claude-haiku-4.5',
                    max_tokens: 2048,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                });

                const gatewayUrl = new URL(genaiConfig.base_url + '/chat/completions');

                const options = {
                    hostname: gatewayUrl.hostname,
                    port: 443,
                    path: gatewayUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + genaiConfig.token,
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                console.log('Calling GenAI gateway:', gatewayUrl.href);

                const proxyReq = https.request(options, (proxyRes) => {
                    let data = '';
                    proxyRes.on('data', chunk => { data += chunk; });
                    proxyRes.on('end', () => {
                        console.log('GenAI response status:', proxyRes.statusCode);
                        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(data);
                    });
                });

                proxyReq.on('error', (e) => {
                    console.error('GenAI request error:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                });

                proxyReq.setTimeout(60000, () => {
                    console.error('GenAI request timeout');
                    proxyReq.destroy();
                    res.writeHead(504, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request timeout' }));
                });

                proxyReq.write(postData);
                proxyReq.end();
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Web search endpoint for YouTube/Reddit insights
    if (req.url === '/api/web-search' && req.method === 'POST') {
        if (!genaiConfig) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'GenAI gateway not configured' }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { faultCode, faultName } = JSON.parse(body);

                const searchPrompt = `You are a helpful automotive research assistant. Search your knowledge for information about vehicle fault code "${faultCode}" (${faultName}).

Summarize what YouTube mechanics and Reddit communities (r/MechanicAdvice, r/Cartalk, r/AskMechanics) typically say about this fault code.

Provide exactly 4-5 bullet points covering:
• Common real-world causes mentioned by DIYers and mechanics
• Popular diagnostic steps from video tutorials
• Fixes that worked for people (from Reddit success stories)
• Typical repair costs mentioned by the community
• Warnings or common mistakes to avoid

Keep each bullet point to ONE short sentence. Be practical and specific.`;

                const postData = JSON.stringify({
                    model: 'claude-haiku-4.5',
                    max_tokens: 1024,
                    messages: [{
                        role: 'user',
                        content: searchPrompt
                    }]
                });

                const gatewayUrl = new URL(genaiConfig.base_url + '/chat/completions');

                const options = {
                    hostname: gatewayUrl.hostname,
                    port: 443,
                    path: gatewayUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + genaiConfig.token,
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                console.log('Web search for:', faultCode, faultName);

                const proxyReq = https.request(options, (proxyRes) => {
                    let data = '';
                    proxyRes.on('data', chunk => { data += chunk; });
                    proxyRes.on('end', () => {
                        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(data);
                    });
                });

                proxyReq.on('error', (e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                });

                proxyReq.setTimeout(60000, () => {
                    proxyReq.destroy();
                    res.writeHead(504, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request timeout' }));
                });

                proxyReq.write(postData);
                proxyReq.end();
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Static file serving from addin folder
    let filePath = req.url === '/' ? '/dev.html' : req.url;
    filePath = filePath.split('?')[0]; // Remove query string
    filePath = path.join(ADDIN_DIR, filePath);

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found: ' + req.url);
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`\nMyGeotab Add-In Development Server v2`);
    console.log(`Running at: http://localhost:${PORT}`);
    console.log(`\nInstructions:`);
    console.log(`1. Open http://localhost:${PORT} in your browser`);
    console.log(`2. Log into alpha.geotab.com/g560 in another tab`);
    console.log(`3. Get session ID from DevTools: JSON.parse(localStorage.getItem('geotabAPI_credentials')).sessionId`);
    console.log(`4. Paste session ID in the login form`);
    console.log(`\nNote: You're connecting to a REAL MyGeotab database.\n`);
});
