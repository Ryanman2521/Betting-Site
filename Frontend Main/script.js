//API Helpers
const API_BASE = "http://127.0.0.1:3001";
let token = localStorage.getItem("token") || null;

async function apiRegister(username, password) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "register failed");
  token = data.token;
  localStorage.setItem("token", token);
  await ensureCurrentEntryLoaded();
  return data.user;
}

async function apiLogin(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "login failed");
  token = data.token;
  localStorage.setItem("token", token);
  await ensureCurrentEntryLoaded();
  return data.user;
}

async function apiMe() {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "not logged in");
  return data.user;
}

async function apiMeEntry() {
  const res = await fetch(`${API_BASE}/me/entry`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "me/entry failed");
  return data; // { season, entry }
}

async function apiJoinCurrentSeason() {
  const res = await fetch(`${API_BASE}/season/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "join failed");
  return data; // { entry, season }
}

async function ensureCurrentEntryLoaded() {
  const me1 = await apiMeEntry();
  if (!me1.entry) {
    await apiJoinCurrentSeason();
  }
  const me2 = await apiMeEntry();
  currentEntry = me2.entry;
  renderAuthBar();
}

async function apiGetCurrentSeason() {
  const res = await fetch(`${API_BASE}/season/current`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "season error");
  return data.season;
}

async function apiGetGames() {
  const res = await fetch(`${API_BASE}/games`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "failed to load games");
  return data.games;
}

async function apiGetBetsOpen() {
  const res = await fetch(`${API_BASE}/bets/open`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "failed to load bets");
  return data.bets;
}

async function apiGetBetsHistory() {
  const res = await fetch(`${API_BASE}/bets/history`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "failed to load bets");
  return data.bets;
}

async function apiJoinSeason() {
  const res = await fetch(`${API_BASE}/season/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "join failed");
  return data.entry;
}

async function apiGetMyEntry() {
  const res = await fetch(`${API_BASE}/me/entry`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "entry fetch failed");
  return data.entry;
}

async function apiGetNextSeason() {
  const res = await fetch(`${API_BASE}/season/next`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "next season error");
  return data.season;
}

async function apiJoinNextSeason() {
  const res = await fetch(`${API_BASE}/season/join-next`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "join-next failed");
  return data.entry;
}

//API STUFF ENDS
// SESSION / CURRENT USER (Backend-auth based)
let currentUser = null;
let currentEntry = null;
let nextEntry = null;
let nextSeason = null;

async function refreshSessionUI() {
  try {
    if (!token) throw new Error("No token");

    currentUser = await apiMe();

    // strict cutoff: signup is for NEXT season
    nextSeason = await apiGetNextSeason();
    // we don't have a "me/entry-next" endpoint yet, so just set null for now
    nextEntry = null;

    showPanel("board");
  } catch {
    currentUser = null;
    nextSeason = null;
    nextEntry = null;
    showPanel("auth");
  }

  renderAuthBar();
  renderBoard();
  renderSlip();
}
/* ===========================
   Playbook Prototype (Frontend)
   - localStorage "DB"
   - Moneyline only
   - Single-leg betslip
=========================== */

const STARTING_BANKROLL = 10000;
const DAILY_WAGER_MAX = 2000;

const LS_KEYS = {
  BETS: "pb_bets",
  DAILY_WAGER: "pb_daily_wager",
};

const LEAGUES = [
  { key: "NBA", name: "NBA", countTag: "Basketball" },
  { key: "NHL", name: "NHL", countTag: "Hockey" },
  { key: "NFL", name: "NFL", countTag: "Football" },
  { key: "MLB", name: "MLB", countTag: "Baseball" },
  { key: "OLY", name: "Olympics", countTag: "Global" },
];

// Games are loaded from the backend via GET /games
let GAMES = [];

/* ========== DOM ========== */
const el = {
  authBar: document.getElementById("authBar"),
  authPanel: document.getElementById("authPanel"),
  boardPanel: document.getElementById("boardPanel"),
  betsPanel: document.getElementById("betsPanel"),
  leaderPanel: document.getElementById("leaderPanel"),
  notice: document.getElementById("notice"),

  regUsername: document.getElementById("regUsername"),
  regPassword: document.getElementById("regPassword"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  btnRegister: document.getElementById("btnRegister"),
  btnLogin: document.getElementById("btnLogin"),

  leagueList: document.getElementById("leagueList"),
  boardTitle: document.getElementById("boardTitle"),
  gamesList: document.getElementById("gamesList"),
  bankrollValue: document.getElementById("bankrollValue"),

  btnMyBets: document.getElementById("btnMyBets"),
  btnLeaderboard: document.getElementById("btnLeaderboard"),
  btnClearAll: document.getElementById("btnClearAll"),

  btnBackToBoard1: document.getElementById("btnBackToBoard1"),
  btnBackToBoard2: document.getElementById("btnBackToBoard2"),

  searchInput: document.getElementById("searchInput"),

  slipItems: document.getElementById("slipItems"),
  betslipSub: document.getElementById("betslipSub"),
  btnClearSlip: document.getElementById("btnClearSlip"),
  stakeInput: document.getElementById("stakeInput"),
  potentialProfit: document.getElementById("potentialProfit"),
  potentialPayout: document.getElementById("potentialPayout"),
  btnPlaceBet: document.getElementById("btnPlaceBet"),

  betsTbody: document.getElementById("betsTbody"),
  leaderTbody: document.getElementById("leaderTbody"),

  brandHome: document.getElementById("brandHome"),
};

/* ========== App State ========== */
let activeLeague = "NBA";
let slip = []; // array of legs: [{ gameId, league, home, away, pickSide, pickTeam, odds, startISO, placedOddsAt }]
let searchTerm = "";
/* ========== Init ========== */
boot();

async function boot() {
  ensureStorageInitialized();
  renderLeagueList();
  bindEvents();
  try {
    const remote = await apiGetGames();
    GAMES = remote.map((g) => ({
      id: g.id,
      league: g.league,
      startISO: g.startISO,
      home: g.home,
      away: g.away,
      status: g.status,
      winner: g.winner,
      // default odds until a proper feed is available
      homeOdds: g.homeOdds || -110,
      awayOdds: g.awayOdds || +100,
    }));
  } catch (err) {
    console.warn(
      "Failed to load games from API, falling back to empty list",
      err,
    );
    GAMES = [];
  }
  await refreshSessionUI();
}

/* ========== Storage ========== */
function ensureStorageInitialized() {
  if (!localStorage.getItem(LS_KEYS.BETS))
    localStorage.setItem(LS_KEYS.BETS, JSON.stringify([]));
}

function loadBets() {
  return JSON.parse(localStorage.getItem(LS_KEYS.BETS) || "[]");
}

function saveBets(bets) {
  localStorage.setItem(LS_KEYS.BETS, JSON.stringify(bets));
}

function todayKey() {
  // Local day on the user's machine (good enough for V1)
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function loadDailyWager() {
  return JSON.parse(localStorage.getItem(LS_KEYS.DAILY_WAGER) || "{}");
}

function saveDailyWager(obj) {
  localStorage.setItem(LS_KEYS.DAILY_WAGER, JSON.stringify(obj));
}

function getDailyWagerUsed(username) {
  const daily = loadDailyWager();
  const key = `${username}:${todayKey()}`;
  return Number(daily[key] || 0);
}

function addDailyWagerUsed(username, amount) {
  const daily = loadDailyWager();
  const key = `${username}:${todayKey()}`;
  daily[key] = round2(Number(daily[key] || 0) + Number(amount || 0));
  saveDailyWager(daily);
}

function getDailyWagerRemaining(username) {
  return round2(Math.max(0, DAILY_WAGER_MAX - getDailyWagerUsed(username)));
}

/* ========== Events ========== */
function bindEvents() {
  el.brandHome.addEventListener("click", () => showPanel("board"));

  el.btnRegister.addEventListener("click", onRegister);
  el.btnLogin.addEventListener("click", onLogin);

  el.btnMyBets.addEventListener("click", () => showPanel("bets"));
  el.btnLeaderboard.addEventListener("click", () => showPanel("leader"));
  el.btnClearAll.addEventListener("click", onResetPrototype);

  el.btnBackToBoard1.addEventListener("click", () => showPanel("board"));
  el.btnBackToBoard2.addEventListener("click", () => showPanel("board"));

  el.btnClearSlip.addEventListener("click", () => {
    slip = null;
    el.stakeInput.value = "";
    renderSlip();
    renderBoard(); // remove odds active highlight
  });

  el.stakeInput.addEventListener("input", () => renderSlipTotals());
  el.btnPlaceBet.addEventListener("click", onPlaceBet);

  el.searchInput.addEventListener("input", (e) => {
    searchTerm = (e.target.value || "").trim().toLowerCase();
    renderBoard();
  });
}

/* ========== Auth ========== */
async function onRegister() {
  const username = (el.regUsername.value || "").trim();
  const password = (el.regPassword.value || "").trim();

  if (!username || !password)
    return toast("Enter a username and password.", "warn");

  try {
    const user = await apiRegister(username, password);

    el.regUsername.value = "";
    el.regPassword.value = "";

    toast(`Account created: @${user.username}`, "ok");

    await refreshSessionUI(); // NEW (we add this below)
  } catch (err) {
    toast(err.message || "Register failed.", "warn");
  }
}

async function onLogin() {
  const username = (el.loginUsername.value || "").trim();
  const password = (el.loginPassword.value || "").trim();

  if (!username || !password)
    return toast("Enter your username and password.", "warn");

  try {
    const user = await apiLogin(username, password);

    el.loginUsername.value = "";
    el.loginPassword.value = "";

    toast(`Welcome back, @${user.username}.`, "ok");

    await refreshSessionUI();
  } catch (err) {
    toast(err.message || "Login failed.", "warn");
  }
}

function logout() {
  localStorage.removeItem("token");
  token = null;

  slip = [];
  el.stakeInput.value = "";
  toast("Logged out.", "ok");

  refreshSessionUI();
}

function renderAuthBar() {
  const user = currentUser;
  el.authBar.innerHTML = "";

  if (!user) {
    const b1 = mkBtn("ghostBtn", "Log in", () => showPanel("auth"));
    const b2 = mkBtn("primaryBtn", "Create account", () => showPanel("auth"));
    el.authBar.append(b1, b2);
    return;
  }

  const chip = document.createElement("div");
  chip.className = "pill";
  chip.textContent = `@${user.username}`;

  const bank = document.createElement("div");
  bank.className = "pill";
  bank.textContent = currentEntry
    ? `Bankroll: ${fmtMoney(currentEntry.bankroll)}`
    : `Not joined`;

  const daily = document.createElement("div");
  daily.className = "pill";
  daily.textContent = currentEntry
    ? `Daily remaining: ${fmtMoney(getDailyWagerRemaining(user.username))}`
    : `Join to play`;

  el.authBar.append(chip, bank, daily);

  const joinNextBtn = mkBtn("primaryBtn", "Join Next Month ($10)", async () => {
    try {
      await apiJoinNextSeason();
      toast("Signed up for next tournament!", "ok");
      // optional: you can disable the button after join by tracking nextEntry later
    } catch (err) {
      toast(err.message, "warn");
    }
  });
  el.authBar.append(joinNextBtn);
  const out = mkBtn("ghostBtn", "Logout", logout);
  el.authBar.append(out);
}

/* ========== Panels / Routing ========== */
function routeToDefault() {
  const user = currentUser;
  if (!user) showPanel("auth");
  else showPanel("board");
}

function showPanel(which) {
  const user = currentUser;
  // If not logged in, always show auth.
  if (!user && which !== "auth") which = "auth";

  el.authPanel.hidden = which !== "auth";
  el.boardPanel.hidden = which !== "board";
  el.betsPanel.hidden = which !== "bets";
  el.leaderPanel.hidden = which !== "leader";

  if (which === "bets") renderBetsTable();
  if (which === "leader") renderLeaderboard();
  if (which === "board") renderBoard();
}

/* ========== Leagues / Board ========== */
function renderLeagueList() {
  el.leagueList.innerHTML = "";

  for (const lg of LEAGUES) {
    const btn = document.createElement("button");
    btn.className = "leagueBtn" + (lg.key === activeLeague ? " active" : "");
    btn.type = "button";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "2px";

    const name = document.createElement("div");
    name.style.fontWeight = "900";
    name.textContent = lg.name;

    const sub = document.createElement("div");
    sub.style.fontSize = "12px";
    sub.style.color = "var(--muted)";
    sub.textContent = "Moneyline";

    left.append(name, sub);

    const tag = document.createElement("div");
    tag.className = "leagueTag";
    tag.textContent = lg.countTag;

    btn.append(left, tag);
    btn.addEventListener("click", () => {
      activeLeague = lg.key;
      renderLeagueList();
      renderBoard();
    });

    el.leagueList.appendChild(btn);
  }
}

function renderBoard() {
  const user = currentUser;
  if (!user) return;

  el.boardTitle.textContent = searchTerm
    ? `Search Results — Moneyline`
    : `${leagueName(activeLeague)} — Moneyline`;
  el.bankrollValue.textContent = currentEntry
    ? fmtMoney(currentEntry.bankroll)
    : "$0.00";

  const base = searchTerm
    ? GAMES // search across ALL leagues if you typed something
    : GAMES.filter((g) => g.league === activeLeague);

  const filtered = base.filter((g) => {
    if (!searchTerm) return true;
    const hay = `${g.home} ${g.away} ${g.league}`.toLowerCase();
    return hay.includes(searchTerm);
  });

  el.gamesList.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<div style="font-weight:900;">No games found</div>
                       <div class="muted small">Try another league or clear search.</div>`;
    el.gamesList.appendChild(empty);
    return;
  }

  for (const g of filtered) {
    const row = document.createElement("div");
    row.className = "gameRow";

    const match = document.createElement("div");
    match.className = "match";
    match.innerHTML = `
      <div class="matchMain">${g.home} vs ${g.away}</div>
      <div class="matchSub">${g.status === "final" ? `Final — Winner: ${g.winner === "home" ? g.home : g.away}` : "Scheduled"}</div>
    `;

    const start = document.createElement("div");
    start.className = "startTime";
    start.textContent = prettyTime(g.startISO);

    const homeBtn = oddsButton({
      game: g,
      side: "home",
      team: g.home,
      odds: g.homeOdds,
    });

    const awayBtn = oddsButton({
      game: g,
      side: "away",
      team: g.away,
      odds: g.awayOdds,
    });

    const settle = document.createElement("div");
    settle.className = "settleWrap";
    const homeWin = document.createElement("button");
    homeWin.className = "settleBtn home";
    homeWin.textContent = "Home Win";
    homeWin.addEventListener("click", () => settleGame(g.id, "home"));

    const awayWin = document.createElement("button");
    awayWin.className = "settleBtn away";
    awayWin.textContent = "Away Win";
    awayWin.addEventListener("click", () => settleGame(g.id, "away"));

    settle.append(homeWin, awayWin);

    row.append(match, start, homeBtn, awayBtn, settle);
    el.gamesList.appendChild(row);
  }
}

function oddsButton({ game, side, team, odds }) {
  const btn = document.createElement("button");
  btn.className = "oddsBtn";
  btn.type = "button";

  const isActive = slip && slip.gameId === game.id && slip.pickSide === side;
  if (isActive) btn.classList.add("active");

  btn.innerHTML = `
    <div class="oddsTop">
      <div class="team">${team}</div>
      <div class="oddsVal">${fmtOdds(odds)}</div>
    </div>
    <div class="oddsSmall">${side === "home" ? "Home" : "Away"} • Moneyline</div>
  `;

  btn.addEventListener("click", () => {
    const user = currentUser;
    if (!user) return toast("Log in to bet.", "warn");

    if (game.status === "final")
      return toast("Game is already finished.", "warn");
    if (Date.now() >= new Date(game.startISO).getTime()) {
      return toast("Betting closed (game started).", "warn");
    }

    const legKey = `${game.id}:${side}`;
    const existingIdx = slip.findIndex(
      (l) => `${l.gameId}:${l.pickSide}` === legKey,
    );

    if (existingIdx >= 0) {
      // Remove leg if already selected
      slip.splice(existingIdx, 1);
    } else {
      // Add leg
      slip.push({
        gameId: game.id,
        league: game.league,
        home: game.home,
        away: game.away,
        pickSide: side,
        pickTeam: team,
        odds,
        startISO: game.startISO,
        placedOddsAt: new Date().toISOString(),
      });
    }

    renderBoard();
    renderSlip();
  });

  return btn;
}

/* ========== Betslip ========== */
function renderSlip() {
  const user = currentUser;

  el.slipItems.innerHTML = "";

  // Subtitle
  if (slip.length === 0) {
    el.betslipSub.textContent = "Pick odds to start.";
  } else if (slip.length === 1) {
    el.betslipSub.textContent = "Single bet (moneyline)";
  } else {
    el.betslipSub.textContent = `Parlay (${slip.length} legs)`;
  }

  // Empty state
  if (slip.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<div style="font-weight:900;">No selection</div>
                       <div class="muted small">Click an odds button to add it here.</div>`;
    el.slipItems.appendChild(empty);
    el.btnPlaceBet.disabled = true;
    renderSlipTotals();
    return;
  }

  // Clear all button row
  const clearWrap = document.createElement("div");
  clearWrap.style.display = "flex";
  clearWrap.style.justifyContent = "space-between";
  clearWrap.style.alignItems = "center";
  clearWrap.style.marginBottom = "8px";

  const left = document.createElement("div");
  left.className = "muted small";
  left.textContent =
    slip.length === 1 ? "1 selection" : `${slip.length} selections`;

  const clearBtn = document.createElement("button");
  clearBtn.className = "ghostBtn";
  clearBtn.textContent = "Clear all";
  clearBtn.addEventListener("click", () => {
    slip = [];
    el.stakeInput.value = "";
    renderSlip();
    renderBoard();
  });

  clearWrap.append(left, clearBtn);
  el.slipItems.appendChild(clearWrap);

  // Legs list
  for (const leg of slip) {
    const card = document.createElement("div");
    card.className = "slipCard";

    const top = document.createElement("div");
    top.className = "slipTop";

    const pick = document.createElement("div");
    pick.className = "slipPick";
    pick.textContent = `${leg.pickTeam} ML`;

    const x = document.createElement("button");
    x.className = "xBtn";
    x.textContent = "Remove";
    x.addEventListener("click", () => {
      slip = slip.filter(
        (l) => !(l.gameId === leg.gameId && l.pickSide === leg.pickSide),
      );
      renderSlip();
      renderBoard();
    });

    top.append(pick, x);

    const meta = document.createElement("div");
    meta.className = "slipMeta";
    meta.innerHTML = `
      <div>${leagueName(leg.league)} • ${leg.home} vs ${leg.away}</div>
      <div>Odds: <b>${fmtOdds(leg.odds)}</b> • Start: ${prettyTime(leg.startISO)}</div>
    `;

    card.append(top, meta);
    el.slipItems.appendChild(card);
  }

  // Enable place bet if logged in and stake valid
  el.btnPlaceBet.disabled = !user;
  renderSlipTotals();
}

function renderSlipTotals() {
  const stake = Number(el.stakeInput.value || 0);

  if (slip.length === 0 || !stake || stake <= 0) {
    el.potentialProfit.textContent = fmtMoney(0);
    el.potentialPayout.textContent = fmtMoney(0);
    el.btnPlaceBet.disabled = true;
    return;
  }

  const user = currentUser;
  if (!user) {
    el.btnPlaceBet.disabled = true;
    return;
  }

  let profit = 0;
  let payout = 0;

  if (slip.length === 1) {
    ({ profit, payout } = calcMoneylineReturn(stake, slip[0].odds));
  } else {
    ({ profit, payout } = calcParlayReturn(stake, slip));
  }

  el.potentialProfit.textContent = fmtMoney(profit);
  el.potentialPayout.textContent = fmtMoney(payout);

  // disable if insufficient funds
  el.btnPlaceBet.disabled = stake > user.bankroll;
}

/* ========== Place Bet ========== */
async function onPlaceBet() {
  const user = currentUser;
  if (!user) return toast("Log in to place a bet.", "warn");
  if (!slip || slip.length === 0) return toast("Pick odds first.", "warn");

  const stake = Number(el.stakeInput.value || 0);
  if (!Number.isFinite(stake) || stake <= 0)
    return toast("Enter a valid stake.", "warn");
  if (stake > user.bankroll) return toast("Insufficient bankroll.", "warn");

  const remaining = getDailyWagerRemaining(user.username);
  if (stake > remaining) {
    return toast(
      `Daily max is ${fmtMoney(DAILY_WAGER_MAX)}. Remaining today: ${fmtMoney(remaining)}.`,
      "warn",
    );
  }

  // validate legs and build request body (support single-leg and parlays)
  for (const l of slip) {
    const g = GAMES.find((gg) => gg.id === l.gameId);
    if (!g) return toast("Game not found.", "warn");
    if (g.status === "final") return toast("Game already final.", "warn");
    if (Date.now() >= new Date(g.startISO).getTime())
      return toast("Betting closed (game started).", "warn");
  }

  try {
    let body;
    if (slip.length === 1) {
      const leg = slip[0];
      body = {
        gameId: leg.gameId,
        pick: leg.pickSide,
        stake: Math.floor(stake),
        odds: leg.odds,
      };
    } else {
      body = {
        legs: slip.map((l) => ({
          gameId: l.gameId,
          pick: l.pickSide,
          odds: l.odds,
        })),
        stake: Math.floor(stake),
      };
    }

    const res = await fetch(`${API_BASE}/bets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 402) {
      // Payment required — show helpful message
      toast(
        "Payment required to place bets. Please pay the entry fee.",
        "warn",
      );
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "place bet failed");

    // server returns { bet, entry }
    currentEntry = data.entry || currentEntry;
    addDailyWagerUsed(user.username, stake);

    toast("Bet placed.", "ok");

    // Clear slip
    slip = [];
    el.stakeInput.value = "";
    await refreshSessionUI();
    renderBoard();
    renderSlip();
  } catch (err) {
    toast(err.message || "Place bet failed.", "warn");
  }
}

/* ========== Settlement (Prototype) ========== */
function settleGame(gameId, winnerSide) {
  const user = currentUser;
  if (!user) return toast("Log in first.", "warn");

  const game = GAMES.find((g) => g.id === gameId);
  if (!game) return toast("Game not found.", "warn");

  if (game.status === "final") return toast("Already settled.", "warn");

  game.status = "final";
  game.winner = winnerSide;

  const bets = loadBets();
  let changed = 0;

  for (const bet of bets) {
    if (bet.status !== "open") continue;

    // SINGLE
    if (bet.type === "single") {
      const leg = bet.legs && bet.legs[0];
      if (!leg || leg.gameId !== gameId) continue;

      if (leg.pickSide === winnerSide) {
        const { payout } = calcMoneylineReturn(bet.stake, leg.odds);
        bet.status = "won";
        bet.payout = round2(payout);

        const u = loadUsers().find((x) => x.username === bet.username);
        if (u) {
          u.bankroll = round2(u.bankroll + payout);
          updateUser(u);
        }
      } else {
        bet.status = "lost";
        bet.payout = 0;
      }

      changed++;
      continue;
    }

    // PARLAY
    if (bet.type === "parlay") {
      const leg = bet.legs.find((l) => l.gameId === gameId);
      if (!leg) continue;

      // mark this leg result
      leg.result = leg.pickSide === winnerSide ? "won" : "lost";

      // if any leg lost => whole parlay lost
      if (bet.legs.some((l) => l.result === "lost")) {
        bet.status = "lost";
        bet.payout = 0;
        changed++;
        continue;
      }

      // if all legs won => pay
      const allWon = bet.legs.every((l) => l.result === "won");
      if (allWon) {
        const { payout } = calcParlayReturn(bet.stake, bet.legs);
        bet.status = "won";
        bet.payout = round2(payout);

        const u = loadUsers().find((x) => x.username === bet.username);
        if (u) {
          u.bankroll = round2(u.bankroll + payout);
          updateUser(u);
        }
      }

      changed++;
    }
  }

  saveBets(bets);

  toast(
    `Settled ${game.home} vs ${game.away}. Bets updated: ${changed}.`,
    "ok",
  );
  renderAuthBar();
  renderBoard();
  renderSlip();
}

/* ========== Tables ========== */
async function renderBetsTable() {
  const user = currentUser;
  if (!user) return;

  el.betsTbody.innerHTML = "";

  try {
    const open = await apiGetBetsOpen();
    const history = await apiGetBetsHistory();

    const all = [...open, ...history].filter(
      (b) => b.username === user.username,
    );
    if (all.length === 0) {
      el.betsTbody.innerHTML = `<tr><td colspan="8" class="muted">No bets yet.</td></tr>`;
      return;
    }

    for (const b of all) {
      const tr = document.createElement("tr");
      const badge = statusBadge(b.status);
      const match = b.game ? `${b.game.home} vs ${b.game.away}` : "-";
      const pickTeam =
        b.pick === "home" ? b.game?.home || "home" : b.game?.away || "away";

      tr.innerHTML = `
      <td>${prettyShort(b.placedAt)}</td>
      <td>${leagueName(b.game?.league || "")}</td>
      <td>${escapeHtml(match)}</td>
      <td>${escapeHtml(pickTeam)}</td>
      <td>${fmtOdds(b.odds)}</td>
      <td>${fmtMoney(b.stake)}</td>
      <td>${badge}</td>
      <td>${b.status === "won" ? fmtMoney(b.payout) : fmtMoney(0)}</td>
    `;

      el.betsTbody.appendChild(tr);
    }
  } catch (err) {
    el.betsTbody.innerHTML = `<tr><td colspan="8" class="muted">Failed to load bets.</td></tr>`;
  }
}

function renderLeaderboard() {
  const users = loadUsers()
    .slice()
    .sort((a, b) => b.bankroll - a.bankroll);
  const bets = loadBets();

  el.leaderTbody.innerHTML = "";

  if (users.length === 0) {
    el.leaderTbody.innerHTML = `<tr><td colspan="4" class="muted">No users yet.</td></tr>`;
    return;
  }

  users.forEach((u, i) => {
    const betCount = bets.filter((b) => b.username === u.username).length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>@${escapeHtml(u.username)}</td>
      <td>${fmtMoney(u.bankroll)}</td>
      <td>${betCount}</td>
    `;
    el.leaderTbody.appendChild(tr);
  });
}

/* ========== Reset ========== */
function onResetPrototype() {
  // wipes local storage keys for this app
  if (!confirm("Reset prototype data? This deletes users + bets.")) return;

  localStorage.removeItem(LS_KEYS.USERS);
  localStorage.removeItem(LS_KEYS.BETS);
  localStorage.removeItem(LS_KEYS.CURRENT);

  slip = null;
  el.stakeInput.value = "";
  ensureStorageInitialized();
  toast("Prototype reset.", "ok");
  renderAuthBar();
  routeToDefault();
  renderBoard();
  renderSlip();
}

/* ========== Helpers ========== */
function toast(msg, type = "ok") {
  el.notice.hidden = false;
  el.notice.textContent = msg;

  // small visual cue by type
  el.notice.style.borderColor =
    type === "warn" ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)";
  el.notice.style.background =
    type === "warn" ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)";

  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.notice.hidden = true), 2600);
}

function mkBtn(cls, text, onClick) {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function leagueName(key) {
  return LEAGUES.find((l) => l.key === key)?.name || key;
}

function fmtMoney(val) {
  const n = Number(val) || 0;
  return (
    "$" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtOdds(o) {
  const n = Number(o);
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function prettyTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function prettyShort(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hoursFromNowISO(hours) {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  return d.toISOString();
}

function calcMoneylineReturn(stake, odds) {
  function americanToDecimal(odds) {
    const o = Number(odds);
    if (o > 0) return 1 + o / 100;
    if (o < 0) return 1 + 100 / Math.abs(o);
    return 1;
  }

  function calcParlayReturn(stake, legs) {
    const s = Number(stake) || 0;
    let dec = 1;
    for (const leg of legs) dec *= americanToDecimal(leg.odds);
    const payout = s * dec;
    const profit = payout - s;
    return { profit: round2(profit), payout: round2(payout), decimal: dec };
  }

  const s = Number(stake);
  const o = Number(odds);

  let profit = 0;
  if (o > 0) {
    // +150 means win 150 per 100 staked
    profit = s * (o / 100);
  } else if (o < 0) {
    // -200 means stake 200 to win 100
    profit = s * (100 / Math.abs(o));
  } else {
    profit = 0;
  }

  const payout = s + profit;
  return { profit: round2(profit), payout: round2(payout) };
}

function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

function cryptoRandomId() {
  // short id for prototype
  if (window.crypto && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0].toString(16);
  }
  return Math.floor(Math.random() * 1e9).toString(16);
}

function statusBadge(status) {
  const cls =
    status === "won"
      ? "badge win"
      : status === "lost"
        ? "badge lose"
        : "badge open";
  const label = status.toUpperCase();
  return `<span class="${cls}">${label}</span>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
