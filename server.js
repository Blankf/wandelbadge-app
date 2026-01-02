const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

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
    day: (v) => v === '' || (typeof v === 'string' && v.length <= 10),
    steps: (v) => v === '' || (typeof v === 'string' && v.length <= 20),
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
    fightCancerLogoImg: (v) => v === null
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
  yPos: 1300
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
