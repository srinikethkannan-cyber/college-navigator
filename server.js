try { require('dotenv').config(); } catch (_) {}
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'system-prompt.md'),
  'utf8'
);

// --- Perplexity live-data detection ---

const LIVE_DATA_TRIGGERS = [
  /\bcurrent(ly)?\b/i,
  /\bright now\b/i,
  /\blatest\b/i,
  /\brecent(ly)?\b/i,
  /\bthis year\b/i,
  /\btoday\b/i,
  /\b202[4-9]\b/,
  /\baccept(ance)? rate\b/i,
  /\btuition\b/i,
  /\bcost of attendance\b/i,
  /\bhow much (does|is|will|would)\b/i,
  /\bdeadline(s)?\b/i,
  /\branking(s)?\b/i,
  /\bnil\b/i,
  /\btransfer portal\b/i,
  /\bncaa rule(s)?\b/i,
  /\brecruiting calendar\b/i,
  /\bscholarship amount(s)?\b/i,
  /\bfafsa (change|update|rule|deadline)\b/i,
  /\bfinancial aid (change|update|rule)\b/i,
  /\bwhat (are|is) (the|a) .{1,40} (rate|cost|fee|ranking|deadline)\b/i,
  /\bhow (much|many) .{1,40} (cost|charge|pay)\b/i,
];

function needsLiveData(text) {
  return LIVE_DATA_TRIGGERS.some((re) => re.test(text));
}

// --- Perplexity search ---

async function searchPerplexity(query) {
  if (!process.env.PERPLEXITY_API_KEY) return null;

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content:
              'You are a research assistant providing current, factual data about US college admissions, tuition and fees, rankings, NCAA/NAIA athletics, financial aid, and the Transfer Portal. Provide specific numbers, dates, and sources where possible. Be concise and factual.',
          },
          { role: 'user', content: query },
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error(`Perplexity ${res.status}:`, await res.text().catch(() => ''));
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('Perplexity error:', err.message);
    return null;
  }
}

// --- Chat endpoint ---

app.post('/api/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not configured. Set it as an environment variable and restart.',
    });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    // Grab the last user message text
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : lastUser?.content?.[0]?.text ?? '';

    // Optionally inject live Perplexity data
    let messagesForClaude = messages;

    if (needsLiveData(userText) && process.env.PERPLEXITY_API_KEY) {
      send({ type: 'searching', message: 'Searching live data...' });

      const liveData = await searchPerplexity(userText);

      if (liveData) {
        messagesForClaude = messages.map((msg, i) => {
          if (i !== messages.length - 1) return msg;
          const original =
            typeof msg.content === 'string'
              ? msg.content
              : msg.content?.[0]?.text ?? '';
          return {
            ...msg,
            content: `${original}\n\n[LIVE DATA from Perplexity search — current as of today]:\n${liveData}\n\nIncorporate this real-time data into your answer and note that it reflects current information.`,
          };
        });
      }
    }

    // Stream Claude response
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: messagesForClaude,
    });

    stream.on('text', (text) => send({ type: 'text', text }));

    stream.on('error', (err) => {
      send({ type: 'error', message: err.message });
      res.end();
    });

    await stream.done();
    if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
  } catch (err) {
    const msg = err?.error?.message ?? err?.message ?? 'Unknown server error';
    send({ type: 'error', message: msg });
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  College Navigator → http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn('  WARNING: ANTHROPIC_API_KEY not set\n');
  if (!process.env.PERPLEXITY_API_KEY) console.warn('  WARNING: PERPLEXITY_API_KEY not set — live search disabled\n');
});
