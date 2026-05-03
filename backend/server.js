require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const userRoutes = require('./src/routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: '*',
  })
);
app.use(express.json({ limit: '25mb' }));

app.get('/', (_req, res) => {
  res.json({ message: 'Backend is running' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'backend', port: PORT });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
