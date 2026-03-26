const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

// POST /api/invitations/campaign/:id — MJ invite un joueur par pseudo
router.post('/campaign/:id', requireAuth, async (req, res) => {
  const db = getDb();
  const { email, username } = req.body;
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?')
    .get(req.params.id, req.session.userId);
  if (!campaign) return res.status(403).json({ error: 'Accès refusé' });
  let existingUser = null;
  if (username) existingUser = db.prepare('SELECT id, username FROM users WHERE username=?').get(username);
  else if (email) existingUser = db.prepare('SELECT id, username FROM users WHERE email=?').get(email);
  else return res.status(400).json({ error: 'Pseudo ou email requis' });
  if (!existingUser) return res.status(400).json({ error: 'Utilisateur introuvable sur VaultLog.' });
  const already = db.prepare('SELECT id FROM campaign_members WHERE campaign_id=? AND user_id=?').get(req.params.id, existingUser.id);
  if (already) return res.status(400).json({ error: 'Déjà membre de la campagne' });
  const inviter = db.prepare('SELECT username FROM users WHERE id=?').get(req.session.userId);
  db.prepare('INSERT INTO messages (from_user_id, to_user_id, type, subject, content, data) VALUES (?, ?, ?, ?, ?, ?)').run(
    req.session.userId,
    existingUser.id,
    'invitation',
    'Invitation à rejoindre ' + campaign.title,
    inviter.username + ' vous invite à rejoindre la campagne "' + campaign.title + '".',
    JSON.stringify({ campaign_id: parseInt(req.params.id), campaign_title: campaign.title })
  );
  return res.json({ success: true, message: 'Invitation envoyée à ' + existingUser.username });
});

// GET /api/invitations/campaign/:id/members
router.get('/campaign/:id/members', requireAuth, (req, res) => {
  const db = getDb();
  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar_color
    FROM campaign_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.campaign_id = ?
  `).all(req.params.id);
  res.json(members);
});

router.get('/accept/:token', (req, res) => {
  res.redirect('/');
});

module.exports = router;
