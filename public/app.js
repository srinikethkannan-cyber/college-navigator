/* ──────────────────────────────────────────────────────────────
   College Navigator — Chat Interface
────────────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────────────
let conversationHistory = [];
let currentUserName    = '';
let userInitial        = '?';
let isWaiting          = false;
let currentSessionId   = null;
let currentUserId      = null;

// Multi-step intake state
let intakeData = {
  userType:         '',
  goals:            [],
  sport:            '',
  division:         '',
  gpa:              '3.5',
  testType:         'SAT',
  testScore:        '',
  semesters:        [],
  schoolTypes:      [],
  budget:           '40000',
  name:             '',
  major:            '',
  transferFrom:     '',
  creditsCompleted: '0',
  geoPreference:    '',
  envPreference:    [],
};

// Speech
let recognition    = null;
let micListening   = false;

// ── DOM refs ───────────────────────────────────────────────────
const intakeOverlay   = document.getElementById('intakeOverlay');
const intakeError     = document.getElementById('intakeError');
const chatApp         = document.getElementById('chatApp');
const chatMessages    = document.getElementById('chatMessages');
const chatInput       = document.getElementById('chatInput');
const sendBtn         = document.getElementById('sendBtn');
const micBtn          = document.getElementById('micBtn');
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
  setupSpeech();
});

// Pre-fill first name from Google profile once Firebase confirms auth
window.addEventListener('firebase:authed', async (e) => {
  const firstName = e.detail?.user?.displayName?.split(' ')[0];
  const nameInput = document.getElementById('userName');
  if (firstName && nameInput && !nameInput.value) {
    nameInput.value = firstName;
  }
  currentUserId = e.detail?.user?.uid;
  currentUserName = firstName || '';
  userInitial = (firstName?.[0] || '?').toUpperCase();
  document.querySelectorAll('.msg-avatar--user').forEach(a => a.textContent = userInitial);
await loadChatSessions();

  // Handle URL params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('new')) { resetChat(); return; }
  const sessionId = urlParams.get('session');
  if (sessionId && currentUserId) {
    setTimeout(async () => {
      try {
        const { db, getDoc, doc } = window.firebaseDB;
        const snap = await getDoc(doc(db, 'users', currentUserId, 'sessions', sessionId));
        if (snap.exists()) {
          await loadSession({ id: snap.id, ...snap.data() });
        }
      } catch(e) {
        console.error('Session load error:', e);
      }
    }, 1500);
  }
});
window.addEventListener('session:preloaded', async (e) => {
  await loadSession(e.detail);
});

// Check if session was preloaded before app.js was ready
if (window.__preloadedSession) {
  loadSession(window.__preloadedSession);
}
// ════════════════════════════════════════════════════════════════
//  MULTI-STEP INTAKE
// ════════════════════════════════════════════════════════════════
function setupIntake() {
  // ── Step 1: role tiles ──
  document.querySelectorAll('.role-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      document.querySelectorAll('.role-tile').forEach(t => t.classList.remove('tile-active'));
      tile.classList.add('tile-active');
      intakeData.userType = tile.dataset.value;
      document.getElementById('step1Next').disabled = false;
      intakeError.style.display = 'none';
    });
  });

  document.getElementById('step1Next').addEventListener('click', () => {
    if (!intakeData.userType) { showIntakeError(); return; }
    goToStep(2);
  });

  // ── Step 2: goal tiles (multi-select) ──
  document.querySelectorAll('.goal-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      tile.classList.toggle('tile-active');
      const selected = [...document.querySelectorAll('.goal-tile.tile-active')].map(t => t.dataset.value);
      intakeData.goals = selected;
      document.getElementById('step2Next').disabled = selected.length === 0;
      intakeError.style.display = 'none';
    });
  });

  document.getElementById('step2Back').addEventListener('click', () => goToStep(1));
  document.getElementById('step2Next').addEventListener('click', () => {
    if (intakeData.goals.length === 0) { showIntakeError(); return; }
    goToStep(3);
  });

  // ── Step 3: profile fields ──

  // Athlete conditional fields
  if (intakeData.userType === 'Student-Athlete') showAthleteFields();

  document.getElementById('athleteSport')?.addEventListener('change', e => {
    intakeData.sport = e.target.value;
  });
  document.getElementById('athleteDivision')?.addEventListener('change', e => {
    intakeData.division = e.target.value;
  });

  // GPA slider
  const gpaSlider  = document.getElementById('gpaSlider');
  const gpaDisplay = document.getElementById('gpaDisplay');
  gpaSlider.addEventListener('input', () => {
    intakeData.gpa   = gpaSlider.value;
    gpaDisplay.textContent = parseFloat(gpaSlider.value).toFixed(1);
  });

  // Test toggle
  document.querySelectorAll('.test-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.test-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      intakeData.testType = tab.dataset.test;
      const satIn = document.getElementById('satInput');
      const actIn = document.getElementById('actInput');
      if (tab.dataset.test === 'SAT') {
        satIn.hidden = false; actIn.hidden = true; intakeData.testScore = satIn.value;
      } else if (tab.dataset.test === 'ACT') {
        satIn.hidden = true;  actIn.hidden = false; intakeData.testScore = actIn.value;
      } else {
        satIn.hidden = true;  actIn.hidden = true;  intakeData.testScore = '';
      }
    });
  });
  document.getElementById('satInput').addEventListener('input', e => { intakeData.testScore = e.target.value; });
  document.getElementById('actInput').addEventListener('input', e => { intakeData.testScore = e.target.value; });

  // Semester tiles (multi-select)
  document.querySelectorAll('.semester-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      tile.classList.toggle('tile-active');
      intakeData.semesters = [...document.querySelectorAll('.semester-tile.tile-active')].map(t => t.dataset.value);
    });
  });

  // School type tiles (multi-select; "Any" clears others)
  document.querySelectorAll('.school-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      if (tile.dataset.value === 'Any') {
        document.querySelectorAll('.school-tile').forEach(t => t.classList.remove('tile-active'));
        tile.classList.add('tile-active');
      } else {
        document.querySelector('.school-tile[data-value="Any"]')?.classList.remove('tile-active');
        tile.classList.toggle('tile-active');
      }
      intakeData.schoolTypes = [...document.querySelectorAll('.school-tile.tile-active')].map(t => t.dataset.value);
    });
  });

  // Budget slider
  const budgetSlider  = document.getElementById('budgetSlider');
  const budgetDisplay = document.getElementById('budgetDisplay');
  budgetSlider.addEventListener('input', () => {
    intakeData.budget = budgetSlider.value;
    const k = Math.round(Number(budgetSlider.value) / 1000);
    budgetDisplay.textContent = k >= 100 ? '$100K+/yr' : `$${k}K/yr`;
  });

  // Transfer fields
  document.getElementById('transferFrom')?.addEventListener('input', e => {
    intakeData.transferFrom = e.target.value.trim();
  });

  const creditsSlider  = document.getElementById('creditsSlider');
  const creditsDisplay = document.getElementById('creditsDisplay');
  creditsSlider?.addEventListener('input', () => {
    intakeData.creditsCompleted = creditsSlider.value;
    creditsDisplay.textContent  = creditsSlider.value;
  });

  // Major
  document.getElementById('majorInput')?.addEventListener('input', e => {
    intakeData.major = e.target.value.trim();
  });

  // Geographic preference
  document.getElementById('geoPreference')?.addEventListener('input', e => {
    intakeData.geoPreference = e.target.value.trim();
  });

  // Environment tiles (multi-select; "No Preference" clears others)
  document.querySelectorAll('.env-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      if (tile.dataset.value === 'No Preference') {
        document.querySelectorAll('.env-tile').forEach(t => t.classList.remove('tile-active'));
        tile.classList.add('tile-active');
      } else {
        document.querySelector('.env-tile[data-value="No Preference"]')?.classList.remove('tile-active');
        tile.classList.toggle('tile-active');
      }
      intakeData.envPreference = [...document.querySelectorAll('.env-tile.tile-active')].map(t => t.dataset.value);
    });
  });

  // Name
  document.getElementById('userName').addEventListener('input', e => {
    intakeData.name = e.target.value.trim();
    intakeError.style.display = 'none';
  });

  document.getElementById('step3Back').addEventListener('click', () => goToStep(2));
  document.getElementById('step3Next').addEventListener('click', () => {
    intakeData.name = document.getElementById('userName').value.trim();
    if (!intakeData.name) {
      document.getElementById('userName').focus();
      showIntakeError('Please enter your first name before continuing.');
      return;
    }
    goToStep(4);
  });

  // ── Step 4: start ──
  document.getElementById('step4Back').addEventListener('click', () => goToStep(3));
  document.getElementById('intakeStartBtn').addEventListener('click', startSession);
}

function showAthleteFields() {
  document.getElementById('athleteFields').hidden = false;
}

function hideAthleteFields() {
  document.getElementById('athleteFields').hidden = true;
}

function showTransferFields() {
  document.getElementById('transferFields').hidden = false;
}

function hideTransferFields() {
  document.getElementById('transferFields').hidden = true;
}

function showIntakeError(msg) {
  intakeError.textContent = msg || 'Please complete the required fields before continuing.';
  intakeError.style.display = 'block';
}

function goToStep(n) {
  // Hide all steps
  [1,2,3,4].forEach(i => {
    document.getElementById(`intakeStep${i}`).hidden = (i !== n);
  });

  // Progress bar
  document.getElementById('intakeProgressFill').style.width = `${n * 25}%`;
  document.getElementById('intakeStepLabel').textContent = `Step ${n} of 4`;

  // Show/hide conditional fields when arriving at step 3
  if (n === 3) {
    if (intakeData.userType === 'Student-Athlete') showAthleteFields();
    else hideAthleteFields();
    if (intakeData.userType === 'Transfer Student') showTransferFields();
    else hideTransferFields();
  }

  // Populate step 4 summary
  if (n === 4) buildStep4Summary();

  intakeError.style.display = 'none';
}

function buildStep4Summary() {
  document.getElementById('readyNameDisplay').textContent = intakeData.name;

  const parts = [
    intakeData.userType,
    intakeData.goals.join(', '),
    intakeData.sport ? intakeData.sport + (intakeData.division ? ` · ${intakeData.division}` : '') : null,
    intakeData.transferFrom ? `From: ${intakeData.transferFrom}` : null,
    intakeData.creditsCompleted && intakeData.creditsCompleted !== '0' ? `${intakeData.creditsCompleted} credits` : null,
    `GPA ${parseFloat(intakeData.gpa).toFixed(1)}`,
    (intakeData.testType !== 'None' && intakeData.testScore)
      ? `${intakeData.testType} ${intakeData.testScore}` : null,
    intakeData.major ? `Major: ${intakeData.major}` : null,
    intakeData.semesters.length ? intakeData.semesters.join(' / ') : null,
    intakeData.geoPreference ? `Location: ${intakeData.geoPreference}` : null,
    intakeData.envPreference.length ? intakeData.envPreference.join(' · ') : null,
    intakeData.budget ? `$${Math.round(Number(intakeData.budget)/1000)}K/yr budget` : null,
  ].filter(Boolean);

  document.getElementById('intakeSummary').innerHTML =
    parts.map(p => `<span class="summary-pill">${escapeHTML(p)}</span>`).join('');
}

async function startSession() {
  const btn = document.getElementById('intakeStartBtn');
  btn.disabled    = true;
  btn.textContent = 'Starting your session…';

  currentUserName = intakeData.name;
  userInitial     = intakeData.name.charAt(0).toUpperCase();

  intakeOverlay.style.display = 'none';
  chatApp.removeAttribute('hidden');

  await sendMessage(buildIntroMessage(intakeData), true);
}

function buildIntroMessage(data) {
  const { name, userType, goals, sport, division, gpa, testType, testScore, semesters, schoolTypes, budget,
          major, transferFrom, creditsCompleted, geoPreference, envPreference } = data;

  let profile = `My name is ${name}. I am a ${userType}.`;
  if (sport) profile += ` I play ${sport}${division ? ` and I'm targeting ${division}` : ''}.`;
  if (transferFrom) profile += ` I'm transferring from ${transferFrom}.`;
  if (creditsCompleted && creditsCompleted !== '0') profile += ` I have completed ${creditsCompleted} college credits.`;
  profile += ` I'm interested in: ${goals.join(', ')}.`;
  profile += ` My GPA is ${parseFloat(gpa).toFixed(1)}.`;
  if (testType !== 'None' && testScore) profile += ` My ${testType} score is ${testScore}.`;
  if (major) profile += ` I'm interested in studying ${major}.`;
  if (semesters.length) profile += ` Target enrollment: ${semesters.join(' or ')}.`;
  if (schoolTypes.length && !schoolTypes.includes('Any')) profile += ` I prefer ${schoolTypes.join(', ')} schools.`;
  if (geoPreference) profile += ` Geographic preference: ${geoPreference}.`;
  if (envPreference && envPreference.length && !envPreference.includes('No Preference')) {
    profile += ` Campus environment preference: ${envPreference.join(', ')}.`;
  }
  if (budget) {
    const k = Math.round(Number(budget)/1000);
    profile += ` My annual budget is around $${k}K.`;
  }

  let followUp;
  if (goals.includes('Athletic Recruiting') && userType === 'Student-Athlete') {
    followUp = sport
      ? `Start by assessing my realistic division fit for ${sport}${division ? ` at the ${division} level` : ''} and what I need to do right now to attract coaches.`
      : 'Ask me what sport I play and then assess my realistic division-level fit.';
  } else if (goals.includes('Financial Aid')) {
    followUp = 'Help me understand what college will actually cost my family and how to maximize grants and aid.';
  } else if (goals.includes('College Search')) {
    followUp = 'Help me build a realistic college list — reach, match, and safety schools based on my profile.';
  } else if (goals.includes('Admissions Strategy')) {
    followUp = 'Give me specific admissions strategy advice based on my GPA and test scores.';
  } else {
    followUp = `Help me with ${goals[0]} based on my profile above.`;
  }

  return (
    `${profile} ` +
    `Greet me warmly by name, acknowledge my situation in one sentence, then immediately start helping. ` +
    `${followUp} ` +
    `Keep your opening to 2–3 sentences max. Be direct and specific to my profile, not generic.`
  );
}

function resetIntakeForm() {
  intakeData = {
    userType: '', goals: [], sport: '', division: '',
    gpa: '3.5', testType: 'SAT', testScore: '',
    semesters: [], schoolTypes: [], budget: '40000', name: '',
    major: '', transferFrom: '', creditsCompleted: '0',
    geoPreference: '', envPreference: [],
  };

  // Reset tiles
  document.querySelectorAll('.role-tile, .goal-tile, .semester-tile, .school-tile, .env-tile')
    .forEach(t => t.classList.remove('tile-active'));

  // Reset step-1 next button
  document.getElementById('step1Next').disabled = true;
  document.getElementById('step2Next').disabled = true;

  // Reset sliders/inputs
  const gpa = document.getElementById('gpaSlider');
  if (gpa) { gpa.value = 3.5; document.getElementById('gpaDisplay').textContent = '3.5'; }
  const budget = document.getElementById('budgetSlider');
  if (budget) { budget.value = 40000; document.getElementById('budgetDisplay').textContent = '$40K/yr'; }
  const sat = document.getElementById('satInput');
  if (sat) { sat.value = ''; sat.hidden = false; }
  const act = document.getElementById('actInput');
  if (act) { act.value = ''; act.hidden = true; }
  document.querySelectorAll('.test-tab').forEach((t,i) => t.classList.toggle('active', i===0));

  const name = document.getElementById('userName');
  if (name) name.value = '';

  const majorInput = document.getElementById('majorInput');
  if (majorInput) majorInput.value = '';
  const transferFrom = document.getElementById('transferFrom');
  if (transferFrom) transferFrom.value = '';
  const credits = document.getElementById('creditsSlider');
  if (credits) { credits.value = 0; document.getElementById('creditsDisplay').textContent = '0'; }
  const geo = document.getElementById('geoPreference');
  if (geo) geo.value = '';

  goToStep(1);
}

// ════════════════════════════════════════════════════════════════
//  SPEECH TO TEXT (Web Speech API)
// ════════════════════════════════════════════════════════════════
function setupSpeech() {
  if (!micBtn) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.title   = 'Speech recognition not supported in this browser';
    micBtn.style.opacity = '0.35';
    micBtn.disabled = true;
    return;
  }

  recognition              = new SR();
  recognition.continuous   = false;
  recognition.interimResults = true;
  recognition.lang         = 'en-US';

  let finalTranscript = '';

  recognition.onstart = () => {
    micListening    = true;
    finalTranscript = '';
    micBtn.classList.add('mic-active');
  };

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    chatInput.value = finalTranscript + interim;
    autoResize();
    sendBtn.disabled = !chatInput.value.trim() || isWaiting;
  };

  recognition.onerror = () => {
    micListening = false;
    micBtn.classList.remove('mic-active');
  };

  recognition.onend = () => {
    micListening = false;
    micBtn.classList.remove('mic-active');
    chatInput.value = finalTranscript.trim();
    autoResize();
    sendBtn.disabled = !chatInput.value.trim() || isWaiting;
  };

  micBtn.addEventListener('click', () => {
    if (isWaiting) return;
    if (micListening) {
      recognition.stop();
    } else {
      finalTranscript = '';
      try { recognition.start(); } catch (_) {}
    }
  });
}

// ════════════════════════════════════════════════════════════════
//  TEXT TO SPEECH (Web Speech Synthesis)
// ════════════════════════════════════════════════════════════════
function stripMarkdown(text) {
  return text
    .replace(/\[LIVE DATA[^\]]*\]:[\s\S]*$/m, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[(.+?)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

function createSpeakButton(text) {
  const btn = document.createElement('button');
  btn.className = 'speak-btn';
  btn.title = 'Read aloud';
  btn.setAttribute('aria-label', 'Read aloud');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="13" height="13">
    <path d="M11 5 6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07M18.07 5.93a9 9 0 0 1 0 12.14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg><span>Listen</span>`;

  btn.addEventListener('click', () => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    // If this button is already speaking, stop
    if (btn.classList.contains('speak-active')) {
      synth.cancel();
      return;
    }

    // Stop any other active speech
    synth.cancel();
    document.querySelectorAll('.speak-btn.speak-active')
      .forEach(b => b.classList.remove('speak-active'));

    const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
    utterance.rate  = 0.92;
    utterance.pitch = 1;

    btn.classList.add('speak-active');
    utterance.onend   = () => btn.classList.remove('speak-active');
    utterance.onerror = () => btn.classList.remove('speak-active');

    synth.speak(utterance);
  });

  return btn;
}

// ════════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ════════════════════════════════════════════════════════════════
async function sendMessage(content, hidden = false) {
  if (isWaiting || !content.trim()) return;

  isWaiting = true;
  setInputEnabled(false);
  updateStatus('Thinking…');

  conversationHistory.push({ role: 'user', content });
  if (!hidden) appendUserBubble(content);

  await streamResponse();
}

// ════════════════════════════════════════════════════════════════
//  STREAM RESPONSE (SSE)
// ════════════════════════════════════════════════════════════════
async function streamResponse() {
  let searchingEl = null;
  let aiBubble    = null;
  let accumulated = '';

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
            if (searchingEl) { searchingEl.remove(); searchingEl = null; }
            if (!aiBubble) aiBubble = appendAIBubble();
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

    if (aiBubble && accumulated) {
      finalizeAIBubble(aiBubble, accumulated);
      conversationHistory.push({ role: 'assistant', content: accumulated });
    saveSession();
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
  const row    = document.createElement('div');
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
  const row    = document.createElement('div');
  row.className = 'msg-row msg-row--ai';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar msg-avatar--ai';
  avatar.innerHTML = `<svg viewBox="0 0 32 32" fill="none" width="16" height="16">
    <path d="M16 3 3 10l13 7 13-7-13-7z" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M3 22l13 7 13-7" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M3 16l13 7 13-7" stroke="#C9A84C" stroke-width="2.2" stroke-linejoin="round"/>
  </svg>`;

  const wrap   = document.createElement('div');
  wrap.className = 'msg-bubble-wrap';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--ai msg-bubble--streaming';

  wrap.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(wrap);
  chatMessages.appendChild(row);
  scrollBottom();
  return bubble;
}

function renderStreaming(bubble, text) {
  const clean = text.replace(/\n\n\[LIVE DATA from Perplexity search[^\]]*\]:[\s\S]*$/, '');
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(clean));
}

function finalizeAIBubble(bubble, text) {
  const clean = text.replace(/\n\n\[LIVE DATA from Perplexity search[^\]]*\]:[\s\S]*$/, '');
  bubble.classList.remove('msg-bubble--streaming');
  bubble.innerHTML = DOMPurify.sanitize(marked.parse(clean));

  // Add speak button below bubble
  const wrap = bubble.parentElement;
  if (wrap && window.speechSynthesis) {
    wrap.appendChild(createSpeakButton(clean));
  }

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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scrollBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ════════════════════════════════════════════════════════════════
//  INPUT HANDLING
// ════════════════════════════════════════════════════════════════
function setupInput() {
  chatInput.addEventListener('input', () => {
    sendBtn.disabled = !chatInput.value.trim() || isWaiting;
    autoResize();
  });

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
  if (on) sendBtn.disabled = !chatInput.value.trim();
  if (micBtn) micBtn.disabled = !on;
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

  resetChat();
}

function resetChat() {
  conversationHistory = [];
  chatMessages.innerHTML = '';

  // Stop any speech
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (recognition && micListening) recognition.stop();

  closeSidebar();
  chatApp.setAttribute('hidden', '');
  intakeOverlay.style.display = 'flex';
  resetIntakeForm();
  updateStatus('<span class="status-dot"></span>Ready to help');
}
// ════════════════════════════════════════════════════════════════
//  FIRESTORE — CHAT HISTORY
// ════════════════════════════════════════════════════════════════

async function saveSession() {
  if (!currentUserId || conversationHistory.length === 0) return;
  const { db, collection, addDoc, doc, updateDoc, serverTimestamp } = window.firebaseDB;

  const title = conversationHistory[0]?.content?.slice(0, 50) || 'New Conversation';

  if (!currentSessionId) {
    const ref = await addDoc(collection(db, 'users', currentUserId, 'sessions'), {
      title,
      messages: conversationHistory,
      updatedAt: serverTimestamp(),
    });
    currentSessionId = ref.id;
  } else {
    await updateDoc(doc(db, 'users', currentUserId, 'sessions', currentSessionId), {
      messages: conversationHistory,
      updatedAt: serverTimestamp(),
    });
  }
}

async function loadChatSessions() {
  if (!currentUserId) return;
  const { db, collection, getDocs, query, orderBy } = window.firebaseDB;

  const q = query(
    collection(db, 'users', currentUserId, 'sessions'),
    orderBy('updatedAt', 'desc')
  );

  const snapshot = await getDocs(q);
  const sessions = [];
  snapshot.forEach(d => sessions.push({ id: d.id, ...d.data() }));
  renderSessionList(sessions);

  // If user has past sessions, load the most recent one automatically
  if (sessions.length > 0) {
    await loadSession(sessions[0]);
  }
}


function renderSessionList(sessions) {
  const container = document.getElementById('chatHistoryList');
  if (!container) return;

  container.innerHTML = '';

  if (sessions.length === 0) {
    container.innerHTML = '<p class="no-history">No past conversations yet.</p>';
    return;
  }

  sessions.forEach(session => {
    const btn = document.createElement('button');
    btn.className = 'history-item';
    btn.textContent = session.title || 'Conversation';
    btn.addEventListener('click', () => loadSession(session));
    container.appendChild(btn);
  });
}

async function loadSession(session) {
  if (isWaiting) return;

 

  currentSessionId = session.id;
  conversationHistory = session.messages || [];

  chatMessages.innerHTML = '';
  conversationHistory.forEach(msg => {
    if (msg.role === 'user') appendUserBubble(msg.content);
    else if (msg.role === 'assistant') {
      const bubble = appendAIBubble();
      finalizeAIBubble(bubble, msg.content);
    }
  });

  intakeOverlay.style.display = 'none';
  chatApp.removeAttribute('hidden');
  closeSidebar();
  scrollBottom();
}