require("dotenv").config();
// Do not print secrets to logs in repository copies.
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();
const oddsService = require("./services/oddsService");

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "http://localhost:5500,http://127.0.0.1:5500";
// allow a small whitelist (comma-separated in env) to avoid CORS errors for localhost/127.0.0.1
const allowedOrigins = ALLOWED_ORIGIN.split(",").map((s) => s.trim());
app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (curl, mobile clients)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error("CORS not allowed"), false);
    },
  }),
);
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET || null;

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

// Basic rate limiting for auth endpoints to mitigate brute-force attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 12, // limit each IP to 12 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

async function getOrCreateCurrentSeason() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const name = `${yyyy}-${mm}`; // e.g. "2026-02"

  let season = await prisma.season.findFirst({ where: { name } });
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

  let season = await prisma.season.findFirst({ where: { name } });
  if (season) return season;

  const startAt = new Date(
    Date.UTC(nY, firstOfNextMonth.getUTCMonth(), 1, 0, 0, 0),
  );
  const endAt = new Date(
    Date.UTC(nY, firstOfNextMonth.getUTCMonth() + 1, 1, 0, 0, 0),
  );

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

    const STARTING_BANKROLL = 10000;

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
      },
      select: {
        id: true,
        username: true,
        createdAt: true,
      },
    });
    const token = signToken(user);
    return res.json({ user, token });
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

    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, passwordHash: true, createdAt: true },
    });

    if (!user) return res.status(401).json({ error: "invalid credentials" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const season = await getOrCreateCurrentSeason();

    const entry = await prisma.entry.findUnique({
      where: {
        userId_seasonId: { userId: user.id, seasonId: season.id },
      },
    });

    const token = signToken(user);

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        bankroll: entry ? entry.bankroll : null, // null = not joined
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ----------------------
// Place Bet endpoint
// ----------------------
// POST /bets
// body: { gameId, pick, stake, odds }
app.post("/bets", auth, async (req, res) => {
  try {
    const { gameId, pick, stake, odds, legs } = req.body || {};
    if (!Number.isFinite(Number(stake))) {
      return res.status(400).json({ error: "stake required" });
    }

    const season = await getOrCreateCurrentSeason();

    const entry = await prisma.entry.findUnique({
      where: {
        userId_seasonId: { userId: req.user.userId, seasonId: season.id },
      },
    });

    if (!entry)
      return res.status(403).json({ error: "Not joined for current season" });
    if (!entry.paid)
      return res.status(402).json({ error: "Payment required to place bets" });

    const s = Math.floor(Number(stake));
    if (s <= 0) return res.status(400).json({ error: "invalid stake" });
    if (entry.bankroll < s)
      return res.status(400).json({ error: "insufficient bankroll" });

    // Parlay support: client may send `legs` array
    if (Array.isArray(legs) && legs.length > 0) {
      for (const l of legs) {
        if (!l.gameId || !l.pick || !Number.isFinite(Number(l.odds)))
          return res.status(400).json({ error: "invalid legs" });
      }

      const games = await prisma.game.findMany({
        where: { id: { in: legs.map((x) => x.gameId) } },
      });
      if (games.length !== legs.length)
        return res.status(404).json({ error: "one or more games not found" });
      for (const g of games) {
        if (g.status === "final")
          return res
            .status(400)
            .json({ error: "one or more games already finished" });
        if (Date.now() >= new Date(g.startTime).getTime())
          return res
            .status(400)
            .json({ error: "one or more games already started" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const bet = await tx.bet.create({
          data: {
            entryId: entry.id,
            seasonId: season.id,
            gameId: legs[0].gameId,
            pick: JSON.stringify(legs),
            odds: 0,
            stake: s,
          },
        });

        const updatedEntry = await tx.entry.update({
          where: { id: entry.id },
          data: { bankroll: entry.bankroll - s },
        });

        return { bet, entry: updatedEntry };
      });

      return res.json(result);
    }

    // single-leg fallback
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return res.status(404).json({ error: "game not found" });
    if (game.status === "final")
      return res.status(400).json({ error: "game already finished" });

    const result = await prisma.$transaction(async (tx) => {
      const bet = await tx.bet.create({
        data: {
          entryId: entry.id,
          seasonId: season.id,
          gameId,
          pick,
          odds: Math.floor(Number(odds)),
          stake: s,
        },
      });

      const updatedEntry = await tx.entry.update({
        where: { id: entry.id },
        data: { bankroll: entry.bankroll - s },
      });

      return { bet, entry: updatedEntry };
    });

    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
});

// ----------------------
// Settlement logic
// ----------------------
function americanPayout(stake, odds) {
  const s = Number(stake) || 0;
  const o = Number(odds) || 0;
  let profit = 0;
  if (o > 0) profit = s * (o / 100);
  else if (o < 0) profit = s * (100 / Math.abs(o));
  const payout = Math.round(s + profit);
  return { profit: Math.round(profit), payout };
}

async function settleOpenBets() {
  // find open bets where the related game is final and has a winner
  const bets = await prisma.bet.findMany({
    where: { status: "open" },
    include: { game: true },
  });

  let updated = 0;

  for (const b of bets) {
    const g = b.game;
    if (!g || g.status !== "final" || !g.winner) continue;

    // Attempt to mark this bet as 'processing' atomically to avoid double-processing
    const txResult = await prisma.$transaction(async (tx) => {
      const lock = await tx.bet.updateMany({
        where: { id: b.id, status: "open" },
        data: { status: "processing" },
      });

      if (lock.count === 0) {
        // already processed by another worker/run
        return { skipped: true };
      }

      // re-read entry inside transaction to get latest bankroll
      const entry = await tx.entry.findUnique({ where: { id: b.entryId } });

      if (!entry) {
        // should not happen, but mark lost to avoid endless loop
        await tx.bet.update({
          where: { id: b.id },
          data: { status: "lost", payout: 0 },
        });
        return { skipped: false, changed: 1 };
      }

      // Check if this bet is a parlay (pick stored as JSON array)
      let legs = null;
      try {
        legs = JSON.parse(b.pick);
      } catch (e) {
        legs = null;
      }

      if (Array.isArray(legs) && legs.length > 0) {
        // For parlays, ensure all games are final and decide outcome
        const gameIds = legs.map((l) => l.gameId);
        const legGames = await tx.game.findMany({
          where: { id: { in: gameIds } },
        });

        // if any game missing, mark lost and continue
        if (legGames.length !== legs.length) {
          await tx.bet.update({
            where: { id: b.id },
            data: { status: "lost", payout: 0 },
          });
          return { skipped: false, changed: 1 };
        }

        // If any leg not yet final, revert status to open and skip processing
        for (const lg of legGames) {
          if (lg.status !== "final" || !lg.winner) {
            // revert
            await tx.bet.update({
              where: { id: b.id },
              data: { status: "open" },
            });
            return { skipped: true };
          }
        }

        // Now evaluate each leg
        for (const leg of legs) {
          const lg = legGames.find((x) => x.id === leg.gameId);
          if (!lg || lg.winner !== leg.pick) {
            // parlay lost
            await tx.bet.update({
              where: { id: b.id },
              data: { status: "lost", payout: 0 },
            });
            return { skipped: false, changed: 1 };
          }
        }

        // all legs won -> compute parlay payout (decimal product)
        let dec = 1;
        for (const leg of legs) {
          const o = Number(leg.odds) || 0;
          if (o > 0) dec *= 1 + o / 100;
          else if (o < 0) dec *= 1 + 100 / Math.abs(o);
        }
        const payout = Math.floor(b.stake * dec);

        await tx.bet.update({
          where: { id: b.id },
          data: { status: "won", payout },
        });
        await tx.entry.update({
          where: { id: entry.id },
          data: { bankroll: entry.bankroll + payout },
        });
        return { skipped: false, changed: 1 };
      }

      // single-leg resolution (legacy)
      if (b.pick === g.winner) {
        const { payout } = americanPayout(b.stake, b.odds);
        await tx.bet.update({
          where: { id: b.id },
          data: { status: "won", payout },
        });
        await tx.entry.update({
          where: { id: entry.id },
          data: { bankroll: entry.bankroll + payout },
        });
        return { skipped: false, changed: 1 };
      } else {
        await tx.bet.update({
          where: { id: b.id },
          data: { status: "lost", payout: 0 },
        });
        return { skipped: false, changed: 1 };
      }
    });

    if (txResult && txResult.changed) updated += txResult.changed;
  }

  return updated;
}

// admin settle endpoint (protected by ADMIN_SECRET header or env)
app.post("/admin/settle", async (req, res) => {
  try {
    const provided = req.headers["x-admin-secret"] || null;
    if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
      return res.status(403).json({ error: "admin secret required" });
    }

    const changed = await settleOpenBets();
    res.json({ changed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ----------------------
// Games endpoints (dev helpers)
// ----------------------
// GET /games - returns upcoming games
app.get("/games", async (req, res) => {
  try {
    const games = await prisma.game.findMany({
      where: { status: { not: "final" } },
      orderBy: { startTime: "asc" },
    });
    // adapt to frontend-friendly shape
    const out = games.map((g) => ({
      id: g.id,
      league: g.league,
      startISO: g.startTime.toISOString(),
      home: g.homeTeam,
      away: g.awayTeam,
      homeOdds: g.homeOdds || -110,
      awayOdds: g.awayOdds || +100,
      status: g.status,
      winner: g.winner,
    }));
    res.json({ games: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// POST /admin/seed-games - insert a few dev games
app.post("/admin/seed-games", async (req, res) => {
  try {
    const provided = req.headers["x-admin-secret"] || null;
    if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
      return res.status(403).json({ error: "admin secret required" });
    }

    const now = Date.now();
    const samples = [
      {
        league: "NBA",
        homeTeam: "Lakers",
        awayTeam: "Warriors",
        startTime: new Date(now + 1000 * 60 * 60 * 4),
      },
      {
        league: "NBA",
        homeTeam: "Celtics",
        awayTeam: "Bucks",
        startTime: new Date(now + 1000 * 60 * 60 * 9),
      },
      {
        league: "NHL",
        homeTeam: "Maple Leafs",
        awayTeam: "Canadiens",
        startTime: new Date(now + 1000 * 60 * 60 * 3),
      },
    ];

    const created = [];
    for (const s of samples) {
      const g = await prisma.game.create({
        data: {
          league: s.league,
          homeTeam: s.homeTeam,
          awayTeam: s.awayTeam,
          startTime: s.startTime,
        },
      });
      created.push(g);
    }

    res.json({ created });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Admin: fetch latest odds from provider and update games
app.get("/admin/fetch-odds", async (req, res) => {
  try {
    const provided = req.headers["x-admin-secret"] || null;
    if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
      return res.status(403).json({ error: "admin secret required" });
    }

    const updated = await oddsService.fetchAndUpdateOdds(prisma);
    res.json({ updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to fetch odds" });
  }
});

// schedule odds refresh every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    const n = await oddsService.fetchAndUpdateOdds(prisma);
    if (n > 0) console.log(`Auto-odds updated ${n} games`);
  } catch (e) {
    console.error("Auto-odds error:", e);
  }
});

// schedule settlement every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  try {
    const n = await settleOpenBets();
    if (n > 0) console.log(`Auto-settle processed ${n} bets`);
  } catch (e) {
    console.error("Auto-settle error:", e);
  }
});

app.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { id: true, username: true, createdAt: true },
  });

  const season = await getOrCreateCurrentSeason();
  const entry = await prisma.entry.findUnique({
    where: {
      userId_seasonId: { userId: req.user.userId, seasonId: season.id },
    },
  });

  res.json({
    user: {
      ...user,
      bankroll: entry ? entry.bankroll : null,
    },
  });
});

// ----------------------
// Bets feed endpoints
// ----------------------
// GET /bets/open - open bets for current season
app.get("/bets/open", async (req, res) => {
  try {
    const season = await getOrCreateCurrentSeason();
    const bets = await prisma.bet.findMany({
      where: { seasonId: season.id, status: "open" },
      include: {
        game: true,
        entry: { include: { user: { select: { id: true, username: true } } } },
      },
      orderBy: { placedAt: "desc" },
    });

    const out = bets.map((b) => ({
      id: b.id,
      gameId: b.gameId,
      pick: b.pick,
      odds: b.odds,
      stake: b.stake,
      status: b.status,
      placedAt: b.placedAt,
      username: b.entry?.user?.username || null,
      game: b.game
        ? {
            id: b.game.id,
            league: b.game.league,
            home: b.game.homeTeam,
            away: b.game.awayTeam,
            startISO: b.game.startTime.toISOString(),
          }
        : null,
    }));

    res.json({ bets: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// GET /bets/history - settled bets for current season
app.get("/bets/history", async (req, res) => {
  try {
    const season = await getOrCreateCurrentSeason();
    const bets = await prisma.bet.findMany({
      where: { seasonId: season.id, status: { not: "open" } },
      include: {
        game: true,
        entry: { include: { user: { select: { id: true, username: true } } } },
      },
      orderBy: { placedAt: "desc" },
    });

    const out = bets.map((b) => ({
      id: b.id,
      gameId: b.gameId,
      pick: b.pick,
      odds: b.odds,
      stake: b.stake,
      status: b.status,
      payout: b.payout,
      placedAt: b.placedAt,
      username: b.entry?.user?.username || null,
      game: b.game
        ? {
            id: b.game.id,
            league: b.game.league,
            home: b.game.homeTeam,
            away: b.game.awayTeam,
            startISO: b.game.startTime.toISOString(),
          }
        : null,
    }));

    res.json({ bets: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
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

    const strict =
      (process.env.STRICT_CUTOFF || "false").toLowerCase() === "true";
    console.log(
      "STRICT_CUTOFF raw:",
      process.env.STRICT_CUTOFF,
      "-> strict:",
      strict,
    );

    if (strict && new Date() >= season.startAt) {
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

    return res.json({ entry, season });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
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
