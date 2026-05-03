require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

async function seedAdmin() {
  const fullName = process.env.ADMIN_NAME || 'Main Admin';
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Missing ADMIN_EMAIL or ADMIN_PASSWORD in environment.');
    process.exit(1);
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE users
         SET full_name = ?, password_hash = ?, role = 'admin', is_active = 1
         WHERE email = ?`,
        [fullName, passwordHash, email]
      );
      console.log('Admin user updated successfully.');
    } else {
      await db.query(
        `INSERT INTO users (full_name, email, password_hash, role, is_active)
         VALUES (?, ?, ?, 'admin', 1)`,
        [fullName, email, passwordHash]
      );
      console.log('Admin user created successfully.');
    }
  } catch (error) {
    console.error('Failed to seed admin:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

seedAdmin();
