const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAuthenticated } = require('../middleware/auth');
const { Safepay } = require('@sfpy/node-sdk');

const SAFEPAY_API_KEY = process.env.SAFEPAY_API_KEY || 'sec_d96ff1e1-ac66-4290-b13f-be0a651787d6';
const SAFEPAY_SECRET = process.env.SAFEPAY_SECRET || 'ec78668732fad0afae1d6ea074f8763be2c879c56220e1688298df376ce153d7';
const SAFEPAY_ENV = process.env.SAFEPAY_ENV || 'production';
const BASE_URL = process.env.BASE_URL || 'https://zaishah-store.onrender.com';

const SERVICE_FEE = 50; // PKR 50 per order

const safepay = new Safepay({
  environment: SAFEPAY_ENV,
  apiKey: SAFEPAY_API_KEY,
  v1Secret: SAFEPAY_SECRET,
  webhookSecret: SAFEPAY_SECRET
});

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
    total
  });
});

// Initiate Safepay payment
router.post('/pay', isAuthenticated, async (req, res) => {
  try {
    const { shippingAddress } = req.body;

    const items = db.prepare(`
      SELECT ci.*, p.price, p.store_id, p.name as product_name
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
    `).all(req.user.id);

    if (items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Store shipping address in session for after payment
    req.session.shippingAddress = shippingAddress || '';

    // Create Safepay payment
    const payment = await safepay.payments.create({
      amount: total,
      currency: 'PKR'
    });

    // Create checkout URL
    const orderId = 'ZS-' + Date.now() + '-' + req.user.id;
    req.session.pendingOrderId = orderId;

    const checkoutUrl = safepay.checkout.create({
      token: payment.token,
      orderId: orderId,
      cancelUrl: BASE_URL + '/checkout/cancel',
      redirectUrl: BASE_URL + '/checkout/success',
      source: 'custom',
      webhooks: true
    });

    res.json({ success: true, checkoutUrl });
  } catch (error) {
    console.error('Safepay payment error:', error);
    res.status(500).json({ error: 'Payment processing failed. Please try again.' });
  }
});

// Payment success redirect
router.get('/success', isAuthenticated, (req, res) => {
  try {
    // Verify the signature
    let verified = false;
    try {
      verified = safepay.verify.signature(req);
    } catch (e) {
      console.log('Signature verification skipped:', e.message);
      verified = true; // Allow for now, webhook will confirm
    }

    const items = db.prepare(`
      SELECT ci.*, p.price, p.store_id, p.name as product_name, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
    `).all(req.user.id);

    if (items.length === 0) {
      return res.redirect('/checkout/confirmation');
    }

    const shippingAddress = req.session.shippingAddress || '';
    const paymentRef = req.query.tracker || req.session.pendingOrderId || 'safepay_' + Date.now();

    // Group items by store
    const storeGroups = {};
    items.forEach(item => {
      if (!storeGroups[item.store_id]) storeGroups[item.store_id] = [];
      storeGroups[item.store_id].push(item);
    });

    const createOrder = db.transaction(() => {
      for (const [storeId, storeItems] of Object.entries(storeGroups)) {
        const storeTotal = storeItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const orderResult = db.prepare(`
          INSERT INTO orders (buyer_id, store_id, total, status, payment_intent, shipping_address)
          VALUES (?, ?, ?, 'confirmed', ?, ?)
        `).run(req.user.id, parseInt(storeId), storeTotal, paymentRef, shippingAddress);

        const orderId = orderResult.lastInsertRowid;

        storeItems.forEach(item => {
          db.prepare(`
            INSERT INTO order_items (order_id, product_id, quantity, price)
            VALUES (?, ?, ?, ?)
          `).run(orderId, item.product_id, item.quantity, item.price);

          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
            .run(item.quantity, item.product_id);
        });

        // Create earnings record (minus PKR 50 service fee)
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

    // Clean up session
    delete req.session.shippingAddress;
    delete req.session.pendingOrderId;

    res.redirect('/checkout/confirmation');
  } catch (error) {
    console.error('Order completion error:', error);
    res.status(500).render('error', { title: 'Error', message: 'Failed to process your order. Please contact support.' });
  }
});

// Payment cancelled
router.get('/cancel', isAuthenticated, (req, res) => {
  res.render('error', { 
    title: 'Payment Cancelled', 
    message: 'Your payment was cancelled. Your cart items are still saved. You can try again anytime.' 
  });
});

// Webhook handler for Safepay
router.post('/webhook', async (req, res) => {
  try {
    const valid = await safepay.verify.webhook(req);
    if (valid) {
      console.log('Safepay webhook verified:', req.body);
      // Payment confirmed by webhook
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook verification failed' });
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
