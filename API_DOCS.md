# Cleaning Store Backend API Documentation

This document describes the endpoints exposed by the Cleaning Store backend server (`index.js`).  

*NOTE: the application now uses MongoDB as its datastore; data lives in the `CleaningStore` database.*

---

## Authentication

### Register Customer
- **URL:** `/api/customers/register`
- **Method:** POST
- **Fields (JSON):**
  - `username` (string) – required
  - `email` (string) – required, unique
  - `password` (string) – required, minimum 6 characters
  - `phone` (string) – optional, customer phone number
- **Behavior:** hashes password with bcrypt and creates a document in the `customers` collection in MongoDB.
- **Response:** `201` with JSON `{ message, token }`.

### Login Customer
- **URL:** `/api/customers/login`
- **Method:** POST
- **Fields (JSON):**
  - `email` (string) – registered address
  - `password` (string)
- **Behavior:** verifies password against MongoDB `customers` collection and returns a JWT if valid.
- **Response:** `200` with JSON `{ token }`.

### Get Current Customer
- **URL:** `/api/customers/me`
- **Method:** GET
- **Headers:** `Authorization: Bearer <token>`
- **Behavior:** extracts data from JWT and returns customer info (password excluded).
- **Response:** `200` with customer object (id, username, email, createdAt).

---

## Admin (existing functionality)

### Register Admin
- **URL:** `/api/auth/register`
- **Method:** POST
- **Fields:** `username`, `email`, `password`, `phone` (optional)
- **Note:** first registration creates superadmin.

### Login Admin
- **URL:** `/api/auth/login`
- **Method:** POST
- **Fields:** `username`, `password`
- **Response:** JWT token and admin details (includes `id`, `username`, `email`, `phone`, `role`).

### Get Admin Profile
- **URL:** `/api/auth/me`
- **Method:** GET
- **Headers:** `Authorization: Bearer <token>`
- **Response:** Admin object (id, username, email, phone, role).

---

## Categories
- `GET /api/categories` – list all categories
- `GET /api/categories/:id` – retrieve category
- `POST /api/categories` – create (protected)
- `PUT /api/categories/:id` – update (protected)
- `DELETE /api/categories/:id` – delete (protected, no products)

## Products
- `GET /api/products` – list products (optional `?category=` filter)
- `GET /api/products/:id` – retrieve product
- `POST /api/products` – create (protected, multipart/form-data with `image`)
- `PUT /api/products/:id` – update (protected)
- `DELETE /api/products/:id` – delete (protected)

## Orders
- `GET /api/orders` – list orders
- `POST /api/orders` – create order
- `PUT /api/orders/:id/status` – update status

---

## Database Schema

All entities are stored in MongoDB (database `CleaningStore`). Customers, admins, categories, products and orders each have their own collection.  

The JSON‑file storage used previously has been removed.
The structure of a customer object is:

```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "password": "<bcrypt hash>",
  "createdAt": "ISO timestamp"
}
```

---

## Running the Server

1. Install all dependencies:
   ```bash
   npm install
   ```
2. (Optional) set `JWT_SECRET` environment variable.
3. Start the server:
   ```bash
   npm start
   ```
4. MongoDB collections are created automatically when the server first writes data.

---

## Notes
- CORS enabled.
- `express.json()` used for JSON parsing.
- Errors propagate to global error handler.

---

This document may be converted to PDF via the provided npm script or external tools.