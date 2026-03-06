const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAuthenticated, isSeller } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const slugify = require('slugify');

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Store setup page (for new sellers)
router.get('/setup', isAuthenticated, (req, res) => {
  if (req.user.role !== 'seller') {
    return res.redirect('/');
  }
  const existingStore = db.prepare('SELECT * FROM stores WHERE user_id = ?').get(req.user.id);
  if (existingStore) return res.redirect('/seller/dashboard');
  res.render('seller/setup', { title: 'Setup Your Store - Zaishah Store' });
});

router.post('/setup', isAuthenticated, upload.single('logo'), (req, res) => {
  if (req.user.role !== 'seller') return res.redirect('/');
  
  const { name, description } = req.body;
  if (!name || name.trim().length < 3) {
    return res.render('seller/setup', { title: 'Setup Your Store', error: 'Store name must be at least 3 characters.' });
  }

  const slug = slugify(name, { lower: true, strict: true });
  const logo = req.file ? '/uploads/' + req.file.filename : null;

  try {
    db.prepare('INSERT INTO stores (user_id, name, slug, description, logo) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, name.trim(), slug, description, logo);
    res.redirect('/seller/dashboard');
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.render('seller/setup', { title: 'Setup Your Store', error: 'A store with this name already exists.' });
    }
    throw err;
  }
});

// Dashboard
router.get('/dashboard', isAuthenticated, isSeller, (req, res) => {
  const store = req.store;
  if (!store) return res.redirect('/seller/setup');

  const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE store_id = ?').get(store.id).count;
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE store_id = ?').get(store.id).count;
  const totalEarnings = db.prepare('SELECT COALESCE(SUM(net_amount), 0) as total FROM earnings WHERE store_id = ?').get(store.id).total;
  const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND status IN ('confirmed', 'processing')").get(store.id).count;
  const recentOrders = db.prepare(`
    SELECT o.*, u.name as buyer_name
    FROM orders o
    JOIN users u ON o.buyer_id = u.id
    WHERE o.store_id = ?
    ORDER BY o.created_at DESC LIMIT 5
  `).all(store.id);

  res.render('seller/dashboard', {
    title: 'Seller Dashboard - Zaishah Store',
    store, productCount, orderCount, totalEarnings, pendingOrders, recentOrders
  });
});

// Products management
router.get('/products', isAuthenticated, isSeller, (req, res) => {
  if (!req.store) return res.redirect('/seller/setup');
  const products = db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC').all(req.store.id);
  res.render('seller/products', { title: 'My Products - Zaishah Store', products, store: req.store });
});

// Add product form
router.get('/products/add', isAuthenticated, isSeller, (req, res) => {
  if (!req.store) return res.redirect('/seller/setup');
  res.render('seller/product-form', { title: 'Add Product - Zaishah Store', product: null, store: req.store });
});

// Create product
router.post('/products/add', isAuthenticated, isSeller, upload.array('images', 5), (req, res) => {
  if (!req.store) return res.redirect('/seller/setup');
  
  const { name, description, price, stock, category } = req.body;
  
  if (!name || !price || price <= 0) {
    return res.render('seller/product-form', {
      title: 'Add Product', product: req.body, store: req.store,
      error: 'Name and valid price are required.'
    });
  }

  const images = req.files ? JSON.stringify(req.files.map(f => '/uploads/' + f.filename)) : '[]';

  db.prepare(`
    INSERT INTO products (store_id, name, description, price, images, stock, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.store.id, name.trim(), description, parseFloat(price), images, parseInt(stock) || 0, category);

  res.redirect('/seller/products');
});

// Edit product form
router.get('/products/edit/:id', isAuthenticated, isSeller, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!product) return res.redirect('/seller/products');
  res.render('seller/product-form', { title: 'Edit Product - Zaishah Store', product, store: req.store });
});

// Update product
router.post('/products/edit/:id', isAuthenticated, isSeller, upload.array('images', 5), (req, res) => {
  const { name, description, price, stock, category, active } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!product) return res.redirect('/seller/products');

  let images = product.images;
  if (req.files && req.files.length > 0) {
    images = JSON.stringify(req.files.map(f => '/uploads/' + f.filename));
  }

  db.prepare(`
    UPDATE products SET name = ?, description = ?, price = ?, images = ?, stock = ?, category = ?, active = ?
    WHERE id = ? AND store_id = ?
  `).run(name.trim(), description, parseFloat(price), images, parseInt(stock) || 0, category, active ? 1 : 0, req.params.id, req.store.id);

  res.redirect('/seller/products');
});

// Delete product
router.post('/products/delete/:id', isAuthenticated, isSeller, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').run(req.params.id, req.store.id);
  res.redirect('/seller/products');
});

// Orders management
router.get('/orders', isAuthenticated, isSeller, (req, res) => {
  if (!req.store) return res.redirect('/seller/setup');
  
  const orders = db.prepare(`
    SELECT o.*, u.name as buyer_name, u.email as buyer_email
    FROM orders o
    JOIN users u ON o.buyer_id = u.id
    WHERE o.store_id = ?
    ORDER BY o.created_at DESC
  `).all(req.store.id);

  orders.forEach(order => {
    order.items = db.prepare(`
      SELECT oi.*, p.name as product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);
  });

  res.render('seller/orders', { title: 'Orders - Zaishah Store', orders, store: req.store });
});

// Update order status
router.post('/orders/:id/status', isAuthenticated, isSeller, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.redirect('/seller/orders');

  db.prepare('UPDATE orders SET status = ? WHERE id = ? AND store_id = ?').run(status, req.params.id, req.store.id);
  res.redirect('/seller/orders');
});

// Earnings
router.get('/earnings', isAuthenticated, isSeller, (req, res) => {
  if (!req.store) return res.redirect('/seller/setup');

  const earnings = db.prepare(`
    SELECT e.*, o.status as order_status
    FROM earnings e
    JOIN orders o ON e.order_id = o.id
    WHERE e.store_id = ?
    ORDER BY e.created_at DESC
  `).all(req.store.id);

  const totalEarnings = db.prepare('SELECT COALESCE(SUM(net_amount), 0) as total FROM earnings WHERE store_id = ?').get(req.store.id).total;
  const totalFees = db.prepare('SELECT COALESCE(SUM(service_fee), 0) as total FROM earnings WHERE store_id = ?').get(req.store.id).total;
  
  const payouts = db.prepare('SELECT * FROM payouts WHERE store_id = ? ORDER BY created_at DESC').all(req.store.id);
  const totalPaid = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payouts WHERE store_id = ? AND status = 'paid'").get(req.store.id).total;

  const availableBalance = totalEarnings - totalPaid;

  res.render('seller/earnings', {
    title: 'Earnings - Zaishah Store',
    earnings, totalEarnings, totalFees, payouts, totalPaid, availableBalance, store: req.store
  });
});

// Request payout
router.post('/payout-request', isAuthenticated, isSeller, (req, res) => {
  const { amount, method } = req.body;
  if (!amount || amount <= 0) return res.redirect('/seller/earnings');

  const totalEarnings = db.prepare('SELECT COALESCE(SUM(net_amount), 0) as total FROM earnings WHERE store_id = ?').get(req.store.id).total;
  const totalPaid = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payouts WHERE store_id = ? AND status IN ('paid', 'pending', 'approved')").get(req.store.id).total;
  const available = totalEarnings - totalPaid;

  if (parseFloat(amount) > available) {
    return res.redirect('/seller/earnings');
  }

  db.prepare('INSERT INTO payouts (store_id, amount, method) VALUES (?, ?, ?)').run(req.store.id, parseFloat(amount), method || 'bank_transfer');
  res.redirect('/seller/earnings');
});

module.exports = router;
