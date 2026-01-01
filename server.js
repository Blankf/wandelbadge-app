const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 80;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
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

app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

app.post('/api/config', (req, res) => {
  currentConfig = req.body;
  isDefault = false;
  // Broadcast to all other clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'UPDATE_CONFIG', data: currentConfig }));
    }
  });

  // Persist to file
  fs.writeFile(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), (err) => {
    if (err) console.error('Error saving config:', err);
  });

  res.sendStatus(200);
});

wss.on('connection', (ws) => {
  console.log('Client connected');
  // Send current config to new client
  ws.send(JSON.stringify({ type: 'INIT_CONFIG', data: currentConfig, isDefault }));

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message);
      if (payload.type === 'SET_CONFIG') {
        currentConfig = payload.data;
        isDefault = false;
        // Broadcast to ALL OTHER clients
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'UPDATE_CONFIG', data: currentConfig }));
          }
        });

        // Persist to file
        fs.writeFile(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), (err) => {
          if (err) console.error('Error saving config:', err);
        });
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
