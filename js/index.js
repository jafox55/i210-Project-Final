// API configuration used for fetching featured games.
const API_KEY = "177aade7624c44a48329961a32e26aa4";
const API_BASE_URL = "https://api.gamebrain.co/v1";

// Fallback keyword pool used when direct popularity sort is unavailable.
const POPULAR_FALLBACK_QUERIES = [
  "action",
  "adventure",
  "rpg",
  "shooter",
  "strategy",
  "sports",
  "racing",
  "indie",
  "simulation",
  "platformer",
];
const TARGET_COUNT = 10;

// Escapes dynamic text before insertion into HTML strings.
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gameId(game) {
  return game?.id || game?.game_id || game?._id || game?.slug || game?.name;
}

function gameName(game) {
  const name = String(game?.name || "").trim();
  return name || "Untitled Game";
}

function gameImage(game) {
  const image = String(game?.image || "").trim();
  return image || "https://via.placeholder.com/200x200?text=No+Image";
}

// Performs one API search query and returns the normalized results array.
async function fetchGamesByQuery(query) {
  const params = new URLSearchParams();
  params.append("query", query);
  params.append("limit", "30");

  const response = await fetch(`${API_BASE_URL}/games?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }

  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

function ratingCount(game) {
  return Number(game?.rating?.count) || 0;
}

function ratingMean(game) {
  return Number(game?.rating?.mean) || 0;
}

// Combined ranking metric for featured ordering.
function popularityScore(game) {
  // Prioritize volume of ratings, then average score.
  return ratingCount(game) * 100 + ratingMean(game);
}

function dedupeGames(games) {
  const unique = [];
  const seen = new Set();

  for (const game of games) {
    const id = String(gameId(game) || "");
    const name = gameName(game).toLowerCase();
    if (!id || seen.has(id) || seen.has(name)) continue;

    seen.add(id);
    seen.add(name);
    unique.push(game);
  }

  return unique;
}

// Attempts several API sort modes to fetch popular games directly.
async function fetchPopularFromApi() {
  const sortParamSets = [
    { limit: "50", sort: "-popularity" },
    { limit: "50", ordering: "-popularity" },
    { limit: "50", sort: "-rating.count" },
    { limit: "50", ordering: "-rating.count" },
    { limit: "50", sort: "-rating.mean" },
    { limit: "50", ordering: "-rating.mean" },
    { limit: "50" },
  ];

  for (const paramsObj of sortParamSets) {
    try {
      const params = new URLSearchParams(paramsObj);
      const response = await fetch(`${API_BASE_URL}/games?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      if (!results.length) continue;

      const popular = dedupeGames(results)
        .sort((a, b) => popularityScore(b) - popularityScore(a))
        .slice(0, TARGET_COUNT);

      if (popular.length >= TARGET_COUNT) return popular;
    } catch {
      // Try next parameter set.
    }
  }

  return [];
}

// Fallback strategy: query multiple genres and rank results locally.
async function fetchPopularFallback() {
  const pool = [];

  for (const query of POPULAR_FALLBACK_QUERIES) {
    if (pool.length >= 400) break;

    try {
      const games = await fetchGamesByQuery(query);
      pool.push(...games);
    } catch {
      // Try the next query if one fails.
    }
  }

  return dedupeGames(pool)
    .filter((game) => gameImage(game) && gameName(game) !== "Untitled Game")
    .sort((a, b) => popularityScore(b) - popularityScore(a))
    .slice(0, TARGET_COUNT);
}

// Entry fetch strategy: direct popular endpoint first, fallback second.
async function fetchFeaturedGames() {
  const direct = await fetchPopularFromApi();
  if (direct.length) return direct;

  return fetchPopularFallback();
}

// Builds one carousel card HTML block.
function buildCarouselItem(game, ariaHidden = false) {
  const image = escapeHtml(gameImage(game));
  const name = escapeHtml(gameName(game));

  return `
    <div class="carousel-item"${ariaHidden ? ' aria-hidden="true"' : ""}>
      <img src="${image}" alt="${name}" />
      <p class="carousel-label">${name}</p>
    </div>
  `;
}

// Renders the featured carousel and duplicates the set for seamless scrolling.
async function initFeaturedCarousel() {
  const wrap = document.querySelector(".carousel .wrap");
  if (!wrap) return;

  const games = await fetchFeaturedGames();
  if (!games.length) return;

  const firstSet = games.map((game) => buildCarouselItem(game)).join("");
  const duplicateSet = games.map((game) => buildCarouselItem(game, true)).join("");

  wrap.innerHTML = `${firstSet}${duplicateSet}`;
}

// Initialize featured carousel behavior when script loads.
initFeaturedCarousel();
