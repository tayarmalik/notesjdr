const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const MAP_DIR = path.join(__dirname, '../../maps');
if (!fs.existsSync(MAP_DIR)) fs.mkdirSync(MAP_DIR, { recursive: true });

const upload = multer({ dest: MAP_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/vtt/rooms
router.get('/rooms', requireAuth, (req, res) => {
  const db = getDb();
  const rooms = db.prepare('SELECT * FROM vtt_rooms ORDER BY created_at DESC').all();
  res.json(rooms);
});

// POST /api/vtt/rooms
router.post('/rooms', requireAuth, (req, res) => {
  const db = getDb();
  const { name, campaign_id, grid_size, system } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  try {
  const result = db.prepare('INSERT INTO vtt_rooms (name, campaign_id, grid_size, system) VALUES (?, ?, ?, ?)').run(name, campaign_id || null, grid_size || 50, system || null);
  res.json({ id: result.lastInsertRowid, name });
  } catch(e) { console.error('[VTT POST]', e.message); res.status(500).json({ error: e.message }); }
});

// PUT /api/vtt/rooms/:id — modifier la salle
router.put('/rooms/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { system, name, grid_size } = req.body;
  db.prepare('UPDATE vtt_rooms SET system=COALESCE(?,system), name=COALESCE(?,name), grid_size=COALESCE(?,grid_size) WHERE id=?').run(
    system !== undefined ? system : null, name || null, grid_size || null, req.params.id
  );
  res.json({ success: true });
});

// DELETE /api/vtt/rooms/:id
router.delete('/rooms/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM vtt_rooms WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/vtt/rooms/:id/map — uploader une carte
router.post('/rooms/:id/map', requireAuth, upload.single('map'), (req, res) => {
  const db = getDb();
  const ext = path.extname(req.file.originalname);
  const filename = req.params.id + '_map' + ext;
  fs.renameSync(req.file.path, path.join(MAP_DIR, filename));
  db.prepare('UPDATE vtt_rooms SET map_url = ? WHERE id = ?').run('/maps/' + filename, req.params.id);
  res.json({ map_url: '/maps/' + filename });
});

// GET /api/vtt/rooms/:id/tokens
router.get('/rooms/:id/tokens', requireAuth, (req, res) => {
  const db = getDb();
  const tokens = db.prepare('SELECT * FROM vtt_tokens WHERE room_id = ? ORDER BY initiative DESC').all(req.params.id);
  res.json(tokens);
});

// POST /api/vtt/rooms/:id/tokens
router.post('/rooms/:id/tokens', requireAuth, (req, res) => {
  const db = getDb();
  const { name, x, y, color, hp, hp_max, img_url, width, height } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const result = db.prepare('INSERT INTO vtt_tokens (room_id, name, x, y, color, hp, hp_max, img_url, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.params.id, name, x || 0, y || 0, color || '#4aab72', hp || null, hp_max || null, img_url || null, width || 50, height || 50);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/vtt/tokens/:id
router.put('/tokens/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { x, y, hp, initiative, is_visible, name, color } = req.body;
  db.prepare('UPDATE vtt_tokens SET x=COALESCE(?,x), y=COALESCE(?,y), hp=COALESCE(?,hp), initiative=COALESCE(?,initiative), is_visible=COALESCE(?,is_visible), name=COALESCE(?,name), color=COALESCE(?,color) WHERE id=?').run(x, y, hp, initiative, is_visible, name, color, req.params.id);
  res.json({ success: true });
});

// DELETE /api/vtt/tokens/:id
router.delete('/tokens/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM vtt_tokens WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/vtt/rooms/:id/maps
router.get('/rooms/:id/maps', requireAuth, (req, res) => {
  const db = getDb();
  const maps = db.prepare('SELECT * FROM vtt_maps WHERE room_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(maps);
});

// POST /api/vtt/rooms/:id/maps — ajouter une carte
router.post('/rooms/:id/maps', requireAuth, upload.single('map'), (req, res) => {
  const db = getDb();
  const ext = path.extname(req.file.originalname);
  const filename = req.params.id + '_' + Date.now() + ext;
  fs.renameSync(req.file.path, path.join(MAP_DIR, filename));
  const url = '/maps/' + filename;
  const result = db.prepare('INSERT INTO vtt_maps (room_id, filename) VALUES (?, ?)').run(req.params.id, filename);
  // Activer cette carte
  db.prepare('UPDATE vtt_rooms SET map_url = ? WHERE id = ?').run(url, req.params.id);
  res.json({ id: result.lastInsertRowid, filename, url });
});

// PUT /api/vtt/rooms/:id/maps/:mapId — activer une carte
router.put('/rooms/:id/maps/:mapId', requireAuth, (req, res) => {
  const db = getDb();
  const map = db.prepare('SELECT * FROM vtt_maps WHERE id = ? AND room_id = ?').get(req.params.mapId, req.params.id);
  if (!map) return res.status(404).json({ error: 'Carte introuvable' });
  db.prepare('UPDATE vtt_rooms SET map_url = ? WHERE id = ?').run('/maps/' + map.filename, req.params.id);
  res.json({ success: true, url: '/maps/' + map.filename });
});

// DELETE /api/vtt/maps/:id
router.delete('/maps/:id', requireAuth, (req, res) => {
  const db = getDb();
  const map = db.prepare('SELECT * FROM vtt_maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Carte introuvable' });
  try { fs.unlinkSync(path.join(MAP_DIR, map.filename)); } catch(e) {}
  db.prepare('DELETE FROM vtt_maps WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/vtt/rooms/:id/walls
router.get('/rooms/:id/walls', requireAuth, (req, res) => {
  const db = getDb();
  const walls = db.prepare('SELECT * FROM vtt_walls WHERE room_id = ?').all(req.params.id);
  res.json(walls);
});

// POST /api/vtt/rooms/:id/walls
router.post('/rooms/:id/walls', requireAuth, (req, res) => {
  const db = getDb();
  const { x1, y1, x2, y2, color, thickness } = req.body;
  const result = db.prepare('INSERT INTO vtt_walls (room_id, x1, y1, x2, y2, color, thickness) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.params.id, x1, y1, x2, y2, color || '#8b4513', thickness || 4);
  res.json({ id: result.lastInsertRowid });
});

// DELETE /api/vtt/walls/:id
router.delete('/walls/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM vtt_walls WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// PUT /api/vtt/rooms/:id — modifier la salle
router.put('/rooms/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { system, name, grid_size } = req.body;
  db.prepare('UPDATE vtt_rooms SET system=COALESCE(?,system), name=COALESCE(?,name), grid_size=COALESCE(?,grid_size) WHERE id=?').run(
    system !== undefined ? system : null, name || null, grid_size || null, req.params.id
  );
  res.json({ success: true });
});

// DELETE /api/vtt/rooms/:id/walls — supprimer tous les murs
router.delete('/rooms/:id/walls', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM vtt_walls WHERE room_id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
