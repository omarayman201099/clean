# Cleaning Products Store — Backend

Node.js + Express + MongoDB backend with an admin dashboard for managing a cleaning products store.

## Features

- REST API with JWT authentication (admin & customer)
- Product, category, and order management
- Image uploads (multer)
- Admin dashboard (HTML/CSS/JS in `public/`)
- Supports **local MongoDB** or **MongoDB Atlas** (cloud) via `.env`

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env and edit it
cp .env.example .env        # Linux / macOS
copy .env.example .env      # Windows

# 3. Set your MONGO_URI in .env (local or Atlas)

# 4. Start the server
npm start
#    — or with auto-reload —
npm run dev
```

Open the admin dashboard at **http://localhost:3000/admin**.

## Environment Variables (`.env`)

| Variable     | Default                                    | Description                       |
| ------------ | ------------------------------------------ | --------------------------------- |
| `PORT`       | `3000`                                     | HTTP port                         |
| `MONGO_URI`  | `mongodb://localhost:27017/CleaningStore`   | MongoDB connection string         |
| `JWT_SECRET` | `cleaning-store-secret-key-2024`           | Secret for signing JWT tokens     |

### Using MongoDB Atlas (cloud)

Set `MONGO_URI` in `.env` to your Atlas connection string:

```
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/CleaningStore?retryWrites=true&w=majority
```

### Using local MongoDB

Make sure `mongod` is running, then use the default:

```
MONGO_URI=mongodb://localhost:27017/CleaningStore
```

## API Endpoints

### Customer Auth
| Method | Path                        | Auth | Description             |
| ------ | --------------------------- | ---- | ----------------------- |
| POST   | `/api/customers/register`   | No   | Register a customer     |
| POST   | `/api/customers/login`      | No   | Login (returns JWT)     |
| GET    | `/api/customers/me`         | Yes  | Current customer info   |

### Admin Auth
| Method | Path                | Auth | Description                          |
| ------ | ------------------- | ---- | ------------------------------------ |
| POST   | `/api/auth/register`| No   | Register admin (first = superadmin)  |
| POST   | `/api/auth/login`   | No   | Admin login                          |
| GET    | `/api/auth/me`      | Yes  | Current admin info                   |

### Categories
| Method | Path                    | Auth | Description                             |
| ------ | ----------------------- | ---- | --------------------------------------- |
| GET    | `/api/categories`       | No   | List all categories                     |
| GET    | `/api/categories/:id`   | No   | Get single category                     |
| POST   | `/api/categories`       | Yes  | Create category                         |
| PUT    | `/api/categories/:id`   | Yes  | Update category                         |
| DELETE | `/api/categories/:id`   | Yes  | Delete (blocked if products exist)      |

### Products
| Method | Path                 | Auth | Description                             |
| ------ | -------------------- | ---- | --------------------------------------- |
| GET    | `/api/products`      | No   | List products (`?category=`, `?all=`)   |
| GET    | `/api/products/:id`  | No   | Get single product                      |
| POST   | `/api/products`      | Yes  | Create (multipart, `image` field)       |
| PUT    | `/api/products/:id`  | Yes  | Update (multipart, optional image)      |
| DELETE | `/api/products/:id`  | Yes  | Delete product + image file             |

### Orders
| Method | Path                       | Auth | Description             |
| ------ | -------------------------- | ---- | ----------------------- |
| GET    | `/api/orders`              | Yes  | List all orders         |
| GET    | `/api/orders/:id`          | Yes  | Get single order        |
| POST   | `/api/orders`              | No   | Create order            |
| PUT    | `/api/orders/:id/status`   | Yes  | Update order status     |
| DELETE | `/api/orders/:id`          | Yes  | Delete order            |

### Stats
| Method | Path          | Auth | Description               |
| ------ | ------------- | ---- | ------------------------- |
| GET    | `/api/stats`  | Yes  | Dashboard statistics      |

## Project Structure

```
cleaning-main/
├── .env.example        # Environment template
├── .gitignore
├── server.js           # Main entry point (all routes)
├── package.json
├── test_stats.js       # Quick stats test script
├── public/
│   ├── admin.html      # Admin dashboard
│   ├── admin.css
│   └── admin.js
├── uploads/            # Product images
└── data/               # Legacy JSON (not used by server)
```

## License

Free to use and modify.
