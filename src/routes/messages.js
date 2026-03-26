const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

// GET /api/messages — boîte de réception
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const messages = db.prepare(`
    SELECT m.*, u.username as from_username, u.avatar_color as from_color
    FROM messages m
    JOIN users u ON u.id = m.from_user_id
    WHERE m.to_user_id = ?
    ORDER BY m.created_at DESC
  `).all(req.session.userId);
  res.json(messages);
});

// GET /api/messages/unread-count
router.get('/unread-count', requireAuth, (req, res) => {
  const db = getDb();
  const { count } = db.prepare('SELECT COUNT(*) as count FROM messages WHERE to_user_id = ? AND read = 0').get(req.session.userId);
  res.json({ count });
});

// POST /api/messages/:id/read
router.post('/:id/read', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE messages SET read = 1 WHERE id = ? AND to_user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// POST /api/messages/:id/accept-invitation
router.post('/:id/accept-invitation', requireAuth, (req, res) => {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND to_user_id = ? AND type = ?').get(req.params.id, req.session.userId, 'invitation');
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  const data = JSON.parse(msg.data || '{}');
  const campaignId = data.campaign_id;
  if (!campaignId) return res.status(400).json({ error: 'Données invalides' });
  // Vérifier pas déjà membre
  const already = db.prepare('SELECT id FROM campaign_members WHERE campaign_id = ? AND user_id = ?').get(campaignId, req.session.userId);
  if (!already) {
    db.prepare('INSERT INTO campaign_members (campaign_id, user_id) VALUES (?, ?)').run(campaignId, req.session.userId);
  }
  db.prepare('UPDATE messages SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true, campaign_id: campaignId });
});

// POST /api/messages/:id/decline-invitation
router.post('/:id/decline-invitation', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE messages SET read = 1 WHERE id = ? AND to_user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// DELETE /api/messages/:id
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE id = ? AND to_user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

module.exports = router;
