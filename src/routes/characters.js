const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Characters
router.post('/campaign/:campaignId', requireAuth, (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(req.params.campaignId, req.session.userId);
  if (!campaign) return res.status(403).json({ error: 'Accès refusé' });
  
  const { name, role, description, notes, avatar_color } = req.body;
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
  
  const result = db.prepare(
    'INSERT INTO characters (campaign_id, name, role, description, notes, avatar_letter, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.campaignId, name, role || 'pj', description || '', notes || '', name[0].toUpperCase(), avatar_color || colors[Math.floor(Math.random()*colors.length)]);
  
  res.json({ id: result.lastInsertRowid, name });
});


router.get('/campaign/:campaignId/discord-mappings', (req, res) => {
  const token = req.headers['x-api-token'] || req.query.token;
  const validToken = process.env.VAULTLOG_API_TOKEN || 'volog_29502c9c1f1242ecb7b6747168fa42fd';
  if (token !== validToken && !req.session?.userId) return res.status(401).json({ error: 'Non authentifié' });
  const db = getDb();
  const chars = db.prepare('SELECT id, name, role, avatar_color, discord_id FROM characters WHERE campaign_id=?').all(req.params.campaignId);
  res.json(chars);
});

router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const char = db.prepare(`SELECT ch.*, c.user_id FROM characters ch JOIN campaigns c ON c.id=ch.campaign_id WHERE ch.id=?`).get(req.params.id);
  if (!char || char.user_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });
  
  const { name, role, description, notes, discord_id } = req.body;
  db.prepare('UPDATE characters SET name=?, role=?, description=?, notes=?, avatar_letter=?, discord_id=? WHERE id=?')
    .run(name, role, description, notes, name[0].toUpperCase(), discord_id || null, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const char = db.prepare(`SELECT ch.*, c.user_id FROM characters ch JOIN campaigns c ON c.id=ch.campaign_id WHERE ch.id=?`).get(req.params.id);
  if (!char || char.user_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// API Tokens
router.get('/tokens', requireAuth, (req, res) => {
  const db = getDb();
  const tokens = db.prepare('SELECT id, label, created_at FROM api_tokens WHERE user_id = ?').all(req.session.userId);
  res.json(tokens);
});

router.post('/tokens', requireAuth, (req, res) => {
  const db = getDb();
  const token = 'volog_' + uuidv4().replace(/-/g, '');
  db.prepare('INSERT INTO api_tokens (user_id, token, label) VALUES (?, ?, ?)').run(req.session.userId, token, req.body.label || 'Token Discord');
  res.json({ token });
});

router.delete('/tokens/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

module.exports = router;
