const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

router.get('/campaign/:id', requireAuth, (req, res) => {
  const db = getDb();
  const map = db.prepare('SELECT * FROM mindmaps WHERE campaign_id=?').get(req.params.id);
  res.json(map ? JSON.parse(map.data) : { nodes: [], edges: [] });
});

router.put('/campaign/:id', requireAuth, (req, res) => {
  const db = getDb();
  const data = JSON.stringify(req.body);
  const existing = db.prepare('SELECT id FROM mindmaps WHERE campaign_id=?').get(req.params.id);
  if (existing) {
    db.prepare('UPDATE mindmaps SET data=?, updated_at=CURRENT_TIMESTAMP WHERE campaign_id=?').run(data, req.params.id);
  } else {
    db.prepare('INSERT INTO mindmaps (campaign_id, data) VALUES (?,?)').run(req.params.id, data);
  }
  res.json({ success: true });
});

module.exports = router;
