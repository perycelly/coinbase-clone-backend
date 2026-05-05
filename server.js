import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();
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
return null;
}
return admin.initializeApp({
credential: admin.credential.cert({
projectId: process.env.FIREBASE_PROJECT_ID,
clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\n/g, "\n"),
}),
projectId: process.env.FIREBASE_PROJECT_ID,
});
} catch (err) {
return null;
}
};
const adminApp = createFirebaseAdminApp();
const db = adminApp ? getFirestore(adminApp, process.env.FIREBASE_FIRESTORE_DATABASE_ID || "(default)") : null;
async function startServer() {
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(cookieParser());
app.use(
cors({
origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
credentials: true,
})
);
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
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.post("/api/register", async (req, res) => {
if (!db) return res.status(500).json({ error: "Database not initialized" });
const { name, email, password } = req.body;
try {
const userRef = db.collection("users").doc(email);
const userDoc = await userRef.get();
if (userDoc.exists) return res.status(400).json({ error: "User already exists" });
const hashedPassword = await bcrypt.hash(password, 10);
await userRef.set({ name, email, password: hashedPassword, createdAt: new Date().toISOString() });
res.status(201).json({ message: "User registered successfully" });
} catch (err) {
res.status(500).json({ error: err.message });
}
});
app.post("/api/login", async (req, res) => {
if (!db) return res.status(500).json({ error: "Database not initialized" });
const { email, password } = req.body;
try {
const userRef = db.collection("users").doc(email);
const userDoc = await userRef.get();
if (!userDoc.exists) return res.status(400).json({ error: "User not found" });
const user = userDoc.data();
const isMatch = await bcrypt.compare(password, user.password);
if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });
const token = jwt.sign({ email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "1h" });
res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "none" });
res.json({ message: "Login successful", user: { name: user.name, email: user.email } });
} catch (err) {
res.status(500).json({ error: err.message });
}
});
app.post("/api/logout", (req, res) => {
res.clearCookie("token");
res.json({ message: "Logged out" });
});
app.get("/api/crypto", async (req, res) => {
if (!db) return res.status(500).json({ error: "Database not initialized" });
try {
const snapshot = await db.collection("cryptos").get();
const cryptos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
res.json(cryptos);
} catch (err) {
res.status(500).json({ error: err.message });
}
});
const seedCryptos = async () => {
if (!db) return;
try {
const snapshot = await db.collection("cryptos").limit(1).get();
if (snapshot.empty) {
const initial = [
{ name: "Bitcoin", symbol: "BTC", price: 65000, image: "cryptologos.cc", change24h: "+2.4", createdAt: new Date().toISOString() },
{ name: "Ethereum", symbol: "ETH", price: 3500, image: "cryptologos.cc", change24h: "+1.2", createdAt: new Date().toISOString() }
];
for (const c of initial) { await db.collection("cryptos").add(c); }
}
} catch (err) {}
};
app.listen(PORT, () => {
seedCryptos();
});
}
startServer();

