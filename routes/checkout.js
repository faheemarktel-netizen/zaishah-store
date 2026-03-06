const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');

const STRIPE_SK = process.env.STRIPE_SK || 'STRIPE_SK';
const STRIPE_PK = process.env.STRIPE_PK || 'STRIPE_PK';

// Only init Stripe if we have a real key
let stripe = null;
if (STRIPE_SK && STRIPE_SK !== 'STRIPE_SK') {
  stripe = require('stripe')(STRIPE_SK);
}

const SERVICE_FEE = 50; // PKR 50 per order

// Checkout page
router.get('/', isAuthenticated, (req, res) => {
  const items = db.prepare(`
    SELECT ci.*, p.name, p.price, p.images, p.stock, p.store_id, s.name as store_name
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    JOIN stores s ON p.store_id = s.id
    WHERE ci.user_id = ?
  `).all(req.user.id);

  if (items.length === 0) {
    return res.redirect('/cart');
  }

  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  res.render('cart/checkout', { 
    title: 'Checkout - Zaishah Store', 
    items, 
    total,
    stripePk: STRIPE_PK
  });
});

// Create payment intent
router.post('/create-payment-intent', isAuthenticated, async (req, res) => {
  try {
    const items = db.prepare(`
      SELECT ci.*, p.price, p.store_id
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
    `).all(req.user.id);

    if (items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const amountInPaisa = Math.round(total * 100); // Stripe needs smallest currency unit

    if (stripe) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInPaisa,
        currency: 'pkr',
        metadata: { userId: req.user.id.toString() }
      });
      return res.json({ clientSecret: paymentIntent.client_secret });
    }
    
    // Demo mode - simulate payment intent
    return res.json({ clientSecret: 'demo_secret_' + Date.now(), demo: true });
  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

// Process order after payment
router.post('/complete', isAuthenticated, (req, res) => {
  try {
    const { paymentIntent, shippingAddress } = req.body;

    const items = db.prepare(`
      SELECT ci.*, p.price, p.store_id, p.name as product_name, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
    `).all(req.user.id);

    if (items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Group items by store
    const storeGroups = {};
    items.forEach(item => {
      if (!storeGroups[item.store_id]) storeGroups[item.store_id] = [];
      storeGroups[item.store_id].push(item);
    });

    const orderIds = [];

    const createOrder = db.transaction(() => {
      for (const [storeId, storeItems] of Object.entries(storeGroups)) {
        const storeTotal = storeItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // Create order
        const orderResult = db.prepare(`
          INSERT INTO orders (buyer_id, store_id, total, status, payment_intent, shipping_address)
          VALUES (?, ?, ?, 'confirmed', ?, ?)
        `).run(req.user.id, parseInt(storeId), storeTotal, paymentIntent || 'demo', shippingAddress || '');

        const orderId = orderResult.lastInsertRowid;
        orderIds.push(orderId);

        // Create order items & update stock
        storeItems.forEach(item => {
          db.prepare(`
            INSERT INTO order_items (order_id, product_id, quantity, price)
            VALUES (?, ?, ?, ?)
          `).run(orderId, item.product_id, item.quantity, item.price);

          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
            .run(item.quantity, item.product_id);
        });

        // Create earnings record
        const netAmount = storeTotal - SERVICE_FEE;
        db.prepare(`
          INSERT INTO earnings (store_id, order_id, amount, service_fee, net_amount)
          VALUES (?, ?, ?, ?, ?)
        `).run(parseInt(storeId), orderId, storeTotal, SERVICE_FEE, netAmount);
      }

      // Clear cart
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
    });

    createOrder();

    res.json({ success: true, orderIds });
  } catch (error) {
    console.error('Order completion error:', error);
    res.status(500).json({ error: 'Failed to process order' });
  }
});

// Order confirmation
router.get('/confirmation', isAuthenticated, (req, res) => {
  const recentOrders = db.prepare(`
    SELECT o.*, s.name as store_name
    FROM orders o
    JOIN stores s ON o.store_id = s.id
    WHERE o.buyer_id = ?
    ORDER BY o.created_at DESC
    LIMIT 5
  `).all(req.user.id);

  res.render('cart/confirmation', { title: 'Order Confirmed - Zaishah Store', orders: recentOrders });
});

// My orders
router.get('/orders', isAuthenticated, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, s.name as store_name
    FROM orders o
    JOIN stores s ON o.store_id = s.id
    WHERE o.buyer_id = ?
    ORDER BY o.created_at DESC
  `).all(req.user.id);

  // Get items for each order
  orders.forEach(order => {
    order.items = db.prepare(`
      SELECT oi.*, p.name, p.images
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);
  });

  res.render('cart/orders', { title: 'My Orders - Zaishah Store', orders });
});

module.exports = router;
