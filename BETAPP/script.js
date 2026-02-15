/* ===========================
   Playbook Prototype (Frontend)
   - localStorage "DB"
   - Moneyline only
   - Single-leg betslip
=========================== */

const STARTING_BANKROLL = 100000;

const LS_KEYS = {
  USERS: "pb_users",
  CURRENT: "pb_current_user",
  BETS: "pb_bets",
};

const LEAGUES = [
  { key: "NBA", name: "NBA", countTag: "Basketball" },
  { key: "NHL", name: "NHL", countTag: "Hockey" },
  { key: "NFL", name: "NFL", countTag: "Football" },
  { key: "MLB", name: "MLB", countTag: "Baseball" },
  { key: "OLY", name: "Olympics", countTag: "Global" },
];

// Prototype games (hardcoded). Later: replace with API feed.
const GAMES = [
  {
    id: "nba_001",
    league: "NBA",
    startISO: hoursFromNowISO(4),
    home: "Lakers",
    away: "Warriors",
    homeOdds: -120,
    awayOdds: +110,
    status: "scheduled", // scheduled | final
    winner: null, // "home" | "away"
  },
  {
    id: "nba_002",
    league: "NBA",
    startISO: hoursFromNowISO(9),
    home: "Celtics",
    away: "Bucks",
    homeOdds: -145,
    awayOdds: +125,
    status: "scheduled",
    winner: null,
  },
  {
    id: "nhl_001",
    league: "NHL",
    startISO: hoursFromNowISO(3),
    home: "Maple Leafs",
    away: "Canadiens",
    homeOdds: -155,
    awayOdds: +135,
    status: "scheduled",
    winner: null,
  },
  {
    id: "nfl_001",
    league: "NFL",
    startISO: hoursFromNowISO(28),
    home: "Chiefs",
    away: "Bills",
    homeOdds: -110,
    awayOdds: -110,
    status: "scheduled",
    winner: null,
  },
  {
    id: "mlb_001",
    league: "MLB",
    startISO: hoursFromNowISO(18),
    home: "Yankees",
    away: "Red Sox",
    homeOdds: -135,
    awayOdds: +120,
    status: "scheduled",
    winner: null,
  },
  {
    id: "oly_001",
    league: "OLY",
    startISO: hoursFromNowISO(40),
    home: "Canada",
    away: "USA",
    homeOdds: +105,
    awayOdds: -125,
    status: "scheduled",
    winner: null,
  },
];

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
};

/* ========== App State ========== */
let activeLeague = "NBA";
let slip = null; // { gameId, league, home, away, pickSide, pickTeam, odds }
let searchTerm = "";

/* ========== Init ========== */
boot();

function boot() {
  ensureStorageInitialized();
  renderAuthBar();
  renderLeagueList();
  bindEvents();
  routeToDefault();
  renderBoard();
  renderSlip();
}

/* ========== Storage ========== */
function ensureStorageInitialized() {
  if (!localStorage.getItem(LS_KEYS.USERS)) localStorage.setItem(LS_KEYS.USERS, JSON.stringify([]));
  if (!localStorage.getItem(LS_KEYS.BETS)) localStorage.setItem(LS_KEYS.BETS, JSON.stringify([]));
}

function loadUsers() {
  return JSON.parse(localStorage.getItem(LS_KEYS.USERS) || "[]");
}

function saveUsers(users) {
  localStorage.setItem(LS_KEYS.USERS, JSON.stringify(users));
}

function loadBets() {
  return JSON.parse(localStorage.getItem(LS_KEYS.BETS) || "[]");
}

function saveBets(bets) {
  localStorage.setItem(LS_KEYS.BETS, JSON.stringify(bets));
}

function getCurrentUsername() {
  return localStorage.getItem(LS_KEYS.CURRENT);
}

function setCurrentUsername(username) {
  if (!username) localStorage.removeItem(LS_KEYS.CURRENT);
  else localStorage.setItem(LS_KEYS.CURRENT, username);
}

function getCurrentUser() {
  const u = getCurrentUsername();
  if (!u) return null;
  return loadUsers().find(x => x.username === u) || null;
}

function updateUser(updatedUser) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.username === updatedUser.username);
  if (idx >= 0) {
    users[idx] = updatedUser;
    saveUsers(users);
  }
}

/* ========== Events ========== */
function bindEvents() {
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
function onRegister() {
  const username = (el.regUsername.value || "").trim();
  const password = (el.regPassword.value || "").trim();

  if (!username || !password) return toast("Enter a username and password.", "warn");

  const users = loadUsers();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return toast("Username already exists. Pick another.", "warn");
  }

  // Prototype: store password in plain text (NOT OK for real).
  // Real version: backend + bcrypt.
  const newUser = {
    username,
    password,
    bankroll: STARTING_BANKROLL,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveUsers(users);
  setCurrentUsername(username);

  el.regUsername.value = "";
  el.regPassword.value = "";

  toast(`Account created. Bankroll credited: ${fmtMoney(STARTING_BANKROLL)}.`, "ok");
  renderAuthBar();
  routeToDefault();
  renderBoard();
}

function onLogin() {
  const username = (el.loginUsername.value || "").trim();
  const password = (el.loginPassword.value || "").trim();

  if (!username || !password) return toast("Enter your username and password.", "warn");

  const user = loadUsers().find(u => u.username === username);
  if (!user || user.password !== password) {
    return toast("Invalid login.", "warn");
  }

  setCurrentUsername(username);

  el.loginUsername.value = "";
  el.loginPassword.value = "";

  toast(`Welcome back, ${username}.`, "ok");
  renderAuthBar();
  routeToDefault();
  renderBoard();
}

function logout() {
  setCurrentUsername(null);
  slip = null;
  el.stakeInput.value = "";
  toast("Logged out.", "ok");
  renderAuthBar();
  routeToDefault();
  renderBoard();
  renderSlip();
}

function renderAuthBar() {
  const user = getCurrentUser();
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
  bank.textContent = `Bankroll: ${fmtMoney(user.bankroll)}`;

  const out = mkBtn("ghostBtn", "Logout", logout);
  el.authBar.append(chip, bank, out);
}

/* ========== Panels / Routing ========== */
function routeToDefault() {
  const user = getCurrentUser();
  if (!user) showPanel("auth");
  else showPanel("board");
}

function showPanel(which) {
  const user = getCurrentUser();
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
  const user = getCurrentUser();
  if (!user) return;

  el.boardTitle.textContent = `${leagueName(activeLeague)} — Moneyline`;
  el.bankrollValue.textContent = fmtMoney(user.bankroll);

  const filtered = GAMES
    .filter(g => g.league === activeLeague)
    .filter(g => {
      if (!searchTerm) return true;
      const hay = `${g.home} ${g.away}`.toLowerCase();
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
    const user = getCurrentUser();
    if (!user) return toast("Log in to bet.", "warn");

    if (game.status === "final") return toast("Game is already finished.", "warn");
    if (Date.now() >= new Date(game.startISO).getTime()) {
      return toast("Betting closed (game started).", "warn");
    }

    slip = {
      gameId: game.id,
      league: game.league,
      home: game.home,
      away: game.away,
      pickSide: side,
      pickTeam: team,
      odds,
      startISO: game.startISO,
      placedOddsAt: new Date().toISOString(),
    };

    renderBoard();
    renderSlip();
  });

  return btn;
}

/* ========== Betslip ========== */
function renderSlip() {
  const user = getCurrentUser();

  el.slipItems.innerHTML = "";
  el.betslipSub.textContent = slip ? "Single bet (moneyline)" : "Pick odds to start.";

  if (!slip) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<div style="font-weight:900;">No selection</div>
                       <div class="muted small">Click an odds button to add it here.</div>`;
    el.slipItems.appendChild(empty);
    el.btnPlaceBet.disabled = true;
    renderSlipTotals();
    return;
  }

  const card = document.createElement("div");
  card.className = "slipCard";

  const top = document.createElement("div");
  top.className = "slipTop";

  const pick = document.createElement("div");
  pick.className = "slipPick";
  pick.textContent = `${slip.pickTeam} ML`;

  const x = document.createElement("button");
  x.className = "xBtn";
  x.textContent = "Remove";
  x.addEventListener("click", () => {
    slip = null;
    el.stakeInput.value = "";
    renderSlip();
    renderBoard();
  });

  top.append(pick, x);

  const meta = document.createElement("div");
  meta.className = "slipMeta";
  meta.innerHTML = `
    <div>${leagueName(slip.league)} • ${slip.home} vs ${slip.away}</div>
    <div>Odds: <b>${fmtOdds(slip.odds)}</b> • Start: ${prettyTime(slip.startISO)}</div>
  `;

  card.append(top, meta);
  el.slipItems.appendChild(card);

  // Enable place bet if logged in and stake valid
  el.btnPlaceBet.disabled = !user;
  renderSlipTotals();
}

function renderSlipTotals() {
  const stake = Number(el.stakeInput.value || 0);
  if (!slip || !stake || stake <= 0) {
    el.potentialProfit.textContent = fmtMoney(0);
    el.potentialPayout.textContent = fmtMoney(0);
    el.btnPlaceBet.disabled = true;
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    el.btnPlaceBet.disabled = true;
    return;
  }

  const { profit, payout } = calcMoneylineReturn(stake, slip.odds);
  el.potentialProfit.textContent = fmtMoney(profit);
  el.potentialPayout.textContent = fmtMoney(payout);

  // disable if insufficient funds
  el.btnPlaceBet.disabled = stake > user.bankroll;
}

/* ========== Place Bet ========== */
function onPlaceBet() {
  const user = getCurrentUser();
  if (!user) return toast("Log in to place a bet.", "warn");
  if (!slip) return toast("Pick an outcome first.", "warn");

  const stake = Number(el.stakeInput.value || 0);
  if (!Number.isFinite(stake) || stake <= 0) return toast("Enter a valid stake.", "warn");
  if (stake > user.bankroll) return toast("Insufficient bankroll.", "warn");

  const game = GAMES.find(g => g.id === slip.gameId);
  if (!game) return toast("Game not found.", "warn");
  if (game.status === "final") return toast("Game already final.", "warn");
  if (Date.now() >= new Date(game.startISO).getTime()) return toast("Betting closed (game started).", "warn");

  // Deduct stake immediately
  user.bankroll -= stake;
  updateUser(user);

  const bet = {
    id: "bet_" + cryptoRandomId(),
    username: user.username,
    placedAt: new Date().toISOString(),
    league: slip.league,
    gameId: slip.gameId,
    match: `${slip.home} vs ${slip.away}`,
    pickSide: slip.pickSide,
    pickTeam: slip.pickTeam,
    oddsUsed: slip.odds,
    stake,
    status: "open", // open | won | lost
    payout: 0,
  };

  const bets = loadBets();
  bets.unshift(bet);
  saveBets(bets);

  toast(`Bet placed: ${bet.pickTeam} ${fmtOdds(bet.oddsUsed)} for ${fmtMoney(bet.stake)}.`, "ok");

  // Clear slip
  slip = null;
  el.stakeInput.value = "";
  renderAuthBar();
  renderBoard();
  renderSlip();
}

/* ========== Settlement (Prototype) ========== */
function settleGame(gameId, winnerSide) {
  const user = getCurrentUser();
  if (!user) return toast("Log in first.", "warn");

  const game = GAMES.find(g => g.id === gameId);
  if (!game) return toast("Game not found.", "warn");

  if (game.status === "final") return toast("Already settled.", "warn");

  game.status = "final";
  game.winner = winnerSide;

  const bets = loadBets();
  let changed = 0;

  for (const bet of bets) {
    if (bet.gameId !== gameId) continue;
    if (bet.status !== "open") continue;

    if (bet.pickSide === winnerSide) {
      const { payout } = calcMoneylineReturn(bet.stake, bet.oddsUsed);
      bet.status = "won";
      bet.payout = round2(payout);

      // Credit payout to that user
      const u = loadUsers().find(x => x.username === bet.username);
      if (u) {
        u.bankroll += payout;
        updateUser(u);
      }
    } else {
      bet.status = "lost";
      bet.payout = 0;
    }
    changed++;
  }

  saveBets(bets);

  toast(`Settled ${game.home} vs ${game.away}. Bets updated: ${changed}.`, "ok");
  renderAuthBar();
  renderBoard();
  renderSlip();
}

/* ========== Tables ========== */
function renderBetsTable() {
  const user = getCurrentUser();
  if (!user) return;

  const bets = loadBets().filter(b => b.username === user.username);

  el.betsTbody.innerHTML = "";
  if (bets.length === 0) {
    el.betsTbody.innerHTML = `<tr><td colspan="8" class="muted">No bets yet.</td></tr>`;
    return;
  }

  for (const b of bets) {
    const tr = document.createElement("tr");
    const badge = statusBadge(b.status);

    tr.innerHTML = `
      <td>${prettyShort(b.placedAt)}</td>
      <td>${leagueName(b.league)}</td>
      <td>${escapeHtml(b.match)}</td>
      <td>${escapeHtml(b.pickTeam)}</td>
      <td>${fmtOdds(b.oddsUsed)}</td>
      <td>${fmtMoney(b.stake)}</td>
      <td>${badge}</td>
      <td>${b.status === "won" ? fmtMoney(b.payout) : fmtMoney(0)}</td>
    `;
    el.betsTbody.appendChild(tr);
  }
}

function renderLeaderboard() {
  const users = loadUsers().slice().sort((a, b) => b.bankroll - a.bankroll);
  const bets = loadBets();

  el.leaderTbody.innerHTML = "";

  if (users.length === 0) {
    el.leaderTbody.innerHTML = `<tr><td colspan="4" class="muted">No users yet.</td></tr>`;
    return;
  }

  users.forEach((u, i) => {
    const betCount = bets.filter(b => b.username === u.username).length;
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
  return LEAGUES.find(l => l.key === key)?.name || key;
}

function fmtMoney(n) {
  const val = Number(n || 0);
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtOdds(o) {
  const n = Number(o);
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function prettyTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function prettyShort(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function hoursFromNowISO(hours) {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  return d.toISOString();
}

function calcMoneylineReturn(stake, odds) {
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
  const cls = status === "won" ? "badge win" : status === "lost" ? "badge lose" : "badge open";
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