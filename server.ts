// server.ts
import express from "express";
import generateRSS from './src/generate-rss';

const app = express();

app.get('/api/generate-rss', (req, res) => generateRSS(req, res));

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
