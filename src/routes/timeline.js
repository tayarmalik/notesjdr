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
  const events = db.prepare(`
    SELECT t.*, s.number as session_number FROM timeline_events t
    LEFT JOIN sessions s ON s.id = t.session_id
    WHERE t.campaign_id=? ORDER BY t.date_in_game ASC, t.created_at ASC
  `).all(req.params.id);
  res.json(events);
});

router.post('/campaign/:id', requireAuth, (req, res) => {
  const db = getDb();
  if (!isGm(db, req.params.id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  const { title, description, date_in_game, session_id, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  const result = db.prepare(`INSERT INTO timeline_events (campaign_id, title, description, date_in_game, session_id, category) VALUES (?,?,?,?,?,?)`)
    .run(req.params.id, title, description||'', date_in_game||null, session_id||null, category||'event');
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const ev = db.prepare('SELECT * FROM timeline_events WHERE id=?').get(req.params.id);
  if (!ev || !isGm(db, ev.campaign_id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  const { title, description, date_in_game, session_id, category } = req.body;
  db.prepare('UPDATE timeline_events SET title=?, description=?, date_in_game=?, session_id=?, category=? WHERE id=?')
    .run(title, description||'', date_in_game||null, session_id||null, category||'event', req.params.id);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const ev = db.prepare('SELECT * FROM timeline_events WHERE id=?').get(req.params.id);
  if (!ev || !isGm(db, ev.campaign_id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('DELETE FROM timeline_events WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
