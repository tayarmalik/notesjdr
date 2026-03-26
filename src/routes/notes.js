const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

// GET /api/notes?campaign_id=&session_id=&character_id=
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { campaign_id, session_id, character_id } = req.query;
  const userId = req.session.userId;

  let query, params;

  if (session_id) {
    query = `SELECT n.*, u.username FROM notes n JOIN users u ON u.id=n.user_id
      WHERE n.session_id=? AND (n.visibility='shared' OR n.user_id=?)
      ORDER BY n.created_at DESC`;
    params = [session_id, userId];
  } else if (character_id) {
    query = `SELECT n.*, u.username FROM notes n JOIN users u ON u.id=n.user_id
      WHERE n.character_id=? AND (n.visibility='shared' OR n.user_id=?)
      ORDER BY n.created_at DESC`;
    params = [character_id, userId];
  } else if (campaign_id) {
    const typeFilter = req.query.type ? ` AND n.type='${req.query.type}'` : ` AND n.type != 'lieu'`;
    query = `SELECT n.*, u.username FROM notes n JOIN users u ON u.id=n.user_id
      WHERE n.campaign_id=? AND n.session_id IS NULL AND n.character_id IS NULL
      AND (n.visibility='shared' OR n.user_id=?)${typeFilter}
      ORDER BY n.created_at DESC`;
    params = [campaign_id, userId];
  } else {
    return res.status(400).json({ error: 'Paramètre requis' });
  }

  res.json(db.prepare(query).all(...params));
});

// POST /api/notes
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { campaign_id, session_id, character_id, type, visibility, title, content } = req.body;
  if (!content) return res.status(400).json({ error: 'Contenu requis' });

  const result = db.prepare(`
    INSERT INTO notes (user_id, campaign_id, session_id, character_id, type, visibility, title, content)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(req.session.userId, campaign_id||null, session_id||null, character_id||null,
         type||'campaign', visibility||'private', title||null, content);

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/notes/:id
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note || note.user_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });

  const { title, content, visibility } = req.body;
  db.prepare('UPDATE notes SET title=?, content=?, visibility=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(title||null, content, visibility||note.visibility, req.params.id);
  res.json({ success: true });
});

// DELETE /api/notes/:id
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note || note.user_id !== req.session.userId) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
