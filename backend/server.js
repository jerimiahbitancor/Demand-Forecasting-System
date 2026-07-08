// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Express API' });
});



app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});