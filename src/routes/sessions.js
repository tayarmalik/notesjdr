const express = require('express');
const { getDb } = require('../database');
const { generateSessionNotes, generateSummary, askQuestion } = require('../services/ai');
const summaryJobs = {};

const router = express.Router();

function canAccess(session, req, db) {
  if (!session) return false;
  if (session.user_id === req.session.userId) return true;
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  if (user && user.is_admin) return true;
  const isMember = db.prepare('SELECT id FROM campaign_members WHERE campaign_id=? AND user_id=?').get(session.campaign_id, req.session.userId);
  return !!isMember;
}

function authAny(req, res, next) {
  if (req.session && req.session.userId) return next();
  const token = req.headers['x-api-token'] || req.query.token;
  if (token) {
    const db = getDb();
    const t = db.prepare('SELECT * FROM api_tokens WHERE token = ?').get(token);
    if (t) { req.session.userId = t.user_id; return next(); }
  }
  return res.status(401).json({ error: 'Non authentifié' });
}

function getCampaignForUser(campaignId, userId) {
  return getDb().prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(campaignId, userId);
}

router.get('/campaign/:campaignId', authAny, (req, res) => {
  const db = getDb();
  if (!getCampaignForUser(req.params.campaignId, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  const sessions = db.prepare('SELECT * FROM sessions WHERE campaign_id = ? ORDER BY number DESC').all(req.params.campaignId);
  res.json(sessions);
});

router.post('/campaign/:campaignId', authAny, (req, res) => {
  const db = getDb();
  const campaign = getCampaignForUser(req.params.campaignId, req.session.userId);
  if (!campaign) return res.status(403).json({ error: 'Accès refusé' });
  const { title, date, raw_notes, number } = req.body;
  const lastSession = db.prepare('SELECT MAX(number) as max FROM sessions WHERE campaign_id = ?').get(req.params.campaignId);
  const sessionNumber = number || (lastSession.max || 0) + 1;
  const result = db.prepare(
    'INSERT INTO sessions (campaign_id, number, title, date, raw_notes) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.campaignId, sessionNumber, title || `Session ${sessionNumber}`, date || new Date().toISOString().split('T')[0], raw_notes || '');
  db.prepare('UPDATE campaigns SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.campaignId);
  // Notifier les membres de la campagne
  try {
    const members = db.prepare('SELECT user_id FROM campaign_members WHERE campaign_id = ?').all(req.params.campaignId);
    const sessionTitle = title || `Session ${sessionNumber}`;
    const notifier = db.prepare('SELECT username FROM users WHERE id=?').get(req.session.userId);
    for (const m of members) {
      if (m.user_id === req.session.userId) continue;
      db.prepare('INSERT INTO messages (from_user_id, to_user_id, type, subject, content, data) VALUES (?, ?, ?, ?, ?, ?)').run(
        req.session.userId, m.user_id, 'notification',
        'Nouvelle session : ' + sessionTitle,
        (notifier?.username || 'Le MJ') + ' a créé la session "' + sessionTitle + '" dans la campagne ' + campaign.title + '.',
        JSON.stringify({ campaign_id: parseInt(req.params.campaignId), session_id: result.lastInsertRowid })
      );
    }
  } catch(e) {}
  res.json({ id: result.lastInsertRowid, number: sessionNumber });
});

router.get('/:id', authAny, (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.*, c.title as campaign_title, c.user_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?').get(req.params.id);
  if (!canAccess(session, req, db)) return res.status(404).json({ error: 'Session introuvable' });
  const characters = db.prepare('SELECT ch.* FROM characters ch JOIN session_characters sc ON sc.character_id = ch.id WHERE sc.session_id = ?').all(req.params.id);
  res.json({ ...session, characters });
});

router.put('/:id', authAny, (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.*, c.user_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?').get(req.params.id);
  if (!canAccess(session, req, db)) return res.status(403).json({ error: 'Accès refusé' });
  const { title, date, raw_notes, summary, narrative } = req.body;
  // Enregistrer historique des modifications
  const fields = { title, date, raw_notes, summary, narrative };
  for (const [field, newVal] of Object.entries(fields)) {
    const oldVal = session[field] || '';
    const nv = newVal || '';
    if (oldVal !== nv) {
      try {
        db.prepare('INSERT INTO session_history (session_id, user_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)').run(
          req.params.id, req.session.userId, field,
          oldVal.length > 500 ? oldVal.slice(0, 500) + '...' : oldVal,
          nv.length > 500 ? nv.slice(0, 500) + '...' : nv
        );
      } catch(e) {}
    }
  }
  db.prepare('UPDATE sessions SET title=?, date=?, raw_notes=?, summary=?, narrative=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(title || '', date || '', raw_notes || '', summary || '', narrative || '', req.params.id);
  res.json({ success: true });
});

// GET /api/sessions/:id/history
router.get('/:id/history', authAny, (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.id, c.user_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?').get(req.params.id);
  if (!canAccess(session, req, db)) return res.status(403).json({ error: 'Accès refusé' });
  const history = db.prepare(`
    SELECT h.*, u.username FROM session_history h
    JOIN users u ON u.id = h.user_id
    WHERE h.session_id = ? ORDER BY h.created_at DESC LIMIT 50
  `).all(req.params.id);
  res.json(history);
});

router.post('/:id/generate', authAny, (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.*, c.title as campaign_title, c.user_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?').get(req.params.id);
  if (!canAccess(session, req, db)) return res.status(403).json({ error: 'Accès refusé' });
  if (!session.raw_notes) return res.status(400).json({ error: 'Aucune note brute à traiter' });

  const jobId = Date.now().toString();
  summaryJobs[jobId] = { status: 'pending' };
  res.json({ job_id: jobId });

  (async () => {
    try {
      let result;
      if (session.raw_notes.length < 20000) {
        result = await generateSessionNotes(session.raw_notes);
      }
      if (!result) {
        const summary = await generateSummary(session.raw_notes);
        if (summary) result = { summary, narrative: '', ai_generated: true };
      }
      if (!result) { summaryJobs[jobId] = { status: 'error', error: 'IA indisponible' }; return; }
      const { getDb: getDb2 } = require('../database');
      console.error('result avant UPDATE:', JSON.stringify(result).slice(0,300));
      getDb2().prepare('UPDATE sessions SET summary=?, narrative=?, ai_generated=1, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(result.summary || '', result.narrative || '', req.params.id);
      summaryJobs[jobId] = { status: 'done', result };
    } catch(e) {
      console.error('Summary job error:', e.message);
      summaryJobs[jobId] = { status: 'error', error: e.message };
    }
  })();
});

// POST /api/sessions/:id/share — générer un lien de partage public
router.post('/:id/share', authAny, (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.id, c.user_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?').get(req.params.id);
  if (!canAccess(session, req, db)) return res.status(403).json({ error: 'Accès refusé' });
  const crypto = require('crypto');
  let token = db.prepare('SELECT share_token FROM sessions WHERE id = ?').get(req.params.id)?.share_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE sessions SET share_token = ? WHERE id = ?').run(token, req.params.id);
  }
  res.json({ token, url: '/share/' + token });
});

// DELETE /api/sessions/:id/share — révoquer le partage
router.delete('/:id/share', authAny, (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.id, c.user_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?').get(req.params.id);
  if (!canAccess(session, req, db)) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('UPDATE sessions SET share_token = NULL WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/sessions/public/:token — lecture publique
router.get('/public/:token', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.*, c.title as campaign_title FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.share_token = ?').get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session introuvable ou lien expiré' });
  res.json({ id: session.id, title: session.title, date: session.date, summary: session.summary, narrative: session.narrative, campaign_title: session.campaign_title, number: session.number });
});

router.get('/:id/generate/job/:jobId', authAny, (req, res) => {
  const job = summaryJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

router.post('/campaign/:campaignId/ask', authAny, async (req, res) => {
  const db = getDb();
  const campaign = getCampaignForUser(req.params.campaignId, req.session.userId);
  if (!campaign) return res.status(403).json({ error: 'Accès refusé' });
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question requise' });
  const sessions = db.prepare('SELECT * FROM sessions WHERE campaign_id = ? ORDER BY number ASC').all(req.params.campaignId);
  const allText = sessions.map(s =>
    `=== Session ${s.number}: ${s.title} (${s.date}) ===\n` +
    (s.summary ? `Résumé: ${s.summary}\n` : '') +
    (s.raw_notes ? `Notes: ${s.raw_notes}\n` : '')
  ).join('\n\n');
  if (!allText.trim()) return res.json({ answer: 'Aucune note disponible.' });
  const answer = await askQuestion(question, allText, campaign.title);
  res.json({ answer });
});

router.delete('/:id', authAny, (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT s.id, c.user_id FROM sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?').get(req.params.id);
  if (!canAccess(session, req, db)) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
