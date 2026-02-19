/* eslint-disable no-console */
// ============================================================
//  Cleaning Products Store — Main Server (Fixed & Secured)
// ============================================================

require('dotenv').config();

const express   = require('express');
const mongoose  = require('mongoose');
const multer    = require('multer');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet    = require('helmet');

// ======================== EXPRESS APP ========================

const app = express();

app.use(helmet({
  contentSecurityPolicy    : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin        : process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGIN : true,
  methods       : ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ FIX #1: CORP header على الـ uploads عشان الصور تتحمل من أي origin
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// ======================== CONFIGURATION =====================

const PORT      = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGO_URI) {
  console.error('FATAL: MONGO_URI environment variable is not set.');
  process.exit(1);
}

// ======================== MONGODB ===========================

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => { console.error('MongoDB connection failed:', err.message); process.exit(1); });

// ======================== RATE LIMITERS =====================

const authLimiter = rateLimit({
  windowMs      : 15 * 60 * 1000,
  max           : 10,
  message       : { error: 'Too many attempts, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max     : 5,
  message : { error: 'Too many registration attempts, please try again later.' },
});

// ======================== SCHEMAS & MODELS ==================

const adminSchema = new mongoose.Schema({
  username : { type: String, required: true, unique: true, trim: true },
  email    : { type: String, required: true, unique: true, trim: true, lowercase: true },
  password : { type: String, required: true },
  phone    : { type: String, trim: true },
  role     : { type: String, enum: ['superadmin', 'admin'], default: 'admin' },
  createdAt: { type: Date, default: Date.now },
});

const customerSchema = new mongoose.Schema({
  username : { type: String, required: true, trim: true },
  email    : { type: String, required: true, unique: true, trim: true, lowercase: true },
  password : { type: String, required: true },
  phone    : { type: String, trim: true },
  createdAt: { type: Date, default: Date.now },
});

const categorySchema = new mongoose.Schema({
  name       : { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  createdAt  : { type: Date, default: Date.now },
  updatedAt  : { type: Date },
});

const productSchema = new mongoose.Schema({
  name       : { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price      : { type: Number, required: true, min: 0 },
  category   : { type: String, required: true },
  stock      : { type: Number, default: 0, min: 0 },
  image      : { type: String, default: '/uploads/placeholder.svg' },
  createdAt  : { type: Date, default: Date.now },
  updatedAt  : { type: Date },
});

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name     : { type: String, required: true },
  quantity : { type: Number, required: true, min: 1 },
  price    : { type: Number, required: true, min: 0 },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  customerName : { type: String, required: true },
  customerEmail: { type: String, required: true },
  customerPhone: { type: String },
  address      : { type: String, required: true },
  items        : { type: [orderItemSchema], default: [] },
  totalAmount  : { type: Number, default: 0 },
  status       : { type: String, default: 'pending', enum: ['pending', 'confirmed', 'delivered', 'cancelled'] },
  createdAt    : { type: Date, default: Date.now },
  updatedAt    : { type: Date },
});

const Admin    = mongoose.model('Admin',    adminSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Category = mongoose.model('Category', categorySchema);
const Product  = mongoose.model('Product',  productSchema);
const Order    = mongoose.model('Order',    orderSchema);

// ======================== FILE UPLOAD =======================

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename   : (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits    : { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk   = allowed.test(path.extname(file.originalname).toLowerCase());
    // ✅ FIX #2: mime type check أدق
    const mimeOk  = /image\/(jpeg|png|gif|webp)/.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed'));
  },
});

// ======================== HELPERS ===========================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

function authenticateToken(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.type !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin access required.' });
  next();
}

// ✅ FIX #3: middleware مستقل للـ customer
function requireCustomer(req, res, next) {
  if (req.user.type !== 'customer') return res.status(403).json({ error: 'Customer access required.' });
  next();
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// ============================================================
//  ROUTES — CUSTOMER AUTH
// ============================================================

app.post('/api/customers/register', registerLimiter, async (req, res) => {
  try {
    const { username, email, password, phone } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are required' });
    }
    // ✅ FIX #4: username validation
    if (username.trim().length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await Customer.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ error: 'Email already in use' });

    const hash     = await bcrypt.hash(password, 12);
    const customer = await Customer.create({ username: username.trim(), email: email.toLowerCase(), password: hash, phone });

    // ✅ FIX #5: رجّع token + بيانات الـ customer بعد التسجيل مباشرة (auto-login)
    const token = generateToken({ id: customer._id, type: 'customer' });
    res.status(201).json({
      token,
      customer: { id: customer._id, username: customer.username, email: customer.email, phone: customer.phone },
    });
  } catch (err) {
    console.error('Customer register error:', err);
    // ✅ FIX #6: explicit duplicate key error
    if (err.code === 11000) return res.status(400).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/customers/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    // ✅ FIX #7: البحث بـ lowercase
    const customer = await Customer.findOne({ email: email.toLowerCase() });
    if (!customer) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, customer.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken({ id: customer._id, type: 'customer' });

    // ✅ FIX #8: رجّع بيانات الـ customer مع الـ token
    res.json({
      token,
      customer: { id: customer._id, username: customer.username, email: customer.email, phone: customer.phone },
    });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/customers/me', authenticateToken, requireCustomer, async (req, res) => {
  try {
    const customer = await Customer.findById(req.user.id).select('-password');
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    console.error('GET /api/customers/me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ FIX #9: endpoint صح للـ customer يشوف orders بتاعته بس — secure
//    الكود القديم كان يحاول يجيب /api/orders (admin endpoint) ويفلتره في الـ frontend — خطأ أمني كبير
app.get('/api/customers/orders', authenticateToken, requireCustomer, async (req, res) => {
  try {
    const customer = await Customer.findById(req.user.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const orders = await Order.find({ customerEmail: customer.email })
      .sort({ createdAt: -1 })
      .select('-__v');
    res.json(orders);
  } catch (err) {
    console.error('GET /api/customers/orders error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// ============================================================
//  ROUTES — ADMIN AUTH
// ============================================================

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const { username, email, password, phone } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are required' });
    }
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 8) return res.status(400).json({ error: 'Admin password must be at least 8 characters' });

    const count = await Admin.countDocuments();

    if (count > 0) {
      const token = (req.headers.authorization || '').split(' ')[1];
      if (!token) return res.status(401).json({ error: 'Only a superadmin can register new admins.' });
      let decoded;
      try { decoded = jwt.verify(token, JWT_SECRET); }
      catch { return res.status(403).json({ error: 'Invalid or expired token.' }); }
      if (decoded.type !== 'admin' || decoded.role !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can register new admins.' });
      }
    }

    const role  = count === 0 ? 'superadmin' : 'admin';
    const hash  = await bcrypt.hash(password, 12);
    const admin = await Admin.create({ username, email: email.toLowerCase(), password: hash, role, phone });

    const newToken = generateToken({ id: admin._id, type: 'admin', role: admin.role });
    res.status(201).json({ token: newToken, admin: { id: admin._id, username, email: admin.email, role } });
  } catch (err) {
    console.error('Admin register error:', err);
    if (err.code === 11000) return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken({ id: admin._id, type: 'admin', role: admin.role });
    res.json({ token, admin: { id: admin._id, username: admin.username, email: admin.email, phone: admin.phone, role: admin.role } });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.user.id).select('-password');
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json(admin);
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
//  ROUTES — CATEGORIES
// ============================================================

app.get('/api/categories', async (_req, res) => {
  try {
    res.json(await Category.find().sort({ name: 1 }));
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

app.get('/api/categories/:id', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid category ID' });
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });
    res.json(category);
  } catch (err) {
    console.error('GET /api/categories/:id error:', err);
    res.status(500).json({ error: 'Failed to load category' });
  }
});

app.post('/api/categories', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
    const category = await Category.create({ name: name.trim(), description });
    res.status(201).json(category);
  } catch (err) {
    console.error('POST /api/categories error:', err);
    if (err.code === 11000) return res.status(400).json({ error: 'Category already exists' });
    res.status(500).json({ error: 'Failed to create category' });
  }
});

app.put('/api/categories/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid category ID' });
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const { name, description } = req.body;
    if (name) category.name = name.trim();
    if (description !== undefined) category.description = description;
    category.updatedAt = Date.now();
    await category.save();
    res.json(category);
  } catch (err) {
    console.error('PUT /api/categories/:id error:', err);
    if (err.code === 11000) return res.status(400).json({ error: 'Category name already exists' });
    res.status(500).json({ error: 'Failed to update category' });
  }
});

app.delete('/api/categories/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid category ID' });
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const productCount = await Product.countDocuments({ category: category.name });
    if (productCount > 0) {
      return res.status(400).json({ error: `Cannot delete category that has ${productCount} product(s)` });
    }

    await category.deleteOne();
    res.json({ message: 'Category deleted' });
  } catch (err) {
    console.error('DELETE /api/categories/:id error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ============================================================
//  ROUTES — PRODUCTS
// ============================================================

app.get('/api/products', async (req, res) => {
  try {
    const { category, all } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (!all || all === 'false') filter.stock = { $gt: 0 };
    res.json(await Product.find(filter).sort({ createdAt: -1 }));
  } catch (err) {
    console.error('GET /api/products error:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    console.error('GET /api/products/:id error:', err);
    res.status(500).json({ error: 'Failed to load product' });
  }
});

app.post('/api/products', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, stock } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ error: 'name, price and category are required' });
    }

    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock, 10);

    if (isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ error: 'Invalid price value' });
    // ✅ FIX #10: validate stock
    if (isNaN(parsedStock) || parsedStock < 0) return res.status(400).json({ error: 'Invalid stock value' });

    // ✅ FIX #11: التأكد إن الـ category موجودة
    const catExists = await Category.findOne({ name: category });
    if (!catExists) return res.status(400).json({ error: `Category "${category}" does not exist` });

    const product = await Product.create({
      name       : name.trim(),
      description: description?.trim() || '',
      price      : parsedPrice,
      category,
      stock      : parsedStock || 0,
      image      : req.file ? '/uploads/' + req.file.filename : '/uploads/placeholder.svg',
    });

    res.status(201).json(product);
  } catch (err) {
    // ✅ FIX #12: احذف الصورة المرفوعة لو الـ request فشل
    if (req.file) {
      const fp = path.join(uploadsDir, req.file.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    console.error('POST /api/products error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/products/:id', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const { name, description, price, category, stock } = req.body;

    if (name !== undefined)        product.name        = name.trim();
    if (description !== undefined) product.description = description.trim();
    if (price !== undefined) {
      const p = parseFloat(price);
      if (isNaN(p) || p < 0) return res.status(400).json({ error: 'Invalid price value' });
      product.price = p;
    }
    if (stock !== undefined) {
      const s = parseInt(stock, 10);
      if (isNaN(s) || s < 0) return res.status(400).json({ error: 'Invalid stock value' });
      product.stock = s;
    }
    if (category !== undefined) {
      // ✅ FIX #13: التأكد إن الـ category موجودة عند التعديل
      const catExists = await Category.findOne({ name: category });
      if (!catExists) return res.status(400).json({ error: `Category "${category}" does not exist` });
      product.category = category;
    }

    if (req.file) {
      if (product.image && product.image !== '/uploads/placeholder.svg') {
        const oldPath = path.join(__dirname, product.image);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      product.image = '/uploads/' + req.file.filename;
    }

    product.updatedAt = Date.now();
    await product.save();
    res.json(product);
  } catch (err) {
    if (req.file) {
      const fp = path.join(uploadsDir, req.file.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    console.error('PUT /api/products/:id error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    if (product.image && product.image !== '/uploads/placeholder.svg') {
      const oldPath = path.join(__dirname, product.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await product.deleteOne();
    res.json({ message: 'Product deleted' });
  } catch (err) {
    console.error('DELETE /api/products/:id error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ============================================================
//  ROUTES — ORDERS
// ============================================================

app.get('/api/orders', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    res.json(await Order.find().sort({ createdAt: -1 }));
  } catch (err) {
    console.error('GET /api/orders error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.get('/api/orders/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    console.error('GET /api/orders/:id error:', err);
    res.status(500).json({ error: 'Failed to load order' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, address, items } = req.body;

    if (!customerName || !customerEmail || !address) {
      return res.status(400).json({ error: 'customerName, customerEmail and address are required' });
    }
    if (!EMAIL_REGEX.test(customerEmail)) {
      return res.status(400).json({ error: 'Invalid customer email format' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }
    // ✅ FIX #14: حد أقصى للـ items
    if (items.length > 50) {
      return res.status(400).json({ error: 'Too many items in a single order (max 50)' });
    }

    const decremented    = [];
    const validatedItems = [];
    let calculatedTotal  = 0;

    for (const item of items) {
      const prodId = item.id || item.productId;
      const qty    = Number(item.quantity) || 1;

      // ✅ FIX #15: validate quantity بشكل صريح
      if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
        for (const d of decremented) await Product.findByIdAndUpdate(d.id, { $inc: { stock: d.qty } });
        return res.status(400).json({ error: 'Invalid quantity. Must be between 1 and 1000.' });
      }

      if (!isValidObjectId(prodId)) {
        for (const d of decremented) await Product.findByIdAndUpdate(d.id, { $inc: { stock: d.qty } });
        return res.status(400).json({ error: `Invalid product ID: ${prodId}` });
      }

      const updated = await Product.findOneAndUpdate(
        { _id: prodId, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true },
      );

      if (!updated) {
        for (const d of decremented) await Product.findByIdAndUpdate(d.id, { $inc: { stock: d.qty } });
        return res.status(400).json({ error: `Insufficient stock for "${item.name || prodId}"` });
      }

      decremented.push({ id: prodId, qty });
      calculatedTotal += updated.price * qty;
      validatedItems.push({ productId: updated._id, name: updated.name, quantity: qty, price: updated.price });
    }

    const order = await Order.create({
      customerName  : customerName.trim(),
      customerEmail : customerEmail.toLowerCase().trim(),
      customerPhone : customerPhone?.trim() || '',
      address       : address.trim(),
      items         : validatedItems,
      totalAmount   : parseFloat(calculatedTotal.toFixed(2)),
    });

    res.status(201).json(order);
  } catch (err) {
    console.error('POST /api/orders error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.put('/api/orders/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });

    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'delivered', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // ✅ FIX #16: منع رجوع الـ status لحالة سابقة غير منطقية
    if (order.status === 'delivered' && status === 'pending') {
      return res.status(400).json({ error: 'Cannot revert a delivered order to pending' });
    }

    order.status    = status;
    order.updatedAt = Date.now();
    await order.save();
    res.json(order);
  } catch (err) {
    console.error('PUT /api/orders/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

app.delete('/api/orders/:id', authenticateToken, requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order ID' });
    const deleted = await Order.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Order not found' });
    res.json({ message: 'Order deleted' });
  } catch (err) {
    console.error('DELETE /api/orders/:id error:', err);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// ============================================================
//  ROUTES — STATS
// ============================================================

app.get('/api/stats', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const [totalProducts, totalOrders, totalAdmins, salesAgg, statusAgg, lowStockProducts] =
      await Promise.all([
        Product.countDocuments(),
        Order.countDocuments(),
        Admin.countDocuments(),
        Order.aggregate([{ $group: { _id: null, sum: { $sum: '$totalAmount' } } }]),
        Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        // ✅ FIX #17: low stock في الـ stats مباشرة
        Product.find({ stock: { $lte: 5 } }).select('name stock category').limit(10),
      ]);

    const totalSales     = salesAgg[0]?.sum || 0;
    const ordersByStatus = {};
    statusAgg.forEach((s) => { ordersByStatus[s._id] = s.count; });

    res.json({ totalProducts, totalOrders, totalAdmins, totalSales, ordersByStatus, lowStockProducts });
  } catch (err) {
    console.error('GET /api/stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ============================================================
//  PAGE ROUTES
// ============================================================

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ✅ FIX #18: health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'Cleaning Store Backend Running' });
});

// ============================================================
//  ERROR HANDLERS
// ============================================================

// ✅ FIX #19: error handler شامل لأنواع errors أكتر
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Maximum size is 5 MB.' });
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message).join(', ');
    return res.status(400).json({ error: messages });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  res.status(500).json({ error: 'Something went wrong.' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// ============================================================
//  START SERVER
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('  Cleaning Products Store Backend');
  console.log(`  ENV:  ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Admin: /admin  |  Health: /health`);
  console.log('='.repeat(50));
});
