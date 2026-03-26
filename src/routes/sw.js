const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

// GET /api/sw/characters — mes fiches
router.get('/characters', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  const chars = user?.is_admin
    ? db.prepare('SELECT sw.*, u.username as assigned_username FROM sw_characters sw LEFT JOIN users u ON u.id = sw.assigned_user_id ORDER BY sw.updated_at DESC').all()
    : db.prepare('SELECT sw.*, u.username as assigned_username FROM sw_characters sw LEFT JOIN users u ON u.id = sw.assigned_user_id WHERE sw.assigned_user_id = ? OR sw.user_id = ? ORDER BY sw.updated_at DESC').all(req.session.userId, req.session.userId);
  res.json(chars.map(c => ({ ...c, skills: JSON.parse(c.skills), edges: JSON.parse(c.edges), hindrances: JSON.parse(c.hindrances), gear: JSON.parse(c.gear), powers: JSON.parse(c.powers) })));
});

// GET /api/sw/campaign/:id/characters — fiches d'une campagne
router.get('/campaign/:id/characters', requireAuth, (req, res) => {
  const db = getDb();
  const chars = db.prepare('SELECT sw.*, u.username FROM sw_characters sw JOIN users u ON u.id = sw.user_id WHERE sw.campaign_id = ? ORDER BY sw.name').all(req.params.id);
  res.json(chars.map(c => ({ ...c, skills: JSON.parse(c.skills), edges: JSON.parse(c.edges), hindrances: JSON.parse(c.hindrances), gear: JSON.parse(c.gear), powers: JSON.parse(c.powers) })));
});

// POST /api/sw/characters
router.post('/characters', requireAuth, (req, res) => {
  const db = getDb();
  const { name, race, concept, rank, campaign_id, agilite, astuce, esprit, force, vigueur, assigned_user_id, system } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const result = db.prepare('INSERT INTO sw_characters (user_id, assigned_user_id, campaign_id, name, race, concept, rank, agilite, astuce, esprit, force, vigueur, system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    req.session.userId, assigned_user_id || req.session.userId, campaign_id || null, name, race || 'Humain', concept || '', rank || 'Novice',
    agilite || 6, astuce || 6, esprit || 6, force || 6, vigueur || 6, system || null
  );
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/sw/characters/:id
router.put('/characters/:id', requireAuth, (req, res) => {
  const db = getDb();
  try {
  const user3 = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  const char = user3?.is_admin
    ? db.prepare('SELECT id FROM sw_characters WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT id FROM sw_characters WHERE id = ? AND (assigned_user_id = ? OR user_id = ?)').get(req.params.id, req.session.userId, req.session.userId);
  if (!char) return res.status(403).json({ error: 'Acces refuse' });
  const b = req.body;
  const toInt = (v, def) => v !== undefined ? parseInt(v) || def : null;
  const toJson = (v) => v !== undefined ? JSON.stringify(v) : null;
  const toStr = (v) => v !== undefined ? String(v) : null;
  db.prepare(`UPDATE sw_characters SET
    name=COALESCE(?,name), race=COALESCE(?,race), concept=COALESCE(?,concept), rank=COALESCE(?,rank),
    xp=COALESCE(?,xp), agilite=COALESCE(?,agilite), astuce=COALESCE(?,astuce), esprit=COALESCE(?,esprit),
    force=COALESCE(?,force), vigueur=COALESCE(?,vigueur), charisme=COALESCE(?,charisme),
    celerite=COALESCE(?,celerite), parade=COALESCE(?,parade), robustesse=COALESCE(?,robustesse),
    blessures=COALESCE(?,blessures), fatigue=COALESCE(?,fatigue), bennies=COALESCE(?,bennies),
    bennies_max=COALESCE(?,bennies_max), wounds_max=COALESCE(?,wounds_max),
    skills=COALESCE(?,skills), edges=COALESCE(?,edges), hindrances=COALESCE(?,hindrances),
    gear=COALESCE(?,gear), powers=COALESCE(?,powers), notes=COALESCE(?,notes),
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
    toStr(b.name), toStr(b.race), toStr(b.concept), toStr(b.rank),
    toInt(b.xp,0), toInt(b.agilite,6), toInt(b.astuce,6), toInt(b.esprit,6),
    toInt(b.force,6), toInt(b.vigueur,6), toInt(b.charisme,0),
    toInt(b.celerite,6), toInt(b.parade,2), toInt(b.robustesse,4),
    toInt(b.blessures,0), toInt(b.fatigue,0), toInt(b.bennies,3),
    toInt(b.bennies_max,3), toInt(b.wounds_max,3),
    toJson(b.skills), toJson(b.edges), toJson(b.hindrances),
    toJson(b.gear), toJson(b.powers), toStr(b.notes),
    req.params.id
  );
  res.json({ success: true });
} catch(e) { console.error('[SW PUT]', e.message); res.status(500).json({ error: e.message }); }
});

// DELETE /api/sw/characters/:id
router.delete('/characters/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sw_characters WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

module.exports = router;
