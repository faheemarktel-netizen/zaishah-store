const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Homepage - seller onboarding landing page
router.get('/', (req, res) => {
  res.render('shop/home', { 
    title: 'Zaishah Store - Launch Your Online Store in Pakistan'
  });
});

// Individual store page (public - for seller's customers)
router.get('/store/:slug', (req, res) => {
  const store = db.prepare(`
    SELECT s.*, u.name as owner_name
    FROM stores s 
    JOIN users u ON s.user_id = u.id
    WHERE s.slug = ? AND s.approved = 1
  `).get(req.params.slug);

  if (!store) {
    return res.status(404).render('error', { title: 'Store Not Found', message: 'This store does not exist.' });
  }

  const products = db.prepare(`
    SELECT * FROM products WHERE store_id = ? AND active = 1 ORDER BY created_at DESC
  `).all(store.id);

  res.render('shop/store-detail', { title: `${store.name} - Zaishah Store`, store, products });
});

// Product detail (public - for seller's customers)
router.get('/product/:id', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, s.name as store_name, s.slug as store_slug, s.description as store_description
    FROM products p 
    JOIN stores s ON p.store_id = s.id
    WHERE p.id = ? AND p.active = 1 AND s.approved = 1
  `).get(req.params.id);

  if (!product) {
    return res.status(404).render('error', { title: 'Product Not Found', message: 'This product does not exist.' });
  }

  const relatedProducts = db.prepare(`
    SELECT p.*, s.name as store_name, s.slug as store_slug
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE p.store_id = ? AND p.id != ? AND p.active = 1
    LIMIT 4
  `).all(product.store_id, product.id);

  res.render('shop/product-detail', { title: `${product.name} - Zaishah Store`, product, relatedProducts });
});

module.exports = router;
