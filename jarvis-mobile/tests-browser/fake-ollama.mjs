// Ollama, as far as a browser can tell: /api/tags, /v1/models, and a
// streaming /v1/chat/completions. CORS exactly as Ollama sends it when
// OLLAMA_ORIGINS allows the caller.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 11434);
const ORIGINS = process.env.ALLOW ?? '*';
const MODELS = ['qwen2.5-coder:1.5b', 'llama3.2:3b', 'nomic-embed-text:latest'];

http.createServer((req, res) => {
  const origin = req.headers.origin;
  const allowed = ORIGINS === '*' || ORIGINS.split(',').includes(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403).end(); return; }
  const url = new URL(req.url, 'http://x');
  const json = (body) => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };

  if (url.pathname === '/api/tags') return json({ models: MODELS.map((name) => ({ name, size: 1e9 })) });
  if (url.pathname === '/v1/models') return json({ data: MODELS.map((id) => ({ id, object: 'model' })) });
  if (url.pathname === '/v1/chat/completions') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const words = ['Estou ', 'rodando ', 'na ', 'sua ', 'máquina.'];
    let i = 0;
    const tick = setInterval(() => {
      if (i >= words.length) {
        res.write('data: [DONE]\n\n'); clearInterval(tick); res.end(); return;
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] } }] })}\n\n`);
    }, 40);
    return;
  }
  res.writeHead(404, {'Content-Type':'application/json'}).end('{"error":"not found"}');
}).listen(PORT, '127.0.0.1', () => console.log('ollama falso em ' + PORT));
