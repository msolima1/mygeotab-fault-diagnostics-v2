/**
 * Google Cloud Function - AI Fault Diagnostics Proxy
 *
 * Proxies requests to the Geotab GenAI Gateway for Claude API access.
 *
 * Environment Variables:
 *   GENAI_TOKEN - Your GenAI gateway JWT token (required)
 *   GENAI_URL - GenAI gateway URL (default: https://genai-us.geotab.com/api/v2)
 */

const https = require('https');

// GenAI Gateway config
const GENAI_URL = process.env.GENAI_URL || 'https://genai-us.geotab.com/api/v2';
const GENAI_TOKEN = process.env.GENAI_TOKEN;

/**
 * Cloud Function entry point
 * @param {Object} req - Cloud Functions request object
 * @param {Object} res - Cloud Functions response object
 */
exports.analyze = async (req, res) => {
    // CORS headers for MyGeotab Add-In access
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    // Only allow POST
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    // Check for token configuration
    if (!GENAI_TOKEN) {
        res.status(500).json({ error: 'GENAI_TOKEN environment variable not configured' });
        return;
    }

    // Validate request body
    const { prompt } = req.body || {};
    if (!prompt) {
        res.status(400).json({ error: 'prompt is required in request body' });
        return;
    }

    try {
        // Build request to GenAI Gateway
        const postData = JSON.stringify({
            model: 'claude-haiku-4.5',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: prompt
            }]
        });

        const gatewayUrl = new URL(GENAI_URL + '/chat/completions');

        const options = {
            hostname: gatewayUrl.hostname,
            port: 443,
            path: gatewayUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + GENAI_TOKEN,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        // Make request to GenAI Gateway
        const response = await new Promise((resolve, reject) => {
            const proxyReq = https.request(options, (proxyRes) => {
                let data = '';
                proxyRes.on('data', chunk => { data += chunk; });
                proxyRes.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ statusCode: proxyRes.statusCode, body: parsed });
                    } catch (e) {
                        reject(new Error('Invalid JSON response from GenAI Gateway'));
                    }
                });
            });

            proxyReq.on('error', reject);

            proxyReq.setTimeout(60000, () => {
                proxyReq.destroy();
                reject(new Error('Request timeout'));
            });

            proxyReq.write(postData);
            proxyReq.end();
        });

        res.status(response.statusCode).json(response.body);

    } catch (error) {
        console.error('Error calling GenAI Gateway:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
};
