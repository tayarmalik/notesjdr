const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Champs manquants' });
  try {
    const db = getDb();
    const hash = await bcrypt.hash(password, 10);
    const colors = ['#2e7d4f', '#c9a84c', '#4aab72', '#1e4228', '#265535'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const result = db.prepare('INSERT INTO users (username, email, password_hash, avatar_color) VALUES (?, ?, ?, ?)').run(username, email, hash, color);
    req.session.userId = result.lastInsertRowid;
    req.session.username = username;
    res.json({ success: true, username });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: "Nom d'utilisateur ou email déjà pris" });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password, username } = req.body;
  const db = getDb();
  const loginId = username || email;
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(loginId, loginId);
  if (!user) return res.status(401).json({ error: 'Identifiants invalides' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.isAdmin = !!user.is_admin;
  res.json({ success: true, username: user.username, isAdmin: !!user.is_admin });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const db = getDb();
  const user = db.prepare('SELECT id, username, email, avatar_color, created_at, is_admin FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

router.get('/admin/users', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const db = getDb();
  const me = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_admin) return res.status(403).json({ error: 'Accès refusé' });
  const users = db.prepare('SELECT id, username, email, created_at FROM users').all();
  const result = users.map(u => {
    const campaigns = db.prepare('SELECT c.id, c.title, c.system, c.status, c.updated_at, COUNT(s.id) as session_count FROM campaigns c LEFT JOIN sessions s ON s.campaign_id = c.id WHERE c.user_id = ? GROUP BY c.id').all(u.id);
    return { ...u, campaigns };
  });
  res.json(result);
});

router.get('/admin/campaigns', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const db = getDb();
  const me = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_admin) return res.status(403).json({ error: 'Accès refusé' });
  const campaigns = db.prepare('SELECT c.*, u.username, COUNT(s.id) as session_count FROM campaigns c JOIN users u ON u.id = c.user_id LEFT JOIN sessions s ON s.campaign_id = c.id GROUP BY c.id ORDER BY c.updated_at DESC').all();
  res.json(campaigns);
});

module.exports = router;
