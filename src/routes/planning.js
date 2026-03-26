const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

function isGm(db, campaignId, userId) {
  const c = db.prepare('SELECT user_id FROM campaigns WHERE id=?').get(campaignId);
  if (c && c.user_id === userId) return true;
  const u = db.prepare('SELECT is_admin FROM users WHERE id=?').get(userId);
  return u && u.is_admin;
}

// GET /api/planning/campaign/:id — sondages de la campagne
router.get('/campaign/:id', requireAuth, (req, res) => {
  const db = getDb();
  const polls = db.prepare('SELECT * FROM planning WHERE campaign_id=? ORDER BY created_at DESC').all(req.params.id);
  const result = polls.map(poll => {
    const dates = db.prepare('SELECT * FROM planning_dates WHERE planning_id=?').all(poll.id);
    const datesWithVotes = dates.map(d => {
      const votes = db.prepare(`
        SELECT pv.vote, u.username, u.id as user_id
        FROM planning_votes pv JOIN users u ON u.id=pv.user_id
        WHERE pv.date_id=?`).all(d.id);
      return { ...d, votes };
    });
    return { ...poll, dates: datesWithVotes };
  });
  res.json(result);
});

// POST /api/planning/campaign/:id — créer un sondage
router.post('/campaign/:id', requireAuth, (req, res) => {
  const db = getDb();
  if (!isGm(db, req.params.id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  const { title, dates } = req.body;
  if (!dates || !dates.length) return res.status(400).json({ error: 'Dates requises' });
  const result = db.prepare('INSERT INTO planning (campaign_id, title, created_by) VALUES (?,?,?)')
    .run(req.params.id, title || 'Prochaine session', req.session.userId);
  const planningId = result.lastInsertRowid;
  dates.forEach(date => {
    db.prepare('INSERT INTO planning_dates (planning_id, date) VALUES (?,?)').run(planningId, date);
  });
  // Notifier les membres
  try {
    const members = db.prepare('SELECT user_id FROM campaign_members WHERE campaign_id = ?').all(req.params.id);
    const campaign = db.prepare('SELECT title FROM campaigns WHERE id=?').get(req.params.id);
    const notifier = db.prepare('SELECT username FROM users WHERE id=?').get(req.session.userId);
    for (const m of members) {
      if (m.user_id === req.session.userId) continue;
      db.prepare('INSERT INTO messages (from_user_id, to_user_id, type, subject, content, data) VALUES (?, ?, ?, ?, ?, ?)').run(
        req.session.userId, m.user_id, 'notification',
        'Nouveau sondage : ' + (title || 'Prochaine session'),
        (notifier?.username || 'Le MJ') + ' a créé un sondage de planning dans la campagne ' + (campaign?.title || '') + '.',
        JSON.stringify({ campaign_id: parseInt(req.params.id), planning_id: planningId })
      );
    }
  } catch(e) {}
  res.json({ id: planningId });
});

// POST /api/planning/:id/vote — voter
router.post('/:id/vote', requireAuth, (req, res) => {
  const db = getDb();
  const { votes } = req.body; // { date_id: 'yes'|'maybe'|'no' }
  Object.entries(votes).forEach(([dateId, vote]) => {
    db.prepare('INSERT OR REPLACE INTO planning_votes (planning_id, date_id, user_id, vote) VALUES (?,?,?,?)')
      .run(req.params.id, parseInt(dateId), req.session.userId, vote);
  });
  res.json({ success: true });
});

// PUT /api/planning/:id/choose — choisir une date
router.put('/:id/choose', requireAuth, (req, res) => {
  const db = getDb();
  const poll = db.prepare('SELECT * FROM planning WHERE id=?').get(req.params.id);
  if (!poll || !isGm(db, poll.campaign_id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  const { date } = req.body;
  db.prepare('UPDATE planning SET chosen_date=?, status=? WHERE id=?').run(date, 'closed', req.params.id);
  res.json({ success: true });
});

// DELETE /api/planning/:id — supprimer
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const poll = db.prepare('SELECT * FROM planning WHERE id=?').get(req.params.id);
  if (!poll || !isGm(db, poll.campaign_id, req.session.userId)) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('DELETE FROM planning_votes WHERE planning_id=?').run(req.params.id);
  db.prepare('DELETE FROM planning_dates WHERE planning_id=?').run(req.params.id);
  db.prepare('DELETE FROM planning WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
