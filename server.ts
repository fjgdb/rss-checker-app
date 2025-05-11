// server.ts
import express from "express";
import generateRSS from "./pages/api/generate-rss";

const app = express();
const port = process.env.PORT || 3000;

app.get("/api/generate-rss", generateRSS);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
