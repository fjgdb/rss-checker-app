// server.ts
import path from 'path';
import express from "express";
import generateRSS from './src/generate-rss';

const app = express();

// public フォルダを静的ファイルとして提供
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/generate-rss', (req, res) => {
  generateRSS(req, res).catch((err) => {
    console.error("Unhandled error in generateRSS:", err);
    res.status(500).json({ error: "Internal Server Error" });
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
