const fs = require('fs');
const express = require('express');
const session = require('express-session');
// Gestionnaire d'erreurs non gérées — évite les crashs
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] UnhandledRejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[ERROR] UncaughtException:', err.message);
});


const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const SQLiteStore = require('connect-sqlite3')(session);
const cors = require('cors');
const { checkOllamaStatus } = require('./src/services/ai');
const { initDb } = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'jdrnotes-secret-change-in-prod';

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors({ origin: true, credentials: true }));

// Logs d'accès
const accessLogStream = fs.createWriteStream('/var/log/jdrnotes-access.log', { flags: 'a' });
app.use(morgan(':date[iso] :remote-addr :method :url :status :response-time ms - :res[content-length]', { stream: accessLogStream }));
// Log connexions uniquement sur stdout
app.use('/api/auth/login', (req, res, next) => {
  const orig = res.json.bind(res);
  res.json = (body) => {
    if (body && !body.error) {
      console.log(`[LOGIN] ${req.ip} → ${req.body?.username || req.body?.email} OK`);
    } else if (body && body.error) {
      console.log(`[LOGIN FAIL] ${req.ip} → ${req.body?.username || req.body?.email}`);
    }
    return orig(body);
  };
  next();
});

// Rate limiting
const limiterApi = rateLimit({ windowMs: 15*60*1000, max: 300, message: { error: 'Trop de requêtes' } });
const limiterAuth = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Trop de tentatives de connexion' } });
app.use('/api/', limiterApi);
// Exclure WebSocket du rate limiter
app.use('/api/auth/login', limiterAuth);

app.use(session({
  secret: SECRET,
  store: new SQLiteStore({ db: 'sessions.db', dir: '/opt/jdrnotes/data' }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    // maxAge non défini = session cookie (expire à la fermeture du navigateur)
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/campaigns', require('./src/routes/campaigns'));
app.use('/api/sessions', require('./src/routes/sessions'));
app.use('/api/upload', require('./src/routes/upload'));
app.use('/api/characters', require('./src/routes/characters'));
app.use('/api/invitations', require('./src/routes/invitations'));
app.use('/api/search', require('./src/routes/search'));
app.use('/api/mindmap', require('./src/routes/mindmap'));
app.use('/api/planning', require('./src/routes/planning'));
app.use('/api/timeline', require('./src/routes/timeline'));
app.use('/api/quests', require('./src/routes/quests'));
app.use('/api/notes', require('./src/routes/notes'));
app.use('/api/messages', require('./src/routes/messages'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/vtt', require('./src/routes/vtt'));
app.use('/api/sw', require('./src/routes/sw'));
app.use('/api/cpr', require('./src/routes/cpr'));
app.use('/maps', require('express').static(require('path').join(__dirname, 'maps')));

// Page publique de partage
app.get('/share/:token', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VaultLog — Session partagée</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0f0e17; color: #e8e0d0; font-family: 'Crimson Pro', serif; font-size: 17px; line-height: 1.7; padding: 32px 16px; }
.container { max-width: 760px; margin: 0 auto; }
h1 { font-family: Cinzel, serif; color: #c9a84c; font-size: 28px; margin-bottom: 8px; }
h2 { font-family: Cinzel, serif; color: #c9a84c; font-size: 18px; margin: 24px 0 8px; border-bottom: 1px solid #333; padding-bottom: 6px; }
.meta { color: #888; font-size: 14px; margin-bottom: 32px; }
.content { white-space: pre-wrap; }
.badge { background: #1a1a2e; border: 1px solid #c9a84c; color: #c9a84c; padding: 2px 10px; border-radius: 20px; font-size: 13px; }
</style>
</head>
<body>
<div class="container">
  <div id="content"><p style="color:#888">Chargement...</p></div>
</div>
<script>
fetch('/api/sessions/public/${req.params.token}')
  .then(r => r.json())
  .then(s => {
    if (s.error) { document.getElementById('content').innerHTML = '<p style="color:#c04040">Session introuvable ou lien expiré.</p>'; return; }
    document.title = s.title + ' — VaultLog';
    document.getElementById('content').innerHTML =
      '<span class="badge">' + s.campaign_title + '</span>' +
      '<h1 style="margin-top:16px">' + s.title + '</h1>' +
      '<div class="meta">Session #' + s.number + ' · ' + (s.date || '') + '</div>' +
      (s.summary ? '<h2>Résumé</h2><div class="content">' + s.summary + '</div>' : '') +
      (s.narrative ? '<h2>Récit</h2><div class="content">' + s.narrative + '</div>' : '');
  })
  .catch(() => { document.getElementById('content').innerHTML = '<p style="color:#c04040">Erreur de chargement.</p>'; });
</script>
</body>
</html>`);
});

// AI status endpoint
app.get('/api/ai/status', async (req, res) => {
  const online = await checkOllamaStatus();
  res.json({ online });
});

// Serve SPA for all other routes


// Export PDF session
app.get('/api/sessions/:id/pdf', async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  const { getDb } = require('./src/database');
  const db = getDb();
  const session = db.prepare(`
    SELECT s.*, c.title as campaign_title FROM sessions s
    JOIN campaigns c ON c.id=s.campaign_id WHERE s.id=?`).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });

  // Vérifier accès
  const uid = req.session && req.session.userId;
  if (!uid) return res.status(401).json({ error: 'Non authentifié' });
  const isMember = db.prepare('SELECT id FROM campaign_members WHERE campaign_id=? AND user_id=?').get(session.campaign_id, uid);
  const isOwner = session.user_id === uid;
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(uid);
  if (!isMember && !isOwner && !(user && user.is_admin)) return res.status(403).json({ error: 'Accès refusé' });

  // Récupérer notes partagées
  const notes = db.prepare("SELECT n.*, u.username FROM notes n JOIN users u ON u.id=n.user_id WHERE n.session_id=? AND n.visibility='shared'").all(req.params.id);

  // Charger transcription si disponible
  let transcript = '';
  if (session.audio_file) {
    try {
      const txtPath = require('path').join('/opt/jdrnotes/audio', session.audio_file.replace(/\.[^.]+$/, '.txt'));
      if (require('fs').existsSync(txtPath)) transcript = require('fs').readFileSync(txtPath, 'utf8');
    } catch(e) {}
  }

  const outputPath = `/tmp/session_${session.id}_${Date.now()}.pdf`;
  const payload = JSON.stringify({ session: { ...session, notes, transcript }, output: outputPath });

  const { execFileSync } = require('child_process');
  try {
    execFileSync('python3', ['/opt/jdrnotes/src/generate_pdf.py'], { input: payload, encoding: 'utf8' });
    res.download(outputPath, `session_${session.number}_${session.title}.pdf`, () => {
      require('fs').unlinkSync(outputPath);
    });
  } catch(e) {
    console.error('PDF error:', e.message);
    console.error('PDF stderr:', e.stderr?.toString());
    console.error('PDF stdout:', e.stdout?.toString());
    res.status(500).json({ error: e.message });
  }
});

// Page d'invitation
app.get('/invite/:token', async (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation VaultLog</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0e17; color: #e8e6f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1825; border: 1px solid #2a2838; border-radius: 12px; padding: 40px; max-width: 440px; width: 100%; margin: 20px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #d4af37; }
    p { color: #9896a8; margin-bottom: 24px; font-size: 15px; }
    .campaign-name { color: #e8e6f0; font-weight: 600; font-size: 18px; margin-bottom: 24px; }
    input { width: 100%; padding: 10px 14px; background: #0f0e17; border: 1px solid #2a2838; border-radius: 6px; color: #e8e6f0; font-size: 15px; margin-bottom: 12px; outline: none; }
    input:focus { border-color: #d4af37; }
    button { width: 100%; padding: 12px; background: #2e7d4f; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; }
    button:hover { background: #3a9960; }
    .error { color: #ef4444; font-size: 14px; margin-top: 12px; }
    .success { color: #2e7d4f; font-size: 14px; margin-top: 12px; }
    #new-account { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎲 VaultLog</h1>
    <div id="loading"><p>Vérification de l'invitation...</p></div>
    <div id="content" style="display:none">
      <p>Vous avez été invité à rejoindre</p>
      <div class="campaign-name" id="campaign-name"></div>
      <div id="existing-user" style="display:none">
        <p>Votre compte existe déjà. Cliquez pour rejoindre la campagne.</p>
        <button onclick="accept()">Rejoindre la campagne</button>
      </div>
      <div id="new-account">
        <input type="text" id="username" placeholder="Nom d'utilisateur">
        <input type="password" id="password" placeholder="Mot de passe">
        <button onclick="accept()">Créer mon compte et rejoindre</button>
      </div>
      <div id="msg"></div>
    </div>
    <div id="error-msg" style="display:none; color:#ef4444"></div>
  </div>
  <script>
    const token = '${req.params.token}';
    let inviteData = null;

    fetch('/api/invitations/' + token)
      .then(r => r.json())
      .then(data => {
        document.getElementById('loading').style.display = 'none';
        if (data.error) {
          document.getElementById('error-msg').style.display = 'block';
          document.getElementById('error-msg').textContent = data.error;
          return;
        }
        inviteData = data;
        document.getElementById('campaign-name').textContent = data.campaign_title;
        document.getElementById('content').style.display = 'block';
        if (data.user_exists) {
          document.getElementById('existing-user').style.display = 'block';
        } else {
          document.getElementById('new-account').style.display = 'block';
        }
      });

    async function accept() {
      const body = { username: document.getElementById('username')?.value, password: document.getElementById('password')?.value };
      const r = await fetch('/api/invitations/' + token + '/accept', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await r.json();
      if (data.error) { document.getElementById('msg').innerHTML = '<div class="error">' + data.error + '</div>'; return; }
      document.getElementById('msg').innerHTML = '<div class="success">✅ Bienvenue ! Redirection...</div>';
      setTimeout(() => window.location.href = '/', 1500);
    }
  </script>
</body>
</html>`);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
initDb().then(() => {
const https = require('https');
const sslOptions = {
  cert: fs.readFileSync('/etc/letsencrypt/live/jdrnotes.duckdns.org/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/jdrnotes.duckdns.org/privkey.pem')
};
const server = https.createServer(sslOptions, app);

// WebSocket VTT
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════╗
║         VAULTLOG — Archives JDR       ║
╠═══════════════════════════════════════╣
║  Serveur actif sur le port ${PORT}       ║
║  http://localhost:${PORT}               ║
╠═══════════════════════════════════════╣
║  Ollama URL: ${process.env.OLLAMA_URL || 'http://localhost:11434'}  ║
║  Modèle:     ${process.env.OLLAMA_MODEL || 'llama3.2'}              ║
╚═══════════════════════════════════════╝
  `);
});

// WEBSOCKET VTT
// ═══════════════════════════════════════

const vttRooms = {}; // roomId -> Set of clients

wss.on('connection', (ws, req) => {
  let roomId = null;
  let userId = null;
  let username = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'join') {
        roomId = msg.room_id;
        userId = msg.user_id;
        username = msg.username;
        if (!vttRooms[roomId]) vttRooms[roomId] = new Set();
        vttRooms[roomId].add(ws);
        broadcast(roomId, { type: 'user_joined', username }, ws);
      } else if (roomId) {
        broadcast(roomId, { ...msg, username }, ws);
      }
    } catch(e) {}
  });
  ws.on('close', () => {
    if (roomId && vttRooms[roomId]) {
      vttRooms[roomId].delete(ws);
      broadcast(roomId, { type: 'user_left', username });
    }
  });

});
function broadcast(roomId, msg, exclude = null) {
  if (!vttRooms[roomId]) return;
  const data = JSON.stringify(msg);
  vttRooms[roomId].forEach(client => {
    if (client !== exclude && client.readyState === 1) client.send(data);
  });
}

});

// Nettoyage fichiers audio expirés (toutes les heures)
const fs_cleanup = require('fs');
const path_cleanup = require('path');
const AUDIO_DIR_CLEANUP = path_cleanup.join(__dirname, 'audio');
setInterval(() => {
  try {
    const files = fs_cleanup.readdirSync(AUDIO_DIR_CLEANUP).filter(f => f.endsWith('.expiry'));
    for (const f of files) {
      const expiry = parseInt(fs_cleanup.readFileSync(path_cleanup.join(AUDIO_DIR_CLEANUP, f), 'utf8'));
      if (Date.now() > expiry) {
        const audioFile = path_cleanup.join(AUDIO_DIR_CLEANUP, f.replace('.expiry', ''));
        try { fs_cleanup.unlinkSync(audioFile); } catch(e) {}
        try { fs_cleanup.unlinkSync(path_cleanup.join(AUDIO_DIR_CLEANUP, f)); } catch(e) {}
        console.log('Fichier audio expiré supprimé:', f.replace('.expiry', ''));
      }
    }
  } catch(e) {}
}, 60 * 60 * 1000);

// ═══════════════════════════════════════
