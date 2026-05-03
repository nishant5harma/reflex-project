const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

app.get('/', (_req, res) => {
  res.json({ message: 'Backend is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port `);
});
