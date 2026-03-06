const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'GOOGLE_CLIENT_ID';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Login page
router.get('/login', (req, res) => {
  if (req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      if (user.role === 'admin') return res.redirect('/admin');
      if (user.role === 'seller') {
        const store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(user.id);
        return res.redirect(store ? '/seller/dashboard' : '/seller/setup');
      }
      return res.redirect('/seller/setup');
    }
  }
  res.render('auth/login', { title: 'Sign In - Zaishah Store', googleClientId: GOOGLE_CLIENT_ID });
});

// Google OAuth callback
router.post('/google/callback', async (req, res) => {
  try {
    const { credential } = req.body;
    
    // For development: allow mock login
    if (credential === 'dev_mock_token') {
      const email = req.body.email || 'dev@example.com';
      const name = req.body.name || 'Dev User';
      
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) {
        const role = email === 'faheemshaikh466@gmail.com' ? 'admin' : 'seller';
        db.prepare('INSERT INTO users (email, name, role, google_id) VALUES (?, ?, ?, ?)').run(email, name, role, 'dev_' + Date.now());
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      }
      req.session.userId = user.id;
      
      if (user.role === 'admin') return res.json({ success: true, redirect: '/admin' });
      const store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(user.id);
      return res.json({ success: true, redirect: store ? '/seller/dashboard' : '/seller/setup' });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, email);

    if (!user) {
      // New user — default to seller (this is a seller platform)
      const role = email === 'faheemshaikh466@gmail.com' ? 'admin' : 'seller';
      db.prepare('INSERT INTO users (email, name, avatar, role, google_id) VALUES (?, ?, ?, ?, ?)')
        .run(email, name, picture, role, googleId);
      user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

      req.session.userId = user.id;
      if (user.role === 'admin') return res.json({ success: true, redirect: '/admin' });
      return res.json({ success: true, redirect: '/seller/setup' });
    }

    // Update avatar if changed
    if (picture && picture !== user.avatar) {
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(picture, user.id);
    }

    req.session.userId = user.id;
    
    if (user.role === 'admin') return res.json({ success: true, redirect: '/admin' });
    const store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(user.id);
    return res.json({ success: true, redirect: store ? '/seller/dashboard' : '/seller/setup' });
  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(401).json({ success: false, error: 'Authentication failed' });
  }
});

// Dev login (for testing without Google OAuth configured)
router.get('/dev-login', (req, res) => {
  res.render('auth/dev-login', { title: 'Dev Login - Zaishah Store' });
});

router.post('/dev-login', (req, res) => {
  const { email } = req.body;
  if (!email) return res.redirect('/auth/dev-login');
  
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const name = email.split('@')[0];
    const role = email === 'faheemshaikh466@gmail.com' ? 'admin' : 'seller';
    db.prepare('INSERT INTO users (email, name, role, google_id) VALUES (?, ?, ?, ?)')
      .run(email, name, role, 'dev_' + Date.now());
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }
  
  req.session.userId = user.id;
  
  if (user.role === 'admin') return res.redirect('/admin');
  const store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(user.id);
  return res.redirect(store ? '/seller/dashboard' : '/seller/setup');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
