const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { q, campaign_id } = req.query;
  if (!q || q.length < 2) return res.status(400).json({ error: 'Requête trop courte' });

  const userId = req.session.userId;
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(userId);
  const isAdmin = user && user.is_admin;
  const like = '%' + q + '%';

  // Campagnes accessibles
  const campaigns = isAdmin
    ? db.prepare('SELECT id FROM campaigns').all().map(c => c.id)
    : db.prepare('SELECT id FROM campaigns WHERE user_id=? UNION SELECT campaign_id FROM campaign_members WHERE user_id=?').all(userId, userId).map(c => c.id);

  if (!campaigns.length) return res.json([]);

  const inClause = campaigns.map(() => '?').join(',');
  const params = [...campaigns, like, like];

  const results = [];

  // Sessions
  const sessions = db.prepare(`
    SELECT 'session' as type, s.id, s.title, s.campaign_id, c.title as campaign_title,
      CASE WHEN s.title LIKE ? THEN s.title ELSE substr(s.raw_notes,1,120) END as excerpt
    FROM sessions s JOIN campaigns c ON c.id=s.campaign_id
    WHERE s.campaign_id IN (${inClause}) AND (s.title LIKE ? OR s.raw_notes LIKE ? OR s.narrative LIKE ?)
    LIMIT 5
  `).all(...campaigns, like, like, like, like);
  results.push(...sessions);

  // Notes
  const notes = db.prepare(`
    SELECT 'note' as type, n.id, COALESCE(n.title,'Note sans titre') as title, n.campaign_id,
      c.title as campaign_title, substr(n.content,1,120) as excerpt
    FROM notes n JOIN campaigns c ON c.id=n.campaign_id
    WHERE n.campaign_id IN (${inClause}) AND (n.title LIKE ? OR n.content LIKE ?)
    AND (n.visibility='shared' OR n.user_id=?)
    LIMIT 5
  `).all(...campaigns, like, like, userId);
  results.push(...notes);

  // PNJ / Personnages
  const chars = db.prepare(`
    SELECT 'character' as type, ch.id, ch.name as title, ch.campaign_id,
      c.title as campaign_title, COALESCE(ch.description,'') as excerpt
    FROM characters ch JOIN campaigns c ON c.id=ch.campaign_id
    WHERE ch.campaign_id IN (${inClause}) AND (ch.name LIKE ? OR ch.description LIKE ?)
    LIMIT 5
  `).all(...campaigns, like, like);
  results.push(...chars);

  // Lieux (notes de type lieu)
  const lieux = db.prepare(`
    SELECT 'lieu' as type, n.id, COALESCE(n.title,'Lieu sans nom') as title, n.campaign_id,
      c.title as campaign_title, substr(n.content,1,120) as excerpt
    FROM notes n JOIN campaigns c ON c.id=n.campaign_id
    WHERE n.campaign_id IN (${inClause}) AND n.type='lieu' AND (n.title LIKE ? OR n.content LIKE ?)
    LIMIT 5
  `).all(...campaigns, like, like);
  results.push(...lieux);

  // Quêtes
  const quests = db.prepare(`
    SELECT 'quest' as type, q.id, q.title, q.campaign_id,
      c.title as campaign_title, substr(q.description,1,120) as excerpt
    FROM quests q JOIN campaigns c ON c.id=q.campaign_id
    WHERE q.campaign_id IN (${inClause}) AND (q.title LIKE ? OR q.description LIKE ? OR q.giver LIKE ?)
    LIMIT 5
  `).all(...campaigns, like, like, like);
  results.push(...quests);

  res.json(results);
});

module.exports = router;
