const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const router = express.Router();

const AUDIO_DIR = '/opt/vaultlog/audio';
const PYTHON = '/home/malik/.pyenv/versions/3.11.10/bin/python3';
const TRANSCRIBE = '/opt/vaultlog/transcribe.py';
const transcribeJobs = {};

fs.mkdirSync(AUDIO_DIR, { recursive: true });

function authAny(req, res, next) {
  if (req.session && req.session.userId) return next();
  const token = req.headers['x-api-token'] || req.query.token;
  if (token) {
    const { getDb } = require('../database');
    const t = getDb().prepare('SELECT * FROM api_tokens WHERE token = ?').get(token);
    if (t) { req.session.userId = t.user_id; return next(); }
  }
  return res.status(401).json({ error: 'Non authentifié' });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp3','.wav','.flac','.ogg','.m4a','.mkv','.webm','.zip'].includes(ext)) cb(null, true);
    else cb(new Error('Format non supporté: ' + ext));
  }
});

router.get('/files', authAny, (req, res) => {
  try {
    const files = fs.readdirSync(AUDIO_DIR)
      .filter(f => /\.(mp3|wav|flac|ogg|m4a|mkv|webm|zip)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(AUDIO_DIR, f));
        return { name: f, size: stat.size, date: stat.mtime };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(files);
  } catch(e) { res.json([]); }
});

router.get('/campaign/:campaignId', authAny, (req, res) => {
  const { getDb } = require('../database');
  const files = getDb().prepare('SELECT * FROM audio_files WHERE campaign_id = ? ORDER BY created_at DESC').all(req.params.campaignId);
  const result = files.map(f => {
    const fp = path.join(AUDIO_DIR, f.filename);
    const exists = fs.existsSync(fp);
    const stat = exists ? fs.statSync(fp) : null;
    return { ...f, exists, size: stat ? stat.size : 0 };
  });
  res.json(result);
});

router.post('/mix/:filename', authAny, (req, res) => {
  const { spawn } = require('child_process');
  const zipPath = path.join(AUDIO_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(zipPath)) return res.status(404).json({ error: 'Fichier introuvable' });
  if (!zipPath.endsWith('.zip')) return res.status(400).json({ error: 'Pas un ZIP Craig' });

  const outputName = req.params.filename.replace('.zip', '_mix.mp3');
  const outputPath = path.join(AUDIO_DIR, outputName);

  // Extraire le ZIP et mixer les pistes
  const tmpDir = require('os').tmpdir() + '/mix_' + Date.now();
  fs.mkdirSync(tmpDir);

  const unzip = spawn('unzip', ['-o', zipPath, '-d', tmpDir]);
  unzip.on('close', code => {
    if (code !== 0) { fs.rmSync(tmpDir, { recursive: true }); return res.status(500).json({ error: 'Erreur extraction ZIP' }); }
    const tracks = fs.readdirSync(tmpDir).filter(f => /\.(wav|flac|mp3|ogg)$/i.test(f));
    if (!tracks.length) { fs.rmSync(tmpDir, { recursive: true }); return res.status(400).json({ error: 'Aucune piste audio' }); }

    // Construire la commande ffmpeg pour mixer toutes les pistes
    const inputs = tracks.flatMap(t => ['-i', path.join(tmpDir, t)]);
    const filter = tracks.length > 1 ? [`${tracks.map((_,i) => `[${i}:a]`).join('')}amix=inputs=${tracks.length}:duration=longest[out]`] : null;
    const ffmpegArgs = filter
      ? [...inputs, '-filter_complex', filter[0], '-map', '[out]', '-q:a', '2', outputPath]
      : [...inputs, '-q:a', '2', outputPath];

    const ffmpeg = spawn('ffmpeg', ['-y', ...ffmpegArgs]);
    ffmpeg.on('close', code2 => {
      fs.rmSync(tmpDir, { recursive: true });
      if (code2 !== 0) return res.status(500).json({ error: 'Erreur mixage ffmpeg' });
      // Enregistrer en BDD
      try {
        const { getDb } = require('../database');
        const expires = new Date(Date.now() + 48*60*60*1000).toISOString();
        const orig = getDb().prepare('SELECT * FROM audio_files WHERE filename = ?').get(path.basename(req.params.filename));
        getDb().prepare('INSERT OR IGNORE INTO audio_files (filename, campaign_id, titre, expires_at) VALUES (?, ?, ?, ?)').run(outputName, orig ? orig.campaign_id : 0, (orig ? orig.titre : '') + ' (mix)', expires);
      } catch(e) {}
      res.json({ success: true, filename: outputName });
    });
  });
});

router.get('/files/:filename/tracks', authAny, (req, res) => {
  const fp = path.join(AUDIO_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier introuvable' });
  if (!fp.endsWith('.zip')) return res.json({ tracks: [] });
  const { execSync } = require('child_process');
  try {
    const out = execSync('unzip -l ' + fp).toString();
    const tracks = [];
    out.split('\n').forEach(line => {
      const m = line.match(/\d+-(.+)\.(wav|flac|mp3|ogg)$/i);
      if (m && m[1] !== 'global_mix') tracks.push(m[1]);
    });
    res.json({ tracks });
  } catch(e) { res.json({ tracks: [] }); }
});

router.get('/files/:filename/download', authAny, (req, res) => {
  const fp = path.join(AUDIO_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.download(fp);
});

router.post('/', authAny, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  res.json({ success: true, filename: req.file.filename, originalname: req.file.originalname, size: req.file.size });
});

router.delete('/files/:filename', authAny, (req, res) => {
  const fp = path.join(AUDIO_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Fichier introuvable' });
  fs.unlinkSync(fp);
  res.json({ success: true });
});

router.post('/transcribe', authAny, (req, res) => {
  const { filename, campaign_id, titre, num_speakers, speaker_mappings, min_speakers, max_speakers, clustering_threshold } = req.body;
  if (!filename || !campaign_id) return res.status(400).json({ error: 'filename et campaign_id requis' });
  const filePath = path.join(AUDIO_DIR, path.basename(filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  const jobId = Date.now().toString();
  transcribeJobs[jobId] = { status: 'pending', progress: 'Démarrage...', percent: 0 };
  // Enregistrer en BDD
  try {
    const { getDb } = require('../database');
    const expires = new Date(Date.now() + 48*60*60*1000).toISOString();
    getDb().prepare('INSERT OR IGNORE INTO audio_files (filename, campaign_id, titre, expires_at) VALUES (?, ?, ?, ?)').run(path.basename(filename), campaign_id, titre || null, expires);
  } catch(e) {}
  res.json({ success: true, job_id: jobId });
  const args = [TRANSCRIBE, filePath];
  if (num_speakers && parseInt(num_speakers) > 0) args.push(num_speakers.toString());
  if (min_speakers) args.push('--min-speakers', min_speakers.toString());
  if (max_speakers) args.push('--max-speakers', max_speakers.toString());
  if (clustering_threshold) args.push('--threshold', clustering_threshold.toString());
  const proc = spawn(PYTHON, args);
  let stdout = '', stderr = '';
  proc.stdout.on('data', d => stdout += d);
  proc.stderr.on('data', d => {
    stderr += d;
    const line = d.toString().trim();
    // Détecter les étapes de progression
    if (line.includes('Transcription de')) {
      const name = line.replace('Transcription de', '').replace('...', '').trim();
      transcribeJobs[jobId] = { ...transcribeJobs[jobId], status: 'running', progress: 'Transcription de ' + name, percent: 30 };
    } else if (line.includes('Diarisation')) {
      transcribeJobs[jobId] = { ...transcribeJobs[jobId], status: 'running', progress: 'Diarisation en cours...', percent: 60 };
    } else if (line.includes('Finalisation') || line.includes('segments')) {
      transcribeJobs[jobId] = { ...transcribeJobs[jobId], status: 'running', progress: 'Finalisation...', percent: 90 };
    }
  });
  proc.on('close', code => {
    if (code !== 0) { transcribeJobs[jobId] = { status: 'error', error: stderr.slice(-300) }; return; }
    try {
      const segments = JSON.parse(stdout);
      if (!segments.length) { transcribeJobs[jobId] = { status: 'error', error: 'Aucune parole détectée' }; return; }
      const mappings = speaker_mappings || {};
      const lines = [];
      let cur = null;
      for (const seg of segments) {
        let spk = seg.speaker || 'Inconnu';
        if (mappings[spk]) spk = mappings[spk];
        if (spk !== cur) { cur = spk; lines.push('\n[' + spk + ']'); }
        lines.push(seg.text);
      }
      const rawNotes = lines.join('\n').trim();
      const { getDb } = require('../database');
      const db = getDb();
      const last = db.prepare('SELECT MAX(number) as max FROM sessions WHERE campaign_id = ?').get(campaign_id);
      const num = (last.max || 0) + 1;
      const title = titre || 'Session ' + num;
      const today = new Date().toISOString().split('T')[0];
      const result = db.prepare('INSERT INTO sessions (campaign_id, number, title, date, raw_notes) VALUES (?, ?, ?, ?, ?)').run(campaign_id, num, title, today, rawNotes);
      db.prepare('UPDATE campaigns SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(campaign_id);
      transcribeJobs[jobId] = { status: 'done', session_id: result.lastInsertRowid, session_number: num, title };
      // Lancer le résumé IA automatiquement
      try {
        const sessionId = result.lastInsertRowid;
        const aiJobId = Date.now().toString() + '_ai';
        const { generateSummary } = require('../services/ai');
        setImmediate(async () => {
          try {
            const summary = await generateSummary(rawNotes, title);
            if (summary) {
              db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, sessionId);
              transcribeJobs[jobId] = { ...transcribeJobs[jobId], summary_done: true };
              console.log('[AI] Résumé généré pour session', sessionId);
            }
          } catch(e) { console.error('[AI] Erreur résumé auto:', e.message); }
        });
      } catch(e) {}
      // Marquer le fichier pour suppression dans 48h
      try { fs.writeFileSync(filePath + '.expiry', (Date.now() + 48*60*60*1000).toString()); } catch(e2) {}
    } catch(e) { transcribeJobs[jobId] = { status: 'error', error: e.message }; }
  });
});

router.get('/job/:id', authAny, (req, res) => {
  res.json(transcribeJobs[req.params.id] || { status: 'pending' });
});

module.exports = router;
