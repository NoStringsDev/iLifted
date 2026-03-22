import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import compareHandler from "./api/compare.js";
import imageHandler from "./api/image.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Manually register Vercel API routes for local development
  app.post("/api/compare", async (req, res) => {
    try {
      await compareHandler(req as any, res as any);
    } catch (err) {
      console.error("Local API Error (Compare):", err);
      res.status(500).json({ error: "Local API Error" });
    }
  });

  app.post("/api/image", async (req, res) => {
    try {
      await imageHandler(req as any, res as any);
    } catch (err) {
      console.error("Local API Error (Image):", err);
      res.status(500).json({ error: "Local API Error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Development server running on http://localhost:${PORT}`);
  });
}

startServer();
