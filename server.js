require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

app.use(
  cors({
    origin: "*", // for dev; later restrict to your frontend domain
  }),
);
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

// --- helpers ---
function signToken(user) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function getOrCreateCurrentSeason() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const name = `${yyyy}-${mm}`; // e.g. "2026-02"

  let season = await prisma.season.findUnique({ where: { name } });
  if (season) return season;

  const startAt = new Date(Date.UTC(yyyy, now.getUTCMonth(), 1, 0, 0, 0));
  const endAt = new Date(Date.UTC(yyyy, now.getUTCMonth() + 1, 1, 0, 0, 0));

  season = await prisma.season.create({
    data: { name, startAt, endAt, status: "active" },
  });

  return season;
}

async function getOrCreateNextSeason() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const m0 = now.getUTCMonth(); // 0-based
  const firstOfNextMonth = new Date(Date.UTC(yyyy, m0 + 1, 1, 0, 0, 0));

  const nY = firstOfNextMonth.getUTCFullYear();
  const nM = String(firstOfNextMonth.getUTCMonth() + 1).padStart(2, "0");
  const name = `${nY}-${nM}`; // e.g. "2026-03"

  let season = await prisma.season.findUnique({ where: { name } });
  if (season) return season;

  const startAt = new Date(Date.UTC(nY, firstOfNextMonth.getUTCMonth(), 1, 0, 0, 0));
  const endAt = new Date(Date.UTC(nY, firstOfNextMonth.getUTCMonth() + 1, 1, 0, 0, 0));

  season = await prisma.season.create({
    data: { name, startAt, endAt, status: "upcoming" },
  });

  return season;
}

// --- routes ---
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running" });
});

app.post("/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "password must be at least 8 characters" });
    }

    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists)
      return res.status(409).json({ error: "username already exists" });

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { username, passwordHash, bankroll: 100000 },
      select: { id: true, username: true, bankroll: true, createdAt: true },
    });

    const token = signToken(user);
    res.json({ user, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ error: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const token = signToken(user);
    res.json({
      user: {
        id: user.id,
        username: user.username,
        bankroll: user.bankroll,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, username: true, bankroll: true, createdAt: true },
  });
  res.json({ user });
});

// --- season routes ---

// Public: current month season (active)
app.get("/season/current", async (req, res) => {
  try {
    const season = await getOrCreateCurrentSeason();
    res.json({ season });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Public: next month season (upcoming)
app.get("/season/next", async (req, res) => {
  try {
    const season = await getOrCreateNextSeason();
    res.json({ season });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Logged-in: join NEXT month tournament (strict cutoff model)
app.post("/season/join-next", auth, async (req, res) => {
  try {
    const season = await getOrCreateNextSeason();

    const existing = await prisma.entry.findUnique({
      where: {
        userId_seasonId: { userId: req.user.userId, seasonId: season.id },
      },
    });

    if (existing) return res.json({ entry: existing, season });

    const entry = await prisma.entry.create({
      data: {
        userId: req.user.userId,
        seasonId: season.id,
        bankroll: 100000,
        paid: false,
      },
    });

    res.json({ entry, season });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Optional: joining CURRENT month is blocked once it starts (strict cutoff)
app.post("/season/join", auth, async (req, res) => {
  try {
    const season = await getOrCreateCurrentSeason();
    //Restricting condition that prohibits entering the season after the strict cutoff.
if (new Date() >= season.startAt) {
  return res.status(403).json({
    error: "Tournament already started. Join next month instead.",
  });
}
    if (new Date() >= season.startAt) {
      return res.status(403).json({
        error: "Tournament already started. Join next month instead.",
      });
    }

    const existing = await prisma.entry.findUnique({
      where: {
        userId_seasonId: { userId: req.user.userId, seasonId: season.id },
      },
    });

    if (existing) return res.json({ entry: existing, season });

    const entry = await prisma.entry.create({
      data: {
        userId: req.user.userId,
        seasonId: season.id,
        bankroll: 100000,
        paid: false,
      },
    });

    res.json({ entry, season });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Logged-in: get my entry for CURRENT season (used to show bankroll during play)
app.get("/me/entry", auth, async (req, res) => {
  try {
    const season = await getOrCreateCurrentSeason();

    const entry = await prisma.entry.findUnique({
      where: {
        userId_seasonId: { userId: req.user.userId, seasonId: season.id },
      },
    });

    res.json({ season, entry });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
