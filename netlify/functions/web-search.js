/**
 * Netlify Function - Web Search Proxy
 *
 * Proxies web search requests to the Geotab GenAI Gateway.
 *
 * Environment Variables (set in Netlify dashboard):
 *   GENAI_TOKEN - Your GenAI gateway JWT token (required)
 *   GENAI_URL - GenAI gateway URL (default: https://genai-us.geotab.com/api/v2)
 */

const https = require('https');

const GENAI_URL = process.env.GENAI_URL || 'https://genai-us.geotab.com/api/v2';
const GENAI_TOKEN = process.env.GENAI_TOKEN;

exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Check for token configuration
    if (!GENAI_TOKEN) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'GENAI_TOKEN environment variable not configured' })
        };
    }

    // Parse and validate request body
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
    }

    const { faultCode, faultName, query, prompt } = body;

    // Support both old format (query/prompt) and new format (faultCode/faultName)
    const searchQuery = query || `${faultCode} ${faultName}`;
    const searchPrompt = prompt || `You are an automotive expert. Search YouTube videos and Reddit discussions about this vehicle fault code: ${faultCode} - ${faultName}

Provide a summary of what real mechanics and vehicle owners say about:
1. Common causes they've found
2. DIY fixes that worked
3. Estimated repair costs mentioned
4. Tips and warnings from experience

Format your response in a helpful, practical way.`;

    if (!searchQuery || searchQuery === 'undefined undefined') {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'faultCode and faultName (or query and prompt) are required' })
        };
    }

    try {
        // Build request to GenAI Gateway
        const postData = JSON.stringify({
            model: 'claude-haiku-4.5',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: searchPrompt
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
            proxyReq.setTimeout(9000, () => {
                proxyReq.destroy();
                reject(new Error('Request timeout'));
            });

            proxyReq.write(postData);
            proxyReq.end();
        });

        return {
            statusCode: response.statusCode,
            headers,
            body: JSON.stringify(response.body)
        };

    } catch (error) {
        console.error('Error calling GenAI Gateway:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
};
