const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createCanvas, loadImage, registerFont } = require('canvas');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Rate limiter for API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// WebSocket message rate limiting (per connection)
const wsMessageLimits = new Map();
const WS_RATE_LIMIT = 10; // messages per second
const WS_WINDOW_MS = 1000;

// Clean up stale WebSocket rate limit entries every 5 minutes
setInterval(() => {
  for (const [ws, data] of wsMessageLimits) {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      wsMessageLimits.delete(ws);
      console.log('Cleaned up stale rate limit entry');
    }
  }
}, 300000);

// Write queue to prevent race conditions
let writeQueue = Promise.resolve();

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Input validation function
function validateConfig(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Config must be an object');
  }

  const validators = {
    km: (v) => typeof v === 'number' && v >= 0 && v <= 1000000,
    target: (v) => typeof v === 'number' && v > 0 && v <= 1000000,
    day: (v) => v === '' || typeof v === 'number' || (typeof v === 'string' && v.length <= 10),
    steps: (v) => v === '' || typeof v === 'number' || (typeof v === 'string' && v.length <= 20),
    title: (v) => typeof v === 'string' && v.length <= 100,
    yearText: (v) => typeof v === 'string' && v.length <= 20,
    handle: (v) => typeof v === 'string' && v.length <= 50,
    titleFont: (v) => typeof v === 'string' && v.length <= 50,
    yearFont: (v) => typeof v === 'string' && v.length <= 50,
    kmFont: (v) => typeof v === 'string' && v.length <= 50,
    goalFont: (v) => typeof v === 'string' && v.length <= 50,
    titleSize: (v) => typeof v === 'number' && v >= 20 && v <= 200,
    yearSize: (v) => typeof v === 'number' && v >= 50 && v <= 500,
    kmSize: (v) => typeof v === 'number' && v >= 40 && v <= 200,
    goalSize: (v) => typeof v === 'number' && v >= 20 && v <= 100,
    iconSize: (v) => typeof v === 'number' && v >= 40 && v <= 200,
    opacity: (v) => typeof v === 'number' && v >= 0 && v <= 1,
    wScale: (v) => typeof v === 'number' && v >= 0.5 && v <= 2,
    hScale: (v) => typeof v === 'number' && v >= 0.5 && v <= 2,
    yPos: (v) => typeof v === 'number' && v >= 0 && v <= 2000,
    showTitle: (v) => typeof v === 'boolean',
    showYear: (v) => typeof v === 'boolean',
    showLogo: (v) => typeof v === 'boolean',
    titleBold: (v) => typeof v === 'boolean',
    titleItalic: (v) => typeof v === 'boolean',
    titleCheck: (v) => typeof v === 'boolean',
    yearBold: (v) => typeof v === 'boolean',
    yearItalic: (v) => typeof v === 'boolean',
    kmBold: (v) => typeof v === 'boolean',
    kmItalic: (v) => typeof v === 'boolean',
    goalBold: (v) => typeof v === 'boolean',
    goalItalic: (v) => typeof v === 'boolean',
    color: (v) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v),
    theme: (v) => v === 'light' || v === 'dark',
    logoType: (v) => v === 'fightcancer' || v === 'custom',
    icon: (v) => typeof v === 'string' && v.length <= 10,
    weather: (v) => typeof v === 'string' && v.length <= 10,
    terrain: (v) => typeof v === 'string' && v.length <= 10,
    customLogoBase64: (v) => v === null || (typeof v === 'string' && v.length <= 5000000 && v.startsWith('data:image/')),
    bgImage: (v) => v === null,
    customLogoImg: (v) => v === null,
    fightCancerLogoImg: (v) => v === null,
    badgeOffsetX: (v) => typeof v === 'number',
    badgeOffsetY: (v) => typeof v === 'number',
    logoOffsetX: (v) => typeof v === 'number',
    logoOffsetY: (v) => typeof v === 'number',
    autoDay: (v) => typeof v === 'boolean'
  };

  for (const key in data) {
    if (validators[key]) {
      if (!validators[key](data[key])) {
        throw new Error(`Invalid value for ${key}`);
      }
    }
  }

  return true;
}

// Register fonts for server-side canvas
const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
if (fs.existsSync(FONT_DIR)) {
  const fonts = [
    // Inter
    { file: 'Inter-Regular.ttf', family: 'Inter', weight: '400' },
    { file: 'Inter-Bold.ttf', family: 'Inter', weight: '700' },
    { file: 'Inter-Black.ttf', family: 'Inter', weight: '900' },
    // Noto Serif
    { file: 'NotoSerif-Regular.ttf', family: 'Noto Serif', weight: '400' },
    { file: 'NotoSerif-Bold.ttf', family: 'Noto Serif', weight: '700' },
    // Space Mono
    { file: 'SpaceMono-Regular.ttf', family: 'Space Mono', weight: '400' },
    { file: 'SpaceMono-Bold.ttf', family: 'Space Mono', weight: '700' },
    // Quicksand
    { file: 'Quicksand-Regular.ttf', family: 'Quicksand', weight: '400' },
    { file: 'Quicksand-Bold.ttf', family: 'Quicksand', weight: '700' },
    // Caveat
    { file: 'Caveat-Regular.ttf', family: 'Caveat', weight: '400' },
    { file: 'Caveat-Bold.ttf', family: 'Caveat', weight: '700' }
  ];
  fonts.forEach(f => {
    const fontPath = path.join(FONT_DIR, f.file);
    if (fs.existsSync(fontPath)) {
      registerFont(fontPath, { family: f.family, weight: f.weight });
      console.log(`Registered font ${f.family} (${f.weight})`);
    }
  });
}

function formatNumber(num) {
  return num ? num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "0";
}

function roundRect(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
}

async function renderBadge(config) {
  const canvas = createCanvas(1080, 1920);
  const ctx = canvas.getContext('2d');

  // Background Image
  if (config.bgImageBase64) {
    try {
      const bgImg = await loadImage(config.bgImageBase64);
      const scale = Math.max(canvas.width / bgImg.width, canvas.height / bgImg.height);
      ctx.drawImage(bgImg, (canvas.width - bgImg.width * scale) / 2, (canvas.height - bgImg.height * scale) / 2, bgImg.width * scale, bgImg.height * scale);
    } catch (e) {
      console.error('Error loading background image for SSR:', e.message);
    }
  }

  const baseMargin = 100;
  const baseWidth = canvas.width - (baseMargin * 2);
  const wScale = config.wScale || 1.0;
  const hScale = config.hScale || 0.9;
  const yPos = config.yPos || 1300;

  // Sanitize font family names from config (remove extra quotes if present)
  const sanitizeFont = (f) => (f || 'Inter').replace(/['"]/g, '');
  const yearFont = sanitizeFont(config.yearFont);
  const titleFont = sanitizeFont(config.titleFont);
  const kmFont = sanitizeFont(config.kmFont);
  const goalFont = sanitizeFont(config.goalFont);

  const wW = baseWidth * wScale;
  const wH = 760 * hScale;
  const wX = (canvas.width - wW) / 2;
  const wY = canvas.height - yPos;

  // Card Background
  ctx.save();
  // node-canvas doesn't strictly need shadows for exact same look but we can try
  ctx.fillStyle = config.theme === 'light' ? `rgba(255, 255, 255, ${config.opacity})` : `rgba(15, 23, 42, ${config.opacity})`;
  roundRect(ctx, wX, wY, wW, wH, 80 * wScale, true);
  ctx.restore();

  const perc = Math.min(parseInt(config.km || 0) / config.target, 1);

  // Top Year Text
  if (config.showYear && config.yearText) {
    ctx.save();
    ctx.fillStyle = config.color;
    ctx.font = `${config.yearBold ? '900' : '400'} ${config.yearItalic ? 'italic' : ''} ${config.yearSize * wScale}px "${yearFont}"`;
    ctx.textAlign = 'center';
    ctx.fillText(config.yearText, canvas.width / 2, wY - 60);
    ctx.restore();
  }

  // Badge Circular
  const badgeRadius = 95 * wScale;
  const badgeX = wX + wW - 60 + (config.badgeOffsetX || 0) * wScale;
  const badgeY = wY + 60 + (config.badgeOffsetY || 0) * wScale;

  ctx.fillStyle = config.color;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = `900 ${52 * wScale}px Inter`;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(perc * 100)}%`, badgeX, badgeY + 5);
  ctx.font = `700 ${20 * wScale}px Inter`;
  ctx.fillText('KLAAR', badgeX, badgeY + 45);

  let contentStartY = config.icon ? wY + 130 : wY + 60;

  // Icon
  if (config.icon) {
    ctx.font = `${config.iconSize * wScale}px "Noto Color Emoji"`;
    ctx.textAlign = 'center';
    // If it falls back to monochrome, use the accent color instead of white
    ctx.fillStyle = config.color;
    ctx.fillText(config.icon, canvas.width / 2, contentStartY);
  }

  // Title
  if (config.showTitle && config.title) {
    ctx.fillStyle = config.theme === 'light' ? '#0f172a' : '#f8fafc';
    ctx.font = `${config.titleBold ? '900' : '400'} ${config.titleItalic ? 'italic' : ''} ${config.titleSize * wScale}px "${titleFont}"`;
    ctx.textAlign = 'center';
    const titleX = canvas.width / 2;
    const titleY = config.icon ? wY + 220 : wY + 150;
    ctx.fillText(config.title, titleX, titleY);

    if (config.titleCheck) {
      const textWidth = ctx.measureText(config.title).width;
      const checkX = titleX + (textWidth / 2) + (25 * wScale);
      const checkY = titleY - (15 * wScale);
      const checkSize = 20 * wScale;
      ctx.save();
      ctx.fillStyle = '#10b981';
      ctx.beginPath(); ctx.arc(checkX, checkY, checkSize, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 4 * wScale; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(checkX - checkSize / 2.5, checkY);
      ctx.lineTo(checkX - checkSize / 10, checkY + checkSize / 3);
      ctx.lineTo(checkX + checkSize / 2, checkY - checkSize / 4);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Progress Bar
  const bX = wX + (80 * wScale);
  const bY = config.icon ? wY + 310 : wY + 240;
  const bW = wW - (160 * wScale);
  const bH = 55;
  ctx.fillStyle = config.theme === 'light' ? '#f1f5f9' : '#334155';
  roundRect(ctx, bX, bY, bW, bH, 27, true);
  if (perc > 0.01) {
    ctx.fillStyle = config.color;
    roundRect(ctx, bX, bY, Math.max(bW * perc, 54), bH, 27, true);
  }

  // Kilometers Text
  ctx.fillStyle = config.theme === 'light' ? '#0f172a' : '#f8fafc';
  ctx.font = `${config.kmBold ? '900' : '400'} ${config.kmItalic ? 'italic' : ''} ${config.kmSize * wScale}px "${kmFont}"`;
  ctx.textAlign = 'left';
  ctx.fillText(`${formatNumber(config.km || 0)} km`, bX, bY + 160);

  ctx.fillStyle = '#94a3b8';
  ctx.font = `${config.goalBold ? '700' : '400'} ${config.goalItalic ? 'italic' : ''} ${config.goalSize * wScale}px "${goalFont}"`;
  ctx.textAlign = 'right';
  ctx.fillText(`DOEL: ${formatNumber(config.target)}`, bX + bW, bY + 160);

  // Bottom Stats
  let bottomY = config.icon ? bY + 255 : bY + 235;
  if (config.day) {
    ctx.fillStyle = config.color;
    ctx.font = `900 ${42 * wScale}px Inter`;
    ctx.textAlign = 'left';
    ctx.fillText(`DAG ${config.day}`, bX, bottomY);
    bottomY += 55;
  }
  if (config.steps) {
    ctx.fillStyle = config.theme === 'light' ? '#64748b' : '#94a3b8';
    ctx.font = `bold ${38 * wScale}px Inter`;
    ctx.textAlign = 'left';
    ctx.fillText(`👣 ${formatNumber(config.steps)} STAPPEN`, bX, bottomY);
    bottomY += 55;
  }
  if (config.handle) {
    ctx.fillStyle = config.color;
    ctx.font = `900 ${36 * wScale}px Inter`;
    ctx.textAlign = 'left';
    ctx.fillText(config.handle.toUpperCase(), bX, bottomY + 10);
  }

  // Weather & Terrain
  if (config.weather || config.terrain) {
    ctx.font = `${50 * wScale}px "Noto Color Emoji"`;
    ctx.textAlign = 'right';
    ctx.fillStyle = config.theme === 'light' ? '#64748b' : '#94a3b8';
    const weatherY = config.icon ? bY + 250 : bY + 230;
    ctx.fillText(`${config.weather} ${config.terrain}`, bX + bW, weatherY);
  }

  // Logo
  if (config.showLogo) {
    let logoImg = null;
    const lS = 110 * wScale;
    const lX = wX + wW - lS - 60 + (config.logoOffsetX || 0) * wScale;
    const lY = wY + wH - lS - 60 + (config.logoOffsetY || 0) * wScale;

    try {
      if (config.logoType === 'fightcancer') {
        logoImg = await loadImage(path.join(__dirname, 'fight_cancer_logo.png'));
      } else if (config.logoType === 'custom' && config.customLogoBase64) {
        logoImg = await loadImage(config.customLogoBase64);
      }

      if (logoImg) {
        ctx.drawImage(logoImg, lX, lY, lS, lS);
      }
    } catch (e) {
      console.error('Error loading logo for SSR:', e.message);
    }
  }

  return canvas.toBuffer('image/png');
}

// Queued save function to prevent race conditions
function saveConfig(config) {
  writeQueue = writeQueue
    .then(() => fs.promises.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2)))
    .catch(err => console.error('Error saving config:', err));
  return writeQueue;
}

// Broadcast to clients, optionally excluding one
function broadcastConfig(config, excludeWs = null) {
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'UPDATE_CONFIG', data: config }));
    }
  });
}

// Default configuration (shared with frontend)
const DEFAULT_CONFIG = {
  title: 'WandelChallenge',
  showTitle: true,
  titleFont: 'Inter',
  titleSize: 52,
  titleBold: true,
  titleItalic: false,
  titleCheck: false,
  yearText: '2026',
  yearFont: 'Inter',
  yearBold: true,
  yearItalic: false,
  yearSize: 180,
  showYear: true,
  km: 25,
  kmFont: 'Inter',
  kmSize: 85,
  kmBold: true,
  kmItalic: false,
  target: 2026,
  day: '',
  steps: '',
  handle: '',
  color: '#10b981',
  theme: 'light',
  icon: '',
  iconSize: 95,
  goalFont: 'Inter',
  goalSize: 45,
  goalBold: true,
  goalItalic: false,
  opacity: 0.90,
  showLogo: true,
  logoType: 'fightcancer',
  customLogoBase64: null,
  bgImage: null,
  customLogoImg: null,
  fightCancerLogoImg: null,
  weather: '',
  terrain: '',
  wScale: 1.0,
  hScale: 0.9,
  wScale: 1.0,
  hScale: 0.9,
  yPos: 1300,
  badgeOffsetX: 0,
  badgeOffsetY: 0,
  logoOffsetX: 0,
  logoOffsetY: 0,
  autoDay: true
};

let currentConfig = DEFAULT_CONFIG;
let isDefault = true;

// Load config from file if it exists
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = fs.readFileSync(CONFIG_FILE, 'utf8');
    currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    isDefault = false;
  } catch (err) {
    console.error('Error reading config file:', err);
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// Apply rate limiter to API routes
app.use('/api/', apiLimiter);

app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

app.get('/api/badge.png', async (req, res) => {
  try {
    const buffer = await renderBadge(currentConfig);
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.send(buffer);
  } catch (err) {
    console.error('Error rendering badge:', err);
    res.status(500).send('Error rendering badge');
  }
});

app.post('/api/config', async (req, res) => {
  try {
    // Merge with defaults first, then validate
    const mergedConfig = { ...DEFAULT_CONFIG, ...req.body };
    validateConfig(mergedConfig);

    currentConfig = mergedConfig;
    isDefault = false;

    // Broadcast to all clients (no way to exclude sender in HTTP POST)
    broadcastConfig(currentConfig);

    // Persist to file with queue
    await saveConfig(currentConfig);

    res.sendStatus(200);
  } catch (err) {
    console.error('Invalid config:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Helper function to check WebSocket rate limit
function checkWsRateLimit(ws) {
  const now = Date.now();
  const clientData = wsMessageLimits.get(ws) || { count: 0, resetTime: now + WS_WINDOW_MS };

  // Reset counter if window has passed
  if (now >= clientData.resetTime) {
    clientData.count = 0;
    clientData.resetTime = now + WS_WINDOW_MS;
  }

  clientData.count++;
  wsMessageLimits.set(ws, clientData);

  return clientData.count <= WS_RATE_LIMIT;
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  // Send current config to new client
  ws.send(JSON.stringify({ type: 'INIT_CONFIG', data: currentConfig, isDefault }));

  ws.on('message', async (message) => {
    // Check rate limit
    if (!checkWsRateLimit(ws)) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Rate limit exceeded. Please slow down.' }));
      return;
    }

    try {
      const payload = JSON.parse(message);
      if (payload.type === 'SET_CONFIG') {
        // Merge with defaults first, then validate
        const mergedConfig = { ...DEFAULT_CONFIG, ...payload.data };
        validateConfig(mergedConfig);

        currentConfig = mergedConfig;
        isDefault = false;

        // Broadcast to all OTHER clients (excluding sender)
        broadcastConfig(currentConfig, ws);

        // Persist to file with queue
        await saveConfig(currentConfig);
      }
    } catch (err) {
      console.error('Error processing message:', err.message);
      ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
    }
  });

  ws.on('close', () => {
    // Clean up rate limit data when connection closes
    wsMessageLimits.delete(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
