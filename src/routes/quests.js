const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

function isGm(db, campaignId, userId) {
  const c = db.prepare('SELECT user_id FROM campaigns WHERE id=?').get(campaignId);
  if (c && c.user_id === userId) return true;
  const u = db.prepare('SELECT is_admin FROM users WHERE id=?').get(userId);
  return u && u.is_admin;
}

router.get('/campaign/:id', requireAuth, (req, res) => {
  const db = getDb();
  const quests = db.prepare('SELECT * FROM quests WHERE campaign_id=? ORDER BY status ASC, created_at DESC').all(req.params.id);
  res.json(quests);
});

router.post('/campaign/:id', requireAuth, (req, res) => {
  const db = getDb();
  if (!isGm(db, req.params.id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  const { title, description, giver, reward, session_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  const result = db.prepare(`INSERT INTO quests (campaign_id, title, description, giver, reward, session_id) VALUES (?,?,?,?,?,?)`)
    .run(req.params.id, title, description||'', giver||null, reward||null, session_id||null);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const q = db.prepare('SELECT * FROM quests WHERE id=?').get(req.params.id);
  if (!q || !isGm(db, q.campaign_id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  const { title, description, status, giver, reward } = req.body;
  db.prepare('UPDATE quests SET title=?, description=?, status=?, giver=?, reward=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(title, description||'', status||'active', giver||null, reward||null, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const q = db.prepare('SELECT * FROM quests WHERE id=?').get(req.params.id);
  if (!q || !isGm(db, q.campaign_id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('DELETE FROM quests WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
