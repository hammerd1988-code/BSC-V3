// Pure helpers for the Colosseum sandbox_build challenge.
// Shared between the frontend arena and the backend gladiator routes.

export interface SandboxSpiceInput {
  name: string;
  opponent: string;
  primaryColor?: string;
  secondaryColor?: string;
  seed: number;
}

export interface SandboxFallbackInput {
  name: string;
  opponent: string;
  directive?: string;
  primaryColor?: string;
  secondaryColor?: string;
  seed: number;
}

const SIGNATURE_FEATURES = [
  { id: 'counter', label: 'a real-time animated counter that bursts on milestones', verb: 'count anything' },
  { id: 'darkmode', label: 'a dark / light mode toggle with animated transitions', verb: 'switch themes' },
  { id: 'tabs', label: 'a tabbed interface that swaps content without a page reload', verb: 'navigate tabs' },
  { id: 'pomodoro', label: 'a working Pomodoro timer with start, pause, and reset controls', verb: 'time a session' },
  { id: 'chart', label: 'an interactive bar chart built from pure DOM elements', verb: 'animate chart bars' },
  { id: 'feed', label: 'a simulated live data feed that updates every second', verb: 'watch live data' },
  { id: 'accordion', label: 'a collapsible accordion with animated section reveals', verb: 'expand sections' },
  { id: 'trail', label: 'a mouse-reactive neon glow trail inside a canvas', verb: 'move the mouse' },
  { id: 'quotes', label: 'a cyberpunk quote generator with a typewriter reveal', verb: 'cycle quotes' },
  { id: 'tasks', label: 'a working mini task list with add, toggle, and remove', verb: 'manage tasks' },
  { id: 'colorcycle', label: 'a keyboard-controlled color-cycle that re-themes the page', verb: 'press keys' },
  { id: 'xpbar', label: 'an animated XP / progress bar with level-up feedback', verb: 'gain XP' },
];

export function sandboxFeature(seed: number) {
  return SIGNATURE_FEATURES[(Math.abs(seed) + SIGNATURE_FEATURES.length) % SIGNATURE_FEATURES.length];
}

function isHexColor(value?: string | null): value is string {
  return Boolean(value && /^#[0-9A-Fa-f]{6}$/.test(value));
}

function pickColor(value: string | null | undefined, fallback: string): string {
  return isHexColor(value) ? value : fallback;
}

export function buildSandboxSpice(input: SandboxSpiceInput): string {
  const name = input.name;
  const opponent = input.opponent;
  const primary = pickColor(input.primaryColor, '#00e5ff');
  const secondary = pickColor(input.secondaryColor, '#ff1744');
  const feature = sandboxFeature(input.seed);

  return `
═══ ARENA IDENTITY LOCK ═══
You are ${name} in the red corner.
${opponent} is your opponent in the shadow cage.
Primary accent color: ${primary}
Secondary / opponent accent color: ${secondary}

SANDBOX RULES:
- Build a COMPLETE, single-file HTML/CSS/JS product.
- Your layout, color usage, and feature set must be DIFFERENT from ${opponent}'s.
- Do NOT copy ${opponent}'s structure.
- REQUIRED signature feature: include ${feature.label}.
- Use the exact primary/secondary colors above as your neon accents.
- The product must actually work when opened in a browser (real buttons, real state, real updates).`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inlineJsString(value: string): string {
  // Encode < and > as \u003c / \u003e so a name containing </script> cannot
  // close the inline <script> block in the generated fallback HTML.
  return JSON.stringify(value)
    .split('<').join(String.fromCharCode(92) + 'u003c')
    .split('>').join(String.fromCharCode(92) + 'u003e');
}

export function buildSandboxFallbackHtml(input: SandboxFallbackInput): string {
  const name = escapeHtml(input.name);
  const opponent = escapeHtml(input.opponent);
  const directive = escapeHtml((input.directive || 'sandbox build').slice(0, 240));
  const primary = pickColor(input.primaryColor, '#00e5ff');
  const secondary = pickColor(input.secondaryColor, '#ff1744');
  const seed = Math.floor(input.seed || 0);
  const feature = sandboxFeature(seed);
  const layout = Math.abs(seed) % 3;

  // The iframe runs this inline script to pick one interactive feature deterministically.
  const featureLabel = inlineJsString(feature.label);
  const script = `<script>
(function () {
  const seed = ${seed};
  const name = ${inlineJsString(input.name)};
  const opponent = ${inlineJsString(input.opponent)};
  const primary = '${primary}';
  const secondary = '${secondary}';
  const featureName = ${featureLabel};
  const stage = document.getElementById('feature-stage');

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  const h = (s) => s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');

  function featureCounter() {
    let count = 0;
    stage.innerHTML = \`
      <div style="text-align:center">
        <div id="counter-val" style="font-size:4rem;font-weight:900;color:\${primary};text-shadow:0 0 30px \${primary}44">0</div>
        <p style="font-size:0.75rem;color:#71717a;margin:0.5rem 0">Click to build momentum</p>
        <button id="counter-btn" class="btn">Increment</button>
      </div>\`;
    document.getElementById('counter-btn').addEventListener('click', function () {
      count++;
      const display = document.getElementById('counter-val');
      display.textContent = count;
      display.style.transform = 'scale(1.15)';
      setTimeout(() => display.style.transform = 'scale(1)', 120);
      if (count % 10 === 0) {
        display.style.textShadow = \`0 0 40px \${secondary}\`;
        setTimeout(() => display.style.textShadow = \`0 0 30px \${primary}44\`, 400);
      }
    });
  }

  function featureDarkMode() {
    stage.innerHTML = \`
      <div style="text-align:center">
        <div id="mode-label" style="font-size:1.5rem;font-weight:900;margin-bottom:1rem;color:\${primary}">NEON MODE</div>
        <button id="mode-btn" class="btn">Toggle Theme</button>
        <p style="font-size:0.7rem;color:#71717a;margin-top:0.75rem">Pure CSS + JS state</p>
      </div>\`;
    let dark = true;
    document.getElementById('mode-btn').addEventListener('click', function () {
      dark = !dark;
      document.body.style.background = dark ? '#0a0a0f' : '#f4f4f5';
      document.body.style.color = dark ? '#a1a1aa' : '#18181b';
      document.getElementById('mode-label').textContent = dark ? 'NEON MODE' : 'LIGHT MODE';
      document.getElementById('mode-label').style.color = dark ? primary : secondary;
    });
  }

  function featureTabs() {
    stage.innerHTML = \`
      <div>
        <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
          <button class="tab-btn btn" data-tab="build">Build</button>
          <button class="tab-btn btn" data-tab="stats">Stats</button>
          <button class="tab-btn btn" data-tab="lore">Lore</button>
        </div>
        <div id="tab-build" class="tab-panel" style="display:block">
          <p>\${h(name)} is forging a live product inside the arena sandbox. No external dependencies, just HTML/CSS/JS.</p>
        </div>
        <div id="tab-stats" class="tab-panel" style="display:none">
          <div class="stat-card"><div class="stat-val">97%</div><div class="stat-label">Energy</div></div>
        </div>
        <div id="tab-lore" class="tab-panel" style="display:none">
          <p>Opponent: <strong>\${h(opponent)}</strong>. The crowd demands a working product.</p>
        </div>
      </div>\`;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.tab-btn').forEach(b => b.style.opacity = '0.6');
        document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
        btn.style.opacity = '1';
      });
    });
  }

  function featurePomodoro() {
    let seconds = 1500, timer = null, running = false;
    stage.innerHTML = \`
      <div style="text-align:center">
        <div id="timer" style="font-size:3.5rem;font-weight:900;font-variant-numeric:tabular-nums;color:\${primary}">25:00</div>
        <div style="display:flex;justify-content:center;gap:0.75rem;margin-top:1rem">
          <button id="p-start" class="btn">Start</button>
          <button id="p-pause" class="btn" style="border-color:\${secondary};color:\${secondary}">Pause</button>
          <button id="p-reset" class="btn" style="border-color:#facc15;color:#facc15">Reset</button>
        </div>
      </div>\`;
    const display = document.getElementById('timer');
    function fmt() { const m = Math.floor(seconds/60).toString().padStart(2,'0'); const s = (seconds%60).toString().padStart(2,'0'); display.textContent = m + ':' + s; }
    document.getElementById('p-start').addEventListener('click', () => { if (!running) { running = true; timer = setInterval(() => { if (seconds > 0) { seconds--; fmt(); } }, 1000); } });
    document.getElementById('p-pause').addEventListener('click', () => { running = false; clearInterval(timer); });
    document.getElementById('p-reset').addEventListener('click', () => { running = false; clearInterval(timer); seconds = 1500; fmt(); });
  }

  function featureChart() {
    stage.innerHTML = \`
      <div style="text-align:center">
        <p style="font-size:0.7rem;color:#71717a;margin-bottom:0.75rem">Click any bar to re-roll its value</p>
        <div id="chart" style="display:flex;align-items:flex-end;gap:0.5rem;height:160px;justify-content:center"></div>
      </div>\`;
    const chart = document.getElementById('chart');
    const values = [40, 65, 55, 80, 70, 90, 50];
    values.forEach((v, i) => {
      const bar = document.createElement('div');
      bar.style.cssText = \`width:32px;background:\${(i % 2 === 0) ? primary : secondary};border-radius:4px 4px 0 0;cursor:pointer;transition:height 0.4s;height:\${v}%\`;
      bar.addEventListener('click', () => { const nv = 20 + Math.floor(Math.random() * 75); bar.style.height = nv + '%'; });
      chart.appendChild(bar);
    });
  }

  function featureFeed() {
    stage.innerHTML = \`
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <span style="font-size:0.7rem;color:#71717a">LIVE EVENTS</span>
          <span id="feed-count" style="font-size:0.7rem;color:\${primary}">0 events</span>
        </div>
        <div id="feed" style="max-height:200px;overflow:auto;display:flex;flex-direction:column;gap:0.5rem"></div>
      </div>\`;
    const feed = document.getElementById('feed');
    const verbs = ['compiled', 'forged', 'tested', 'deployed', 'optimized', 'refactored'];
    let count = 0;
    function push() {
      const line = document.createElement('div');
      line.style.cssText = 'padding:0.5rem;border-left:3px solid ' + primary + ';background:rgba(255,255,255,0.03);border-radius:0 0.5rem 0.5rem 0;font-size:0.75rem';
      line.textContent = (new Date()).toLocaleTimeString() + ' — ' + name + ' ' + verbs[Math.floor(Math.random() * verbs.length)] + ' module v' + (Math.floor(Math.random()*90)+10);
      feed.insertBefore(line, feed.firstChild);
      if (feed.children.length > 8) feed.lastChild.remove();
      count++;
      document.getElementById('feed-count').textContent = count + ' events';
    }
    push();
    setInterval(push, 1200);
  }

  function featureAccordion() {
    const sections = [
      { title: 'Strategy', body: \`\${h(name)} plans a unique layout and interactivity pattern to avoid mirroring \${h(opponent)}.\` },
      { title: 'Stack', body: 'Single HTML file. Embedded CSS and vanilla JavaScript. No build step, no framework.' },
      { title: 'Win Condition', body: 'The product must work, look polished, and feel different from the opponent.' }
    ];
    stage.innerHTML = '<div id="accordion"></div>';
    const wrap = document.getElementById('accordion');
    sections.forEach((sec, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.08);border-radius:0.75rem;overflow:hidden';
      row.innerHTML = \`<button class="acc-head" style="width:100%;text-align:left;padding:0.75rem;font-weight:800;background:rgba(255,255,255,0.03);border:none;color:\${primary};cursor:pointer">+ \${sec.title}</button><div class="acc-body" style="padding:0 0.75rem;max-height:0;overflow:hidden;transition:max-height 0.3s;color:#a1a1aa;font-size:0.8rem">\${sec.body}</div>\`;
      row.querySelector('.acc-head').addEventListener('click', () => {
        const body = row.querySelector('.acc-body');
        const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '';
        document.querySelectorAll('.acc-body').forEach(b => b.style.maxHeight = '0px');
        body.style.maxHeight = isOpen ? '0px' : body.scrollHeight + 'px';
      });
      wrap.appendChild(row);
    });
  }

  function featureTrail() {
    stage.innerHTML = '<canvas id="trail" width="400" height="220" style="border-radius:0.75rem;background:#050508"></canvas>';
    const canvas = document.getElementById('trail');
    const ctx = canvas.getContext('2d');
    const points = [];
    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, life: 1 });
    });
    function loop() {
      ctx.fillStyle = 'rgba(5,5,8,0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        p.life -= 0.03;
        if (p.life <= 0) { points.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2);
        ctx.fillStyle = (Math.floor(p.x + p.y + seed) % 2 === 0) ? primary : secondary;
        ctx.globalAlpha = p.life;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(loop);
    }
    loop();
  }

  function featureQuotes() {
    const lines = [
      'Code is the only weapon that gets sharper the more you swing it.',
      'The arena does not forgive empty promises.',
      'Ship a working product, or the crowd forgets your name.',
      'Function over flair — but both win matches.'
    ];
    stage.innerHTML = \`
      <div style="text-align:center">
        <div id="quote" style="min-height:4rem;font-size:1.05rem;font-weight:700;color:\${primary};line-height:1.5"></div>
        <button id="quote-btn" class="btn" style="margin-top:1rem">Next Quote</button>
      </div>\`;
    const out = document.getElementById('quote');
    let idx = 0, char = 0, interval = null;
    function type() {
      clearInterval(interval);
      out.textContent = '';
      const line = lines[idx];
      char = 0;
      interval = setInterval(() => { out.textContent += line[char++]; if (char >= line.length) clearInterval(interval); }, 35);
    }
    document.getElementById('quote-btn').addEventListener('click', () => { idx = (idx + 1) % lines.length; type(); });
    type();
  }

  function featureTasks() {
    stage.innerHTML = \`
      <div>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
          <input id="task-input" type="text" placeholder="Add task..." style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:0.5rem;padding:0.5rem;color:inherit" />
          <button id="task-add" class="btn">Add</button>
        </div>
        <div id="task-list" style="display:flex;flex-direction:column;gap:0.5rem"></div>
      </div>\`;
    const list = document.getElementById('task-list');
    const input = document.getElementById('task-input');
    function add() {
      const text = input.value.trim();
      if (!text) return;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.5rem;border-radius:0.5rem;background:rgba(255,255,255,0.03)';
      row.innerHTML = \`<input type="checkbox" style="accent-color:\${primary}"><span style="flex:1;font-size:0.8rem">\${text.replace(/</g, '&lt;')}</span><button style="background:none;border:none;color:\${secondary};cursor:pointer;font-size:1rem">&times;</button>\`;
      row.querySelector('input').addEventListener('change', e => { row.querySelector('span').style.textDecoration = e.target.checked ? 'line-through' : 'none'; row.querySelector('span').style.opacity = e.target.checked ? '0.5' : '1'; });
      row.querySelector('button').addEventListener('click', () => row.remove());
      list.appendChild(row);
      input.value = '';
    }
    document.getElementById('task-add').addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  }

  function featureColorCycle() {
    stage.innerHTML = \`
      <div style="text-align:center">
        <div id="color-label" style="font-size:1.25rem;font-weight:900;margin-bottom:1rem">Press a number key 0-9</div>
        <div id="color-swatch" style="width:120px;height:120px;margin:0 auto;border-radius:1rem;background:\${primary};box-shadow:0 0 30px \${primary}55;transition:all 0.3s"></div>
      </div>\`;
    const colors = [primary, secondary, '#facc15', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#3b82f6', '#ef4444'];
    document.addEventListener('keydown', e => {
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && colors[n]) {
        const c = colors[n];
        document.documentElement.style.setProperty('--primary', c);
        document.getElementById('color-swatch').style.background = c;
        document.getElementById('color-swatch').style.boxShadow = '0 0 30px ' + c + '55';
        document.getElementById('color-label').textContent = 'Active accent: ' + c;
        document.getElementById('color-label').style.color = c;
      }
    });
  }

  function featureXpBar() {
    stage.innerHTML = \`
      <div style="text-align:center">
        <div style="display:flex;justify-content:center;gap:1rem;margin-bottom:1rem">
          <div><div class="stat-val" id="xp-level">1</div><div class="stat-label">Level</div></div>
          <div><div class="stat-val" id="xp-total">0</div><div class="stat-label">XP</div></div>
        </div>
        <div style="height:12px;background:#222;border-radius:6px;overflow:hidden;margin-bottom:1rem">
          <div id="xp-fill" style="height:100%;width:0%;background:\${primary};transition:width 0.4s;box-shadow:0 0 20px \${primary}66"></div>
        </div>
        <button id="xp-btn" class="btn">Grind XP</button>
      </div>\`;
    let xp = 0, level = 1;
    document.getElementById('xp-btn').addEventListener('click', () => {
      xp += Math.floor(Math.random() * 15) + 5;
      if (xp >= level * 100) { xp = 0; level++; document.getElementById('xp-level').style.color = secondary; setTimeout(() => document.getElementById('xp-level').style.color = primary, 300); }
      const pct = (xp / (level * 100)) * 100;
      document.getElementById('xp-total').textContent = xp;
      document.getElementById('xp-level').textContent = level;
      document.getElementById('xp-fill').style.width = pct + '%';
    });
  }

  const features = [featureCounter, featureDarkMode, featureTabs, featurePomodoro, featureChart, featureFeed, featureAccordion, featureTrail, featureQuotes, featureTasks, featureColorCycle, featureXpBar];
  const index = Math.abs(seed) % features.length;
  features[index]();
  setText('feature-name', featureName);
})();
</script>`;

  const layoutClass = layout === 0 ? 'single' : layout === 1 ? 'split' : 'wide';
  const layoutCss = layoutClass === 'single'
    ? '.container.layout-single { max-width: 520px; text-align: center; } .layout-single .feature-area { text-align: center; }'
    : layoutClass === 'split'
      ? '.container.layout-split .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; } .layout-split .feature-area { width: 100%; } .layout-split .stat-card { width: 100%; } @media (max-width: 640px) { .container.layout-split .row { grid-template-columns: 1fr; } }'
      : '.container.layout-wide { max-width: 760px; } .layout-wide .feature-area { width: 100%; }';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} — Sandbox Build</title>
<style>
:root { --primary: ${primary}; --secondary: ${secondary}; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { min-height: 100vh; background: #0a0a0f; color: #a1a1aa; font-family: 'Segoe UI', system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem; }
.container { width: 100%; display: flex; flex-direction: column; align-items: center; }
${layoutCss}
h1 { font-size: 1.5rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; background: linear-gradient(135deg, var(--primary), #fff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; text-align: center; }
.directive { font-size: 0.75rem; color: #71717a; text-align: center; max-width: 520px; margin: 0 auto 1.5rem; line-height: 1.5; }
.feature-area { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1rem; min-height: 220px; display: flex; align-items: center; justify-content: center; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.6rem 1.2rem; border: 2px solid var(--primary); background: transparent; color: var(--primary); border-radius: 0.5rem; font-weight: 800; cursor: pointer; text-transform: uppercase; letter-spacing: 0.08em; transition: all 0.2s; font-size: 0.75rem; }
.btn:hover { background: color-mix(in srgb, var(--primary) 13%, transparent); box-shadow: 0 0 20px color-mix(in srgb, var(--primary) 27%, transparent); }
.stat-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 1rem; padding: 1rem; text-align: center; }
.stat-val { font-size: 1.5rem; font-weight: 900; color: var(--primary); }
.stat-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 0.25rem; color: #666; }
.footer { margin-top: auto; font-size: 0.65rem; color: #52525b; text-align: center; text-transform: uppercase; letter-spacing: 0.12em; }
</style>
</head>
<body>
<div class="container layout-${layoutClass}">
  <h1>${name}</h1>
  <p class="directive">${directive}</p>
  ${layoutClass === 'split' ? '<div class="row"><div class="feature-area" id="feature-stage"></div><div class="stat-card"><div class="stat-val" id="feature-name">Live Feature</div><div class="stat-label">signature move</div><p style="font-size:0.75rem;margin-top:0.75rem;line-height:1.4">Built by ' + name + ' to challenge ' + opponent + '.</p></div></div>' : '<div class="feature-area" id="feature-stage"></div><div class="stat-card" style="max-width:520px"><div class="stat-val" id="feature-name">Live Feature</div><div class="stat-label">signature move</div><p style="font-size:0.75rem;margin-top:0.75rem;line-height:1.4">Built by ' + name + ' to challenge ' + opponent + '.</p></div>'}
</div>
<p class="footer">BSC Colosseum Sandbox // ${name} vs ${opponent}</p>
${script}
</body>
</html>`;
}

export function buildSandboxFallbackSolution(input: SandboxFallbackInput): string {
  const html = buildSandboxFallbackHtml(input);
  const feature = sandboxFeature(input.seed);
  return `<thinking>
${input.name} is building a working sandbox product to beat ${input.opponent}.
Directive: ${(input.directive || 'sandbox build').slice(0, 200)}
Plan: create a self-contained HTML file with a cyberpunk dark theme, CSS variables for the primary and secondary colors, and a signature interactive feature.
Signature feature: ${feature.label}.
The product must render in a browser, be visually distinct from the opponent, and actually function without external dependencies.
</thinking>

<code>
${html}
</code>

<preview_description>
${input.name} built a live, single-file ${feature.verb} product in the arena with ${feature.label} and a neon cyberpunk aesthetic.
</preview_description>`;
}

export function parseSandboxCode(solution: string): { thinking: string; code: string; previewDesc: string } {
  if (!solution || typeof solution !== 'string') return { thinking: '', code: '', previewDesc: '' };

  // Strip markdown fences around the whole string first.
  let cleaned = solution.replace(/^\s*```(?:html|jsx?|tsx?|css|javascript|js)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');

  const thinkingMatch = cleaned.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  const previewMatch = cleaned.match(/<preview_description>([\s\S]*?)<\/preview_description>/i);

  // Try a proper <code> block first.
  let code = '';
  const codeMatch = cleaned.match(/<code>([\s\S]*?)<\/code>/i);
  if (codeMatch) {
    code = codeMatch[1].trim().replace(/^\s*```(?:html|javascript|js|css)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
  }

  // Fallback: if the whole solution is basically HTML, use whatever is left.
  if (!code) {
    const stripped = cleaned
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<preview_description>[\s\S]*?<\/preview_description>/gi, '')
      .trim();
    if (/<html\b/i.test(stripped) || /<!doctype\b/i.test(stripped)) {
      code = stripped.replace(/\s*```[\s\S]*?```/g, '');
    }
  }

  if (!code) {
    code = cleaned.trim();
  }

  // Defensive wrap for anything that is not a full HTML document.
  if (!/<html\b/i.test(code) && !/<!doctype\b/i.test(code)) {
    code = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sandbox Build</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { min-height: 100vh; background: #0a0a0f; color: #e4e4e7; font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; padding: 2rem; }
pre { white-space: pre-wrap; font-size: 0.85rem; line-height: 1.6; color: #a1a1aa; }
</style>
</head>
<body><pre>${escapeHtml(code)}</pre></body>
</html>`;
  }

  return {
    thinking: thinkingMatch?.[1]?.trim() || '',
    code,
    previewDesc: previewMatch?.[1]?.trim() || '',
  };
}
