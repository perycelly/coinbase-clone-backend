import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..", "frontend");

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev";

const createFirebaseAdminApp = () => {
  if (admin.apps.length) {
    return admin.app();
  }

  try {
    const requiredEnv = [
      "FIREBASE_PROJECT_ID",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_PRIVATE_KEY",
    ];
    const missing = requiredEnv.filter((name) => !process.env[name]);
    if (missing.length) {
      throw new Error(`Missing Firebase env vars: ${missing.join(", ")}`);
    }

    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  } catch (err) {
    console.error("Firebase Admin initialization failed.");
    console.error("Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env.");
    throw err;
  }
};

const adminApp = createFirebaseAdminApp();
const db = getFirestore(adminApp, process.env.FIREBASE_FIRESTORE_DATABASE_ID || "(default)");

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  const authenticateToken = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Access denied. Please login." });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(403).json({ error: "Invalid token" });
    }
  };

  app.post("/api/register", async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const userRef = db.collection("users").doc(email);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        return res.status(400).json({ error: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await userRef.set({
        name,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    try {
      const userRef = db.collection("users").doc(email);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        return res.status(400).json({ error: "User not found" });
      }

      const user = userDoc.data();
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "1h" });
      res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "none" });
      res.json({ message: "Login successful", user: { name: user.name, email: user.email } });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ message: "Logged out" });
  });

  app.get("/api/profile", authenticateToken, async (req, res) => {
    try {
      const userRef = db.collection("users").doc(req.user.email);
      const userDoc = await userRef.get();
      if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

      const userInfo = userDoc.data();
      delete userInfo.password;
      res.json(userInfo);
    } catch (err) {
      console.error("Profile error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crypto", async (req, res) => {
    try {
      const snapshot = await db.collection("cryptos").get();
      const cryptos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.json(cryptos);
    } catch (err) {
      console.error("Crypto list error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crypto", async (req, res) => {
    const { name, symbol, price, image, change24h } = req.body;

    if (!name || !symbol || !price || !image || !change24h) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedPrice = Number(price);
    if (Number.isNaN(parsedPrice)) {
      return res.status(400).json({ error: "Price must be a valid number" });
    }

    try {
      const payload = {
        name: String(name).trim(),
        symbol: String(symbol).trim().toUpperCase(),
        price: parsedPrice,
        image: String(image).trim(),
        change24h: String(change24h).trim(),
        createdAt: new Date().toISOString(),
      };

      const docRef = await db.collection("cryptos").add(payload);
      res.status(201).json({ id: docRef.id, ...payload });
    } catch (err) {
      console.error("Create crypto error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crypto/gainers", async (req, res) => {
    try {
      const snapshot = await db.collection("cryptos").get();
      const cryptos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const gainers = cryptos
        .sort((a, b) => parseFloat(b.change24h) - parseFloat(a.change24h))
        .slice(0, 10);
      res.json(gainers);
    } catch (err) {
      console.error("Gainers error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crypto/new", async (req, res) => {
    try {
      const snapshot = await db.collection("cryptos").orderBy("createdAt", "desc").limit(10).get();
      const cryptos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      res.json(cryptos);
    } catch (err) {
      console.error("New listings error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Frontend serving is disabled so this backend runs API-only.
  // if (process.env.NODE_ENV !== "production") {
  //   const vite = await createViteServer({
  //     root: frontendRoot,
  //     server: { middlewareMode: true },
  //     appType: "spa",
  //   });
  //   app.use(vite.middlewares);
  // } else {
  //   const distPath = path.join(frontendRoot, "dist");
  //   app.use(express.static(distPath));
  //   app.get("*", (req, res) => {
  //     res.sendFile(path.join(distPath, "index.html"));
  //   });
  // }

  const seedCryptos = async () => {
    console.log("Checking for initial crypto data...");
    const snapshot = await db.collection("cryptos").limit(1).get();
    if (snapshot.empty) {
      console.log("Seeding initial crypto data...");
      const initialCryptos = [
        { name: "Bitcoin", symbol: "BTC", price: 65432.10, image: "https://cryptologos.cc/logos/bitcoin-btc-logo.png", change24h: "+2.4", createdAt: new Date().toISOString() },
        { name: "Ethereum", symbol: "ETH", price: 3456.78, image: "https://cryptologos.cc/logos/ethereum-eth-logo.png", change24h: "-1.2", createdAt: new Date().toISOString() },
        { name: "Solana", symbol: "SOL", price: 145.20, image: "https://cryptologos.cc/logos/solana-sol-logo.png", change24h: "+5.6", createdAt: new Date().toISOString() },
        { name: "Cardano", symbol: "ADA", price: 0.45, image: "https://cryptologos.cc/logos/cardano-ada-logo.png", change24h: "+0.8", createdAt: new Date().toISOString() },
      ];
      for (const crypto of initialCryptos) {
        await db.collection("cryptos").add(crypto);
      }
      console.log("Seeding complete.");
    } else {
      console.log("Crypto data already exists.");
    }
  };

  try {
    await seedCryptos();
  } catch (err) {
    const message = err?.message || "Unknown seeding error";
    if (message.includes("credential") || message.includes("private key") || message.includes("auth")) {
      console.error("Failed to seed crypto data because Firebase credentials could not be loaded.");
      console.error("Verify FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, and FIREBASE_FIRESTORE_DATABASE_ID.");
    }
    console.error("Failed to seed cryptos:", err);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
