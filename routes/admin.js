const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Admin dashboard
router.get('/', isAuthenticated, isAdmin, (req, res) => {
  const totalSellers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'seller'").get().count;
  const totalBuyers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'buyer'").get().count;
  const totalProducts = db.prepare("SELECT COUNT(*) as count FROM products").get().count;
  const totalOrders = db.prepare("SELECT COUNT(*) as count FROM orders").get().count;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(service_fee), 0) as total FROM earnings").get().total;
  const pendingPayouts = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payouts WHERE status = 'pending'").get().total;
  const pendingStores = db.prepare("SELECT COUNT(*) as count FROM stores WHERE approved = 0").get().count;

  const recentOrders = db.prepare(`
    SELECT o.*, u.name as buyer_name, s.name as store_name
    FROM orders o
    JOIN users u ON o.buyer_id = u.id
    JOIN stores s ON o.store_id = s.id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  const payoutAccounts = {
    adsense: 'faheemshaikh466@gmail.com',
    jazzcash: '03322462335'
  };

  res.render('admin/dashboard', {
    title: 'Admin Dashboard - Zaishah Store',
    totalSellers, totalBuyers, totalProducts, totalOrders,
    totalRevenue, pendingPayouts, pendingStores, recentOrders, payoutAccounts
  });
});

// Manage sellers
router.get('/sellers', isAuthenticated, isAdmin, (req, res) => {
  const sellers = db.prepare(`
    SELECT u.*, s.id as store_id, s.name as store_name, s.slug, s.approved, s.registration_paid, s.created_at as store_created,
      (SELECT COUNT(*) FROM products WHERE store_id = s.id) as product_count,
      (SELECT COALESCE(SUM(net_amount), 0) FROM earnings WHERE store_id = s.id) as total_earnings
    FROM users u
    LEFT JOIN stores s ON u.id = s.user_id
    WHERE u.role = 'seller'
    ORDER BY u.created_at DESC
  `).all();

  res.render('admin/sellers', { title: 'Manage Sellers - Zaishah Store', sellers });
});

// Approve/reject store
router.post('/stores/:id/approve', isAuthenticated, isAdmin, (req, res) => {
  db.prepare('UPDATE stores SET approved = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/sellers');
});

router.post('/stores/:id/reject', isAuthenticated, isAdmin, (req, res) => {
  db.prepare('UPDATE stores SET approved = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/sellers');
});

// All products
router.get('/products', isAuthenticated, isAdmin, (req, res) => {
  const products = db.prepare(`
    SELECT p.*, s.name as store_name
    FROM products p
    JOIN stores s ON p.store_id = s.id
    ORDER BY p.created_at DESC
  `).all();

  res.render('admin/products', { title: 'All Products - Zaishah Store', products });
});

// All orders
router.get('/orders', isAuthenticated, isAdmin, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, u.name as buyer_name, u.email as buyer_email, s.name as store_name
    FROM orders o
    JOIN users u ON o.buyer_id = u.id
    JOIN stores s ON o.store_id = s.id
    ORDER BY o.created_at DESC
  `).all();

  orders.forEach(order => {
    order.items = db.prepare(`
      SELECT oi.*, p.name as product_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);
  });

  res.render('admin/orders', { title: 'All Orders - Zaishah Store', orders });
});

// Payouts
router.get('/payouts', isAuthenticated, isAdmin, (req, res) => {
  const payouts = db.prepare(`
    SELECT p.*, s.name as store_name, u.email as seller_email
    FROM payouts p
    JOIN stores s ON p.store_id = s.id
    JOIN users u ON s.user_id = u.id
    ORDER BY p.created_at DESC
  `).all();

  res.render('admin/payouts', { title: 'Manage Payouts - Zaishah Store', payouts });
});

router.post('/payouts/:id/approve', isAuthenticated, isAdmin, (req, res) => {
  db.prepare("UPDATE payouts SET status = 'approved' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/payouts');
});

router.post('/payouts/:id/pay', isAuthenticated, isAdmin, (req, res) => {
  db.prepare("UPDATE payouts SET status = 'paid' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/payouts');
});

router.post('/payouts/:id/reject', isAuthenticated, isAdmin, (req, res) => {
  db.prepare("UPDATE payouts SET status = 'rejected' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/payouts');
});

// Revenue report
router.get('/revenue', isAuthenticated, isAdmin, (req, res) => {
  const monthlyRevenue = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month,
      SUM(service_fee) as fees,
      SUM(amount) as gross,
      COUNT(*) as order_count
    FROM earnings
    GROUP BY month
    ORDER BY month DESC
  `).all();

  const totalFees = db.prepare("SELECT COALESCE(SUM(service_fee), 0) as total FROM earnings").get().total;
  const totalPaidOut = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payouts WHERE status = 'paid'").get().total;

  res.render('admin/revenue', {
    title: 'Revenue Report - Zaishah Store',
    monthlyRevenue, totalFees, totalPaidOut
  });
});

module.exports = router;
