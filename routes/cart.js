const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');

// View cart
router.get('/', isAuthenticated, (req, res) => {
  const items = db.prepare(`
    SELECT ci.*, p.name, p.price, p.images, p.stock, s.name as store_name, s.slug as store_slug
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    JOIN stores s ON p.store_id = s.id
    WHERE ci.user_id = ?
  `).all(req.user.id);

  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  res.render('cart/index', { title: 'Shopping Cart - Zaishah Store', items, total });
});

// Add to cart
router.post('/add', isAuthenticated, (req, res) => {
  const { productId, quantity = 1 } = req.body;
  
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (product.stock < quantity) {
    return res.status(400).json({ error: 'Not enough stock' });
  }

  // Check if item already in cart
  const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
  
  if (existing) {
    const newQty = existing.quantity + parseInt(quantity);
    if (newQty > product.stock) {
      return res.status(400).json({ error: 'Not enough stock' });
    }
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(req.user.id, productId, parseInt(quantity));
  }

  const cartCount = db.prepare('SELECT COUNT(*) as count FROM cart_items WHERE user_id = ?').get(req.user.id);
  res.json({ success: true, cartCount: cartCount.count });
});

// Update quantity
router.post('/update', isAuthenticated, (req, res) => {
  const { itemId, quantity } = req.body;
  
  if (quantity <= 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(itemId, req.user.id);
  } else {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?').run(parseInt(quantity), itemId, req.user.id);
  }

  res.json({ success: true });
});

// Remove from cart
router.post('/remove', isAuthenticated, (req, res) => {
  const { itemId } = req.body;
  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(itemId, req.user.id);
  res.json({ success: true });
});

module.exports = router;
