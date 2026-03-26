const express = require('express');
const { getDb } = require('../database');

const router = express.Router();

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

router.get('/', authAny, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  const isAdmin = user && user.is_admin;
  const campaigns = isAdmin
    ? db.prepare(`
        SELECT c.*, u.username as owner, COUNT(DISTINCT s.id) as session_count, MAX(s.date) as last_session
        FROM campaigns c LEFT JOIN sessions s ON s.campaign_id = c.id
        LEFT JOIN users u ON u.id = c.user_id
        GROUP BY c.id ORDER BY c.updated_at DESC
      `).all()
    : db.prepare(`
        SELECT c.*, u.username as owner, COUNT(DISTINCT s.id) as session_count, MAX(s.date) as last_session,
               CASE WHEN c.user_id = ? THEN 'gm' ELSE 'player' END as my_role
        FROM campaigns c LEFT JOIN sessions s ON s.campaign_id = c.id
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.user_id = ? OR c.id IN (SELECT campaign_id FROM campaign_members WHERE user_id = ?)
        GROUP BY c.id ORDER BY c.updated_at DESC
      `).all(req.session.userId, req.session.userId, req.session.userId);
  res.json(campaigns);
});

router.post('/', authAny, (req, res) => {
  const { title, description, system, cover_color } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO campaigns (user_id, title, description, system, cover_color) VALUES (?, ?, ?, ?, ?)'
  ).run(req.session.userId, title, description || '', system || 'D&D 5e', cover_color || '#1e1b4b');
  res.json({ id: result.lastInsertRowid, title });
});

router.get('/:id', authAny, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  const isAdmin = user && user.is_admin;
  const isMember = db.prepare('SELECT id FROM campaign_members WHERE campaign_id=? AND user_id=?').get(req.params.id, req.session.userId);
  const campaign = isAdmin || isMember
    ? db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!campaign) return res.status(404).json({ error: 'Campagne introuvable' });
  const sessions = db.prepare('SELECT * FROM sessions WHERE campaign_id = ? ORDER BY number DESC').all(campaign.id);
  const characters = db.prepare('SELECT * FROM characters WHERE campaign_id = ?').all(campaign.id);
  res.json({ ...campaign, sessions, characters });
});

router.put('/:id', authAny, (req, res) => {
  const db = getDb();
  const { title, description, system, cover_color, status } = req.body;
  db.prepare('UPDATE campaigns SET title=?, description=?, system=?, cover_color=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?')
    .run(title, description, system, cover_color, status, req.params.id, req.session.userId);
  res.json({ success: true });
});

router.delete('/:id', authAny, (req, res) => {
  try {
  const db = getDb();
  const cid = req.params.id;
  const uid = req.session.userId;

  // Récupérer les fichiers audio


  db.prepare('DELETE FROM planning_votes WHERE planning_id IN (SELECT id FROM planning WHERE campaign_id=?)').run(cid);
  db.prepare('DELETE FROM planning_dates WHERE planning_id IN (SELECT id FROM planning WHERE campaign_id=?)').run(cid);
  db.prepare('DELETE FROM planning WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM timeline_events WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM quests WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM notes WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM invitations WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM campaign_members WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM session_characters WHERE session_id IN (SELECT id FROM sessions WHERE campaign_id=?)').run(cid);
  db.prepare('DELETE FROM characters WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM sessions WHERE campaign_id=?').run(cid);
  db.prepare('DELETE FROM campaigns WHERE id=? AND user_id=?').run(cid, uid);
  res.json({ success: true });
  } catch(err) { console.error('DELETE ERR:', err.message); res.status(500).json({ error: err.message }); }
});

module.exports = router;
