const DEFAULT_PROVIDER =
  process.env.ODDS_PROVIDER_URL || "https://api.the-odds-api.com/v4";
const API_KEY = process.env.ODDS_API_KEY || null;

// map our league keys to provider sport keys (the-odds-api v4)
const SPORT_MAP = {
  NBA: "basketball_nba",
  NFL: "americanfootball_nfl",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
};

let lastFetchedAt = 0;
let cacheTtlMs = 60 * 1000; // 1 minute simple cache to avoid duplicate calls

async function fetchJson(url) {
  const f = global.fetch || (await import("node-fetch")).default;
  const res = await f(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamMatches(local, remote) {
  if (!local || !remote) return false;
  const L = normalizeTeamName(local);
  const R = normalizeTeamName(remote);
  return (
    L.includes(R) ||
    R.includes(L) ||
    L.split(" ").slice(0, 2).join(" ") === R.split(" ").slice(0, 2).join(" ")
  );
}

async function fetchOddsForSport(sportKey) {
  if (!API_KEY) throw new Error("ODDS_API_KEY not set");
  const url = `${DEFAULT_PROVIDER}/sports/${sportKey}/odds/?regions=us&markets=moneyline&oddsFormat=american&dateFormat=iso&apiKey=${API_KEY}`;
  return fetchJson(url);
}

// Main: fetch odds for supported leagues and update Game rows when matched
async function fetchAndUpdateOdds(prisma) {
  const now = Date.now();
  if (now - lastFetchedAt < cacheTtlMs) return 0;
  lastFetchedAt = now;

  const MOCK = (process.env.MOCK_ODDS || "false").toLowerCase() === "true";

  // load upcoming games (all non-final) — used by mock mode and by provider matching
  const gamesAll = await prisma.game.findMany({
    where: { status: { not: "final" } },
  });

  // If MOCK_ODDS is set, generate deterministic mock odds for local testing
  if (MOCK) {
    console.log("MOCK_ODDS enabled — generating mock odds");
    let updated = 0;
    for (const g of gamesAll) {
      // skip finals
      if (g.status === "final") continue;
      // create reproducible pseudo-random odds based on game id
      const seed = Array.from(String(g.id)).reduce(
        (s, ch) => s + ch.charCodeAt(0),
        0,
      );
      // generate odds between -200 and +300
      const homeOdds = ((seed * 37) % 501) - 200; // -200..+300
      let awayOdds = Math.round(
        homeOdds > 0
          ? -Math.max(100, Math.abs(homeOdds) - 20)
          : Math.max(100, Math.abs(homeOdds) - 20),
      );
      if (awayOdds === homeOdds)
        awayOdds =
          homeOdds > 0 ? -Math.abs(homeOdds) - 10 : Math.abs(homeOdds) + 10;
      try {
        await prisma.game.update({
          where: { id: g.id },
          data: { homeOdds, awayOdds, oddsUpdatedAt: new Date() },
        });
        updated++;
      } catch (e) {
        console.warn("Mock odds update failed for", g.id, e.message || e);
      }
    }
    return updated;
  }

  const supported = Object.keys(SPORT_MAP);
  // load upcoming games in DB for supported leagues only
  const games = gamesAll.filter((x) => supported.includes(x.league));

  let updated = 0;

  for (const [league, sportKey] of Object.entries(SPORT_MAP)) {
    try {
      const events = await fetchOddsForSport(sportKey);
      if (!Array.isArray(events)) continue;

      for (const ev of events) {
        const commence = ev.commence_time || ev.commenceTime || ev.commence; // provider variations
        const home = ev.home_team || ev.homeTeam || ev.home;
        const away = ev.away_team || ev.awayTeam || ev.away;

        // find matching local game
        const candidate = games.find((g) => {
          if (g.league !== league) return false;
          // match by rough team match
          if (!teamMatches(g.homeTeam, home) || !teamMatches(g.awayTeam, away))
            return false;
          // optional: check start time proximity (within 4 hours)
          if (commence) {
            const remoteT = new Date(commence).getTime();
            const localT = new Date(g.startTime).getTime();
            if (Math.abs(remoteT - localT) > 1000 * 60 * 60 * 4) return false;
          }
          return true;
        });

        if (!candidate) continue;

        // extract moneyline odds
        let homeOdds = null;
        let awayOdds = null;
        const markets = ev.markets || ev.bookmakers || ev.markets || [];

        // TheOddsAPI v4 returns bookmakers[].markets[].outcomes OR markets[].outcomes
        if (ev.bookmakers && Array.isArray(ev.bookmakers)) {
          // try to get the first bookmaker with moneyline market
          for (const bm of ev.bookmakers) {
            const m = (bm.markets || []).find(
              (x) => x.key === "moneyline" || x.key === "h2h",
            );
            if (m && m.outcomes) {
              for (const o of m.outcomes) {
                if (teamMatches(candidate.homeTeam, o.name)) homeOdds = o.price;
                if (teamMatches(candidate.awayTeam, o.name)) awayOdds = o.price;
              }
              if (homeOdds !== null && awayOdds !== null) break;
            }
          }
        } else if (ev.markets && Array.isArray(ev.markets)) {
          const m = ev.markets.find(
            (x) => x.key === "moneyline" || x.key === "h2h",
          );
          if (m && m.outcomes) {
            for (const o of m.outcomes) {
              if (teamMatches(candidate.homeTeam, o.name)) homeOdds = o.price;
              if (teamMatches(candidate.awayTeam, o.name)) awayOdds = o.price;
            }
          }
        }

        // if we found odds, update the DB
        if (homeOdds !== null && awayOdds !== null) {
          // coerce to integers (american)
          const h = Math.round(Number(homeOdds));
          const a = Math.round(Number(awayOdds));
          try {
            await prisma.game.update({
              where: { id: candidate.id },
              data: { homeOdds: h, awayOdds: a, oddsUpdatedAt: new Date() },
            });
            updated++;
          } catch (e) {
            // ignore update errors per-game
            console.warn(
              "Odds update failed for",
              candidate.id,
              e.message || e,
            );
          }
        }
      }
    } catch (e) {
      console.warn(
        `Failed to fetch odds for ${league}/${sportKey}:`,
        e.message || e,
      );
    }
  }

  return updated;
}

module.exports = { fetchAndUpdateOdds };
