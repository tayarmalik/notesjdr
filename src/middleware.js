const { getDb } = require('./database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

function requireApiToken(req, res, next) {
  const token = req.headers['x-api-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Token API requis' });
  
  const db = getDb();
  const apiToken = db.prepare('SELECT * FROM api_tokens WHERE token = ?').get(token);
  if (!apiToken) return res.status(401).json({ error: 'Token invalide' });
  
  req.apiUserId = apiToken.user_id;
  next();
}

module.exports = { requireAuth, requireApiToken };
