const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

// GET /api/cpr/characters — mes fiches
router.get('/characters', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
  const chars = user?.is_admin
    ? db.prepare('SELECT cpr.*, u.username as assigned_username FROM cpr_characters cpr LEFT JOIN users u ON u.id = cpr.assigned_user_id ORDER BY cpr.updated_at DESC').all()
    : db.prepare('SELECT cpr.*, u.username as assigned_username FROM cpr_characters cpr LEFT JOIN users u ON u.id = cpr.assigned_user_id WHERE cpr.assigned_user_id = ? OR cpr.user_id = ? ORDER BY cpr.updated_at DESC').all(req.session.userId, req.session.userId);
  res.json(chars.map(c => ({ ...c, skills: JSON.parse(c.skills||'[]'), cyberware: JSON.parse(c.cyberware||'[]'), weapons: JSON.parse(c.weapons||'[]'), gear: JSON.parse(c.gear||'[]'), background: c.background||'' })));
});

// POST /api/cpr/characters
router.post('/characters', requireAuth, (req, res) => {
  const db = getDb();
  const { name, role, campaign_id, assigned_user_id, int: i, ref, dex, tech, cool, will, luck, move, body, emp } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const result = db.prepare(`INSERT INTO cpr_characters
    (user_id, assigned_user_id, campaign_id, name, role, int, ref, dex, tech, cool, will, luck, move, body, emp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    req.session.userId, assigned_user_id || req.session.userId, campaign_id || null,
    name, role || 'Solo', i||5, ref||5, dex||5, tech||5, cool||5, will||5, luck||5, move||5, body||5, emp||5
  );
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/cpr/characters/:id
router.put('/characters/:id', requireAuth, (req, res) => {
  const db = getDb();
  try {
    const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.session.userId);
    const char = user?.is_admin
      ? db.prepare('SELECT id FROM cpr_characters WHERE id=?').get(req.params.id)
      : db.prepare('SELECT id FROM cpr_characters WHERE id=? AND (assigned_user_id=? OR user_id=?)').get(req.params.id, req.session.userId, req.session.userId);
    if (!char) return res.status(403).json({ error: 'Accès refusé' });
    const b = req.body;
    const n = (v, d) => v !== undefined ? parseInt(v)||d : null;
    const s = (v) => v !== undefined ? String(v) : null;
    const j = (v) => v !== undefined ? JSON.stringify(v) : null;
    db.prepare(`UPDATE cpr_characters SET
      name=COALESCE(?,name), role=COALESCE(?,role),
      int=COALESCE(?,int), ref=COALESCE(?,ref), dex=COALESCE(?,dex),
      tech=COALESCE(?,tech), cool=COALESCE(?,cool), will=COALESCE(?,will),
      luck=COALESCE(?,luck), move=COALESCE(?,move), body=COALESCE(?,body), emp=COALESCE(?,emp),
      hp=COALESCE(?,hp), hp_max=COALESCE(?,hp_max), humanity=COALESCE(?,humanity),
      skills=COALESCE(?,skills), cyberware=COALESCE(?,cyberware),
      weapons=COALESCE(?,weapons), gear=COALESCE(?,gear), background=COALESCE(?,background), notes=COALESCE(?,notes),
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
      s(b.name), s(b.role),
      n(b.int,5), n(b.ref,5), n(b.dex,5),
      n(b.tech,5), n(b.cool,5), n(b.will,5),
      n(b.luck,5), n(b.move,5), n(b.body,5), n(b.emp,5),
      n(b.hp,40), n(b.hp_max,40), n(b.humanity,50),
      j(b.skills), j(b.cyberware), j(b.weapons), j(b.gear), s(b.background), s(b.notes),
      req.params.id
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/cpr/characters/:id
router.delete('/characters/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cpr_characters WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});

module.exports = router;
