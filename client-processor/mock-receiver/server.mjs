/**
 * Mock Receiver Server
 * 
 * A simple server that receives and logs the payloads
 * sent by the Client Processor backend.
 * 
 * Run this to test the full flow without a real target API.
 * 
 * Usage:
 *   node server.mjs
 * 
 * The server listens on port 9999 by default.
 */

import http from 'http';

const PORT = 9999;

// Store received payloads for inspection
const receivedPayloads = [];

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', payloadsReceived: receivedPayloads.length }));
    return;
  }

  // View received payloads
  if (req.method === 'GET' && req.url === '/payloads') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(receivedPayloads, null, 2));
    return;
  }

  // Receive results endpoint
  if (req.method === 'POST' && req.url === '/api/receive-results') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const receivedAt = new Date().toISOString();
        
        // Store payload
        receivedPayloads.push({
          receivedAt,
          payload
        });

        // Log to console
        console.log('\n' + '='.repeat(60));
        console.log('📥 PAYLOAD RECEIVED');
        console.log('='.repeat(60));
        console.log(`Time: ${receivedAt}`);
        console.log(`Client URL: ${payload.clientUrl}`);
        console.log(`Status: ${payload.status}`);
        console.log(`Processing Duration: ${payload.details?.metadata?.processingDuration}ms`);
        console.log('-'.repeat(60));
        console.log('Full Payload:');
        console.log(JSON.stringify(payload, null, 2));
        console.log('='.repeat(60) + '\n');

        // Send success response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Payload received and logged',
          receivedAt,
          totalReceived: receivedPayloads.length
        }));
      } catch (error) {
        console.error('Failed to parse payload:', error.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON payload'
        }));
      }
    });
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    availableEndpoints: [
      'GET /health',
      'GET /payloads',
      'POST /api/receive-results'
    ]
  }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           MOCK RECEIVER SERVER STARTED                     ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Port: ${PORT}                                               ║`);
  console.log('║                                                            ║');
  console.log('║  Endpoints:                                                ║');
  console.log('║    POST /api/receive-results  - Receive payload            ║');
  console.log('║    GET  /health               - Health check               ║');
  console.log('║    GET  /payloads             - View received payloads     ║');
  console.log('║                                                            ║');
  console.log('║  Waiting for incoming payloads...                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});

