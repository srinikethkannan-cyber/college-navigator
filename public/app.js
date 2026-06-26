/* ──────────────────────────────────────────────────────────────
   College Navigator — Chat Interface
────────────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────────────
let conversationHistory = [];   // array of {role, content}
let currentUserName    = '';
let userInitial        = '?';
let isWaiting          = false; // true while waiting for AI response

// ── DOM refs ───────────────────────────────────────────────────
const intakeOverlay   = document.getElementById('intakeOverlay');
const intakeForm      = document.getElementById('intakeForm');
const intakeBtn       = document.getElementById('intakeBtn');
const intakeError     = document.getElementById('intakeError');
const chatApp         = document.getElementById('chatApp');
const chatMessages    = document.getElementById('chatMessages');
const chatInput       = document.getElementById('chatInput');
const sendBtn         = document.getElementById('sendBtn');
const chatStatus      = document.getElementById('chatStatus');
const sidebar         = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const menuBtn         = document.getElementById('menuBtn');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

// ── Configure marked ───────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupIntake();
  setupInput();
  setupSidebar();
  setupNewChatButtons();
  setupQuickPrompts();
});

// Pre-fill first name from Google profile once Firebase confirms auth
window.addEventListener('firebase:authed', (e) => {
  const firstName = e.detail?.user?.displayName?.split(' ')[0];
  const nameInput = document.getElementById('userName');
  if (firstName && nameInput && !nameInput.value) {
    nameInput.value = firstName;
  }
});

// ════════════════════════════════════════════════════════════════
//  INTAKE FORM
// ════════════════════════════════════════════════════════════════
function setupIntake() {
  intakeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const userType = document.getElementById('userType').value;
    const userGoal = document.getElementById('userGoal').value;
    const userName = document.getElementById('userName').value.trim();

    if (!userType || !userGoal || !userName) {
      intakeError.style.display = 'block';
      return;
    }
    intakeError.style.display = 'none';
    intakeBtn.disabled = true;
    intakeBtn.textContent = 'Starting your session…';

    currentUserName = userName;
    userInitial     = userName.charAt(0).toUpperCase();

    // Transition to chat
    intakeOverlay.style.display = 'none';
    chatApp.removeAttribute('hidden');

    // Personalized greeting via AI
    const introMsg = buildIntroMessage(userName, userType, userGoal);
    await sendMessage(introMsg, /* hidden */ true);
  });

  // Hide error on any change
  ['userType', 'userGoal', 'userName'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      intakeError.style.display = 'none';
    });
    document.getElementById(id)?.addEventListener('input', () => {
      intakeError.style.display = 'none';
    });
  });
}

/**
 * Constructs the hidden intake message that prompts
 * the AI to greet the user personally and dive straight in.
 */
function buildIntroMessage(name, userType, goal) {
  const goalContext = {
    'Athletic Recruiting':
      `Ask ${name} what sport they play, their position, graduation year, and what division level they're targeting.`,
    'College Search':
      `Ask ${name} about their current GPA, any test scores, state, rough major interest, and budget priorities.`,
    'Financial Aid':
      `Ask ${name} for the rough household income range and which schools they're comparing, or whether they're still building a list.`,
    'Major & Career Exploration':
      `Ask ${name} what they actually enjoy doing day-to-day and what they want their life to look like in 10 years — don't let them just name a major.`,
    'Admissions Strategy':
      `Ask ${name} what their current stats are (GPA, tests), what schools are on their radar, and what application round they're planning for.`,
    'Transfer Planning':
      `Ask ${name} where they're currently enrolled, why they want to transfer, and whether they're a student-athlete with remaining eligibility.`,
    'All of the above':
      `Ask ${name} what feels most urgent right now so you can start with the highest priority.`,
  };

  const followUp = goalContext[goal] ||
    `Ask ${name} the most important clarifying question to help them with ${goal}.`;

  return (
    `My name is ${name}. I'm a ${userType} and I need help with: ${goal}. ` +
    `Greet me warmly by name, acknowledge my situation in one sentence, then immediately ask me a targeted follow-up question to get started. ` +
    `${followUp} ` +
    `Keep your opening message to 2–3 sentences max — be direct, not generic. Do not list everything you can help with.`
  );
}

// ════════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ════════════════════════════════════════════════════════════════
async function sendMessage(content, hidden = false) {
  if (isWaiting || !content.trim()) return;

  isWaiting = true;
  setInputEnabled(false);
  updateStatus('Thinking…');

  // Push to history
  conversationHistory.push({ role: 'user', content });

  // Show user bubble (unless this is the hidden intake message)
  if (!hidden) appendUserBubble(content);

  // Stream AI response
  await streamResponse();
}

// ════════════════════════════════════════════════════════════════
//  STREAM RESPONSE (SSE)
// ════════════════════════════════════════════════════════════════
async function streamResponse() {
  let searchingEl  = null;
  let aiBubble     = null;
  let accumulated  = '';

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: conversationHistory }),
    });

    if (!res.ok) {
      let errMsg = 'Request failed';
      try { const j = await res.json(); errMsg = j.error || errMsg; } catch {}
      throw new Error(errMsg);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;

        let event;
        try { event = JSON.parse(raw); } catch { continue; }

        switch (event.type) {

          case 'searching':
            searchingEl = appendSearchingIndicator();
            updateStatus('Searching live data…');
            break;

          case 'text':
            if (searchingEl) {
              searchingEl.remove();
              searchingEl = null;
            }
            if (!aiBubble) {
              aiBubble = appendAIBubble();
            }
            accumulated += event.text;
            renderStreaming(aiBubble, accumulated);
            scrollBottom();
            updateStatus('Thinking…');
            break;

          case 'error':
            if (searchingEl) { searchingEl.remove(); searchingEl = null; }
            appendErrorBubble(event.message || 'Something went wrong.');
            break;
        }
      }
    }

    // Finalize: full markdown render + save to history
    if (aiBubble && accumulated) {
      finalizeAIBubble(aiBubble, accumulated);
      conversationHistory.push({ role: 'assistant', content: accumulated });
    }

  } catch (err) {
    if (searchingEl) searchingEl.remove();
    appendErrorBubble(err.message || 'Could not reach the server.');
  } finally {
    isWaiting = false;
    setInputEnabled(true);
    updateStatus('<span class="status-dot"></span>Ready to help');
    chatInput.focus();
  }
}

// ════════════════════════════════════════════════════════════════
//  DOM HELPERS — messages
// ════════════════════════════════════════════════════════════════
function appendUserBubble(content) {
  const row = document.createElement('div');
  row.className = 'msg-row msg-row--user';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar msg-avatar--user';
  avatar.textContent = userInitial;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--user';
  bubble.textContent = content;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  scrollBottom();
}

function appendAIBubble() {
  const row = document.createElement('div');
  row.className = 'msg-row msg-row--ai';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar msg-avatar--ai';
  avatar.innerHTML = `
    <svg viewBox="0 0 32 32" fill="none" width="16" height="16">
      <path d="M16 3 3 10l13 7 13-7-13-7z" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M3 22l13 7 13-7" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M3 16l13 7 13-7" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
    </svg>`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--ai msg-bubble--streaming';

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  scrollBottom();
  return bubble;
}

function renderStreaming(bubble, text) {
  // Strip the injected live-data block so it never shows in the bubble
  const clean = text.replace(
    /\n\n\[LIVE DATA from Perplexity search[^\]]*\]:[\s\S]*$/,
    ''
  );
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(clean));
}

function finalizeAIBubble(bubble, text) {
  const clean = text.replace(
    /\n\n\[LIVE DATA from Perplexity search[^\]]*\]:[\s\S]*$/,
    ''
  );
  bubble.classList.remove('msg-bubble--streaming');
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(clean));
  scrollBottom();
}

function appendSearchingIndicator() {
  const row = document.createElement('div');
  row.className = 'searching-row';

  row.innerHTML = `
    <div class="msg-avatar msg-avatar--ai">
      <svg viewBox="0 0 32 32" fill="none" width="16" height="16">
        <path d="M16 3 3 10l13 7 13-7-13-7z" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M3 22l13 7 13-7" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M3 16l13 7 13-7" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="searching-pill">
      <div class="searching-spinner"></div>
      <svg class="searching-icon" viewBox="0 0 24 24" fill="none" width="13" height="13">
        <circle cx="11" cy="11" r="7.5" stroke="currentColor" stroke-width="2"/>
        <path d="m21 21-4.5-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Searching live data…
    </div>`;

  chatMessages.appendChild(row);
  scrollBottom();
  return row;
}

function appendErrorBubble(message) {
  const row = document.createElement('div');
  row.className = 'error-row';
  row.innerHTML = `
    <div class="error-bubble">
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span>${escapeHTML(message)}</span>
    </div>`;
  chatMessages.appendChild(row);
  scrollBottom();
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scrollBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ════════════════════════════════════════════════════════════════
//  INPUT HANDLING
// ════════════════════════════════════════════════════════════════
function setupInput() {
  // Enable/disable send button based on input
  chatInput.addEventListener('input', () => {
    sendBtn.disabled = !chatInput.value.trim() || isWaiting;
    autoResize();
  });

  // Send on Enter (Shift+Enter for newline)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);
}

function handleSend() {
  const text = chatInput.value.trim();
  if (!text || isWaiting) return;
  chatInput.value = '';
  autoResize();
  sendBtn.disabled = true;
  sendMessage(text, false);
}

function autoResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
}

function setInputEnabled(on) {
  chatInput.disabled = !on;
  sendBtn.disabled   = !on;
  if (on) {
    sendBtn.disabled = !chatInput.value.trim();
  }
}

function updateStatus(html) {
  chatStatus.innerHTML = html;
}

// ════════════════════════════════════════════════════════════════
//  SIDEBAR
// ════════════════════════════════════════════════════════════════
function setupSidebar() {
  menuBtn?.addEventListener('click', openSidebar);
  sidebarCloseBtn?.addEventListener('click', closeSidebar);
  sidebarBackdrop?.addEventListener('click', closeSidebar);
}

function openSidebar() {
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
  document.body.style.overflow = '';
}

// ════════════════════════════════════════════════════════════════
//  QUICK PROMPTS
// ════════════════════════════════════════════════════════════════
function setupQuickPrompts() {
  document.querySelectorAll('.qp').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      if (!prompt || isWaiting) return;
      closeSidebar();
      chatInput.value = prompt;
      autoResize();
      sendBtn.disabled = false;
      handleSend();
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  NEW CHAT
// ════════════════════════════════════════════════════════════════
function setupNewChatButtons() {
  document.getElementById('newChatSidebar')?.addEventListener('click', confirmNewChat);
  document.getElementById('newChatHeader')?.addEventListener('click', confirmNewChat);
}

function confirmNewChat() {
  if (conversationHistory.length > 0) {
    if (!confirm('Start a new conversation? This will clear the current chat.')) return;
  }
  resetChat();
}

function resetChat() {
  conversationHistory = [];
  chatMessages.innerHTML = '';
  closeSidebar();

  // Return to intake screen
  chatApp.setAttribute('hidden', '');
  intakeOverlay.style.display = 'flex';
  intakeBtn.disabled = false;
  intakeBtn.textContent = 'Start My Session →';
  intakeForm.reset();
  updateStatus('<span class="status-dot"></span>Ready to help');
}
