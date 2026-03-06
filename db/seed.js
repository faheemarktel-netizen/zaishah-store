const db = require('./database');

function seed() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminStmt = db.prepare(`
    INSERT OR IGNORE INTO users (email, name, avatar, role, google_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  adminStmt.run('faheemshaikh466@gmail.com', 'Faheem Shaikh', null, 'admin', 'admin_google_id');

  // Create sample seller users
  const sellerStmt = db.prepare(`
    INSERT OR IGNORE INTO users (email, name, avatar, role, google_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  sellerStmt.run('ali.fashion@example.com', 'Ali Hassan', null, 'seller', 'seller_1_google');
  sellerStmt.run('fatima.crafts@example.com', 'Fatima Noor', null, 'seller', 'seller_2_google');
  sellerStmt.run('usman.tech@example.com', 'Usman Khan', null, 'seller', 'seller_3_google');

  // Create sample buyer
  sellerStmt.run('buyer@example.com', 'Ahmed Buyer', null, 'buyer', 'buyer_1_google');

  // Get seller user IDs
  const sellers = db.prepare("SELECT id, name FROM users WHERE role = 'seller'").all();

  // Create stores
  const storeStmt = db.prepare(`
    INSERT OR IGNORE INTO stores (user_id, name, slug, description, logo, approved, registration_paid)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const storeData = [
    {
      name: 'Ali Fashion House',
      slug: 'ali-fashion-house',
      description: 'Premium Pakistani fashion including shalwar kameez, kurtas, and designer wear for men and women. Authentic fabrics sourced from Faisalabad.',
      approved: 1,
      registration_paid: 1
    },
    {
      name: 'Fatima Handicrafts',
      slug: 'fatima-handicrafts',
      description: 'Beautiful handmade crafts, embroidery, and traditional Pakistani artwork. Each piece tells a story of our rich cultural heritage.',
      approved: 1,
      registration_paid: 1
    },
    {
      name: 'TechZone PK',
      slug: 'techzone-pk',
      description: 'Latest gadgets, mobile accessories, and tech products at competitive prices. Fast shipping across Pakistan.',
      approved: 1,
      registration_paid: 1
    }
  ];

  sellers.forEach((seller, i) => {
    if (storeData[i]) {
      storeStmt.run(
        seller.id,
        storeData[i].name,
        storeData[i].slug,
        storeData[i].description,
        null,
        storeData[i].approved,
        storeData[i].registration_paid
      );
    }
  });

  // Get store IDs
  const stores = db.prepare("SELECT id, name FROM stores").all();

  // Create products
  const productStmt = db.prepare(`
    INSERT OR IGNORE INTO products (store_id, name, description, price, images, stock, category, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const products = [
    // Ali Fashion House products
    { store_idx: 0, name: 'Premium Lawn Suit - Emerald Collection', description: 'Beautiful 3-piece lawn suit with intricate embroidery. Includes shirt, dupatta, and trouser. Premium quality fabric perfect for summer.', price: 4500, stock: 25, category: 'Fashion', images: '[]' },
    { store_idx: 0, name: 'Men\'s Shalwar Kameez - White Cotton', description: 'Classic white cotton shalwar kameez for men. Comfortable and breathable fabric. Perfect for daily wear and special occasions.', price: 2800, stock: 40, category: 'Fashion', images: '[]' },
    { store_idx: 0, name: 'Bridal Lehnga - Royal Red', description: 'Stunning bridal lehnga in royal red with heavy embroidery and mirror work. A masterpiece for your special day.', price: 85000, stock: 5, category: 'Fashion', images: '[]' },
    { store_idx: 0, name: 'Pashmina Shawl - Kashmir', description: 'Authentic Kashmiri pashmina shawl with delicate embroidery. Warm, soft, and elegant.', price: 12000, stock: 15, category: 'Fashion', images: '[]' },

    // Fatima Handicrafts products
    { store_idx: 1, name: 'Truck Art Wall Hanging', description: 'Colorful truck art inspired wall hanging. Hand-painted on wood with vibrant colors. Brings Pakistani culture to your home.', price: 3500, stock: 20, category: 'Home & Art', images: '[]' },
    { store_idx: 1, name: 'Embroidered Cushion Covers (Set of 4)', description: 'Beautiful hand-embroidered cushion covers featuring traditional Sindhi patterns. Set of 4 in complementary colors.', price: 2200, stock: 30, category: 'Home & Art', images: '[]' },
    { store_idx: 1, name: 'Blue Pottery Vase - Multan', description: 'Authentic Multani blue pottery vase. Each piece is hand-crafted and unique. Perfect for home decoration.', price: 5500, stock: 12, category: 'Home & Art', images: '[]' },
    { store_idx: 1, name: 'Handwoven Kilim Rug (4x6)', description: 'Traditional handwoven kilim rug with geometric patterns. Made with natural dyes and pure wool.', price: 18000, stock: 8, category: 'Home & Art', images: '[]' },

    // TechZone PK products
    { store_idx: 2, name: 'Wireless Earbuds Pro', description: 'High-quality wireless earbuds with active noise cancellation. 24-hour battery life with charging case.', price: 6500, stock: 50, category: 'Electronics', images: '[]' },
    { store_idx: 2, name: 'Smart Watch - Fitness Edition', description: 'Feature-packed smartwatch with heart rate monitor, step counter, and notification support. Water resistant.', price: 8500, stock: 35, category: 'Electronics', images: '[]' },
    { store_idx: 2, name: 'Phone Case - Premium Leather', description: 'Premium leather phone case with card holder. Available for major smartphone brands. Elegant and protective.', price: 1200, stock: 100, category: 'Electronics', images: '[]' },
    { store_idx: 2, name: 'Portable Power Bank 20000mAh', description: 'High-capacity 20000mAh power bank with fast charging. Dual USB output. Perfect for travel.', price: 3800, stock: 45, category: 'Electronics', images: '[]' },
  ];

  products.forEach(p => {
    if (stores[p.store_idx]) {
      productStmt.run(
        stores[p.store_idx].id,
        p.name,
        p.description,
        p.price,
        p.images,
        p.stock,
        p.category,
        1
      );
    }
  });

  console.log('✅ Seed complete!');
  console.log(`   - ${sellers.length} sellers created`);
  console.log(`   - ${stores.length} stores created`);
  console.log(`   - ${products.length} products created`);
}

// Only seed if tables are empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  seed();
} else {
  console.log('ℹ️  Database already has data, skipping seed.');
}

module.exports = seed;
