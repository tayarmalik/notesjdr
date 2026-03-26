const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function requireAdmin(req, res, next) {
  const db = getDb();
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Accès admin requis' });
  next();
}

router.get('/dashboard', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  // Utilisateurs
  const users = db.prepare('SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at DESC').all();
  // Campagnes
  const campaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get();
  // Sessions
  const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get();
  // Jobs en cours
  const audioDir = path.join(__dirname, '../../audio');
  let audioFiles = [];
  try {
    audioFiles = fs.readdirSync(audioDir)
      .filter(f => !f.endsWith('.expiry'))
      .map(f => {
        const stat = fs.statSync(path.join(audioDir, f));
        return { name: f, size: stat.size, date: stat.mtime };
      });
  } catch(e) {}
  const audioSize = audioFiles.reduce((acc, f) => acc + f.size, 0);
  // Espace disque
  let diskInfo = {};
  try {
    const out = execSync('df /opt/jdrnotes --output=size,used,avail,pcent -BM | tail -1').toString().trim();
    const [size, used, avail, pcent] = out.split(/\s+/);
    diskInfo = { size, used, avail, pcent };
  } catch(e) {}
  // BDD
  let dbSize = 0;
  try { dbSize = fs.statSync('/opt/jdrnotes/data/volog.db').size; } catch(e) {}
  // Sessions actives
  let activeSessions = [];
  try {
    const sessionDb = require('better-sqlite3')('/opt/jdrnotes/data/sessions.db');
    const rows = sessionDb.prepare('SELECT sess, expired FROM sessions WHERE expired > ?').all(Date.now());
    activeSessions = rows.map(r => {
      try {
        const sess = JSON.parse(r.sess);
        const user = sess.userId ? db.prepare('SELECT username, email FROM users WHERE id=?').get(sess.userId) : null;
        return { userId: sess.userId, username: user?.username, email: user?.email, expires: new Date(r.expired).toISOString() };
      } catch(e) { return null; }
    }).filter(Boolean);
  } catch(e) {}

  // Messages non lus
  const unreadMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE read = 0').get();
  // Tous les messages
  const messages = db.prepare(`
    SELECT m.*, u1.username as from_username, u2.username as to_username
    FROM messages m
    JOIN users u1 ON u1.id = m.from_user_id
    JOIN users u2 ON u2.id = m.to_user_id
    ORDER BY m.created_at DESC LIMIT 50
  `).all();
  res.json({
    users,
    stats: {
      campaigns: campaigns.count,
      sessions: sessions.count,
      audioFiles: audioFiles.length,
      audioSize,
      dbSize,
      unreadMessages: unreadMessages.count
    },
    disk: diskInfo,
    recentAudio: audioFiles.slice(0, 10),
    messages,
    activeSessions
  });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
