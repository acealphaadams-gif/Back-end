'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const http = require('http');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

/* ============================================================
   CONFIG — set these in Render's Environment tab
   ============================================================ */
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/* Optional: Notion integration */
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '';

const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:8080';
const PORT = process.env.PORT || 8080;

/* ============================================================
   DEEPSEEK CHAT
   ============================================================ */
async function deepseekChat(messages, options = {}) {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: options.model || DEEPSEEK_MODEL,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      stream: false
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'DeepSeek chat failed');
  return data.choices?.[0]?.message?.content || '(no answer)';
}

/* ============================================================
   WEB SEARCH (via DeepSeek)
   ============================================================ */
async function webSearch(query) {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: 'You are a research assistant. Answer with current, accurate information. Cite sources where possible.' },
        { role: 'user', content: query }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'DeepSeek web search failed');
  return { query, answer: data.choices?.[0]?.message?.content || '(no answer)' };
}

/* ============================================================
   NOTION LOGGING (optional)
   If NOTION_TOKEN and NOTION_DATABASE_ID are set, each chat
   exchange is logged to your Notion database.
   ============================================================ */
async function logToNotion(userMessage, aiAnswer) {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) return;
  try {
    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
          Name: {
            title: [{ text: { content: String(userMessage).slice(0, 100) } }]
          }
        },
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ text: { content: 'User: ' + String(userMessage).slice(0, 1900) } }] }
          },
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ text: { content: 'Alpha: ' + String(aiAnswer).slice(0, 1900) } }] }
          }
        ]
      })
    });
  } catch (e) {
    console.warn('Notion logging failed:', e.message);
  }
}

/* ============================================================
   ROUTES
   ============================================================ */
app.get('/', (req, res) => {
  res.json({ status: 'Alpha backend running', time: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    deepseek: Boolean(DEEPSEEK_API_KEY),
    notion: Boolean(NOTION_TOKEN && NOTION_DATABASE_ID),
    public_url: PUBLIC_URL
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, temperature, max_tokens } = req.body;
    if (!messages?.length) return res.status(400).json({ error: 'messages required' });
    const answer = await deepseekChat(messages, { temperature, max_tokens });

    /* Fire-and-forget Notion log */
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) logToNotion(lastUser.content, answer);

    res.json({ answer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    const result = await webSearch(query);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ============================================================
   START
   ============================================================ */
server.listen(PORT, () => {
  console.log(`\nAlpha backend on port ${PORT}`);
  console.log(`  Health:  ${PUBLIC_URL}/health`);
  console.log(`  Chat:    POST ${PUBLIC_URL}/api/chat`);
  console.log(`  Search:  POST ${PUBLIC_URL}/api/search\n`);
  if (!DEEPSEEK_API_KEY) console.warn('  ⚠ DEEPSEEK_API_KEY not set');
  if (!NOTION_TOKEN) console.warn('  ⚠ NOTION_TOKEN not set (logging disabled)');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});