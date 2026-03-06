const db = require('../db/database');

// Check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
      return next();
    }
  }
  res.redirect('/auth/login');
}

// Check if user is a seller with approved store
function isSeller(req, res, next) {
  if (req.user && req.user.role === 'seller') {
    const store = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(req.user.id);
    req.store = store;
    res.locals.store = store;
    return next();
  }
  res.status(403).render('error', { title: 'Access Denied', message: 'You need a seller account to access this page.', user: req.user });
}

// Check if user is admin
function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).render('error', { title: 'Access Denied', message: 'Admin access required.', user: req.user });
}

// Load user for all routes (non-blocking)
function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
      // Load cart count
      const cartCount = db.prepare('SELECT COUNT(*) as count FROM cart_items WHERE user_id = ?').get(user.id);
      res.locals.cartCount = cartCount ? cartCount.count : 0;
    }
  }
  res.locals.user = res.locals.user || null;
  res.locals.cartCount = res.locals.cartCount || 0;
  next();
}

module.exports = { isAuthenticated, isSeller, isAdmin, loadUser };
