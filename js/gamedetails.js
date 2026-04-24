// API configuration for game detail lookups.
const API_KEY = "177aade7624c44a48329961a32e26aa4";
const API_BASE_URL = "https://api.gamebrain.co/v1";

// Determines the best back destination based on query params/referrer.
function resolveBackHref() {
  const from = new URLSearchParams(window.location.search).get("from");
  if (from === "search") return "search.html";
  if (from === "games" || from === "catalog") return "games.html";

  try {
    const ref = new URL(document.referrer);
    if (ref.origin === window.location.origin && ref.pathname.endsWith("search.html")) {
      return "search.html";
    }
  } catch {
    // Ignore invalid referrer.
  }

  return "games.html";
}

// Applies computed destination to the back link in the page header.
function setupBackLink() {
  const backLink = document.querySelector(".back");
  if (!backLink) return;
  backLink.setAttribute("href", resolveBackHref());
}

// Formats rating display text.
function scoreText(game) {
  return typeof game?.rating?.mean === "number"
    ? `${(game.rating.mean * 10).toFixed(1)}/10`
    : "N/A";
}

// Converts platform payload shapes into readable text.
function platformText(game) {
  const list = [
    ...(Array.isArray(game.platforms) ? game.platforms : []),
    ...(Array.isArray(game.platform) ? game.platform : [game.platform]),
  ]
    .map((p) => {
      if (!p) return "";
      if (typeof p === "string") return p;
      return p.name || p.platform?.name || p.slug || "";
    })
    .filter(Boolean);

  const unique = [...new Set(list)];
  return unique.length ? unique.join(", ") : "Unknown";
}

// Extracts and normalizes genre names from multiple possible payload shapes.
function genresText(game) {
  const collected = [];

  if (Array.isArray(game.genres)) {
    game.genres.forEach((g) => {
      if (typeof g === "string") {
        collected.push(...g.split(","));
      } else if (g && typeof g === "object") {
        if (g.name) collected.push(g.name);
        if (g.genre) collected.push(g.genre);
      }
    });
  }

  const unique = [...new Set(collected.map((g) => String(g).trim()).filter(Boolean))];
  return unique.length ? unique.join(", ") : "Unknown";
}

// Returns a stable ID across API response variants.
function getGameId(game) {
  return game?.id || game?.game_id || game?._id || game?.slug || game?.name;
}

// Normalizes boolean-like values from mixed data types.
function toBool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

// Determines whether content should receive adult-only masking.
function isAdultGame(game) {
  if (toBool(game?.template_adult_only)) return true;
  if (toBool(game?.tag?.adult_only)) return true;
  if (toBool(game?.adult_only)) return true;
  if (toBool(game?.tags?.adult_only)) return true;

  if (Array.isArray(game?.tags)) {
    for (const tag of game.tags) {
      if (typeof tag === "object" && tag && toBool(tag.adult_only)) return true;
      if (typeof tag === "string" && tag.toLowerCase() === "adult_only") return true;
    }
  }

  return false;
}

// Sanitizes potential description strings.
function sanitizeText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Heuristic: detect text that is mostly URL-like (not useful description text).
function isUrlLikeText(text) {
  const cleaned = sanitizeText(text);
  if (!cleaned) return true;

  // Full URL or mostly URL-like tokens
  if (/^https?:\/\//i.test(cleaned)) return true;
  const words = cleaned.split(/\s+/);
  const urlishCount = words.filter((w) => /https?:\/\/|www\.|\.com|\.net|\.org|\/v\d\b/i.test(w)).length;
  return words.length > 0 && urlishCount / words.length > 0.6;
}

// Heuristic: validate candidate paragraph-like description quality.
function isLikelyDescription(text) {
  const cleaned = sanitizeText(text);
  if (!cleaned || cleaned.length < 40) return false;

  // Reject URL-heavy/link-like content
  if (isUrlLikeText(cleaned)) return false;
  if (/\b(api|endpoint|href|url)\b/i.test(cleaned) && cleaned.length < 180) {
    return false;
  }

  // Require several words with letters (not IDs/slugs)
  const words = cleaned.match(/[a-zA-Z]{3,}/g) || [];
  return words.length >= 6;
}

// Recursive extraction of best available description from nested payloads.
function findDescriptionLikeText(input, depth = 0) {
  if (!input || depth > 4) return "";

  if (typeof input === "string") {
    const cleaned = sanitizeText(input);
    return isLikelyDescription(cleaned) ? cleaned : "";
  }

  if (Array.isArray(input)) {
    let best = "";
    input.forEach((item) => {
      const candidate = findDescriptionLikeText(item, depth + 1);
      if (candidate.length > best.length) best = candidate;
    });
    return best;
  }

  if (typeof input === "object") {
    const preferredKeyMatch = /(description|summary|overview|synopsis|about|blurb|story)/i;
    let best = "";

    Object.entries(input).forEach(([key, value]) => {
      const fromChild = findDescriptionLikeText(value, depth + 1);

      if (preferredKeyMatch.test(key) && fromChild.length > best.length) {
        best = fromChild;
      }
    });

    if (best) return best;

    Object.values(input).forEach((value) => {
      const fromChild = findDescriptionLikeText(value, depth + 1);
      if (fromChild.length > best.length) best = fromChild;
    });

    return best;
  }

  return "";
}

// Picks the best description field with direct priority + recursive fallback.
function descriptionText(game) {
  const directCandidates = [
    game.template_short_description,
    game.template_description,
    game.template_discovered_description,
    game.short_description,
    game["short description"],
    game.shortDescription,
    game.description,
    game.summary,
    game.overview,
    game.synopsis,
  ];

  for (const candidate of directCandidates) {
    const cleaned = sanitizeText(candidate);
    if (cleaned && cleaned.length >= 8 && !isUrlLikeText(cleaned)) {
      return cleaned;
    }
  }

  const discovered = findDescriptionLikeText(game);
  if (discovered) return discovered;

  return "No description available.";
}

// Fetches complete game details by ID.
async function fetchGameDetailsById(gameId) {
  if (!gameId) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Main render flow for details page.
async function render() {
  const content = document.getElementById("content");
  const selected = sessionStorage.getItem("selectedGame");
  const urlId = new URLSearchParams(window.location.search).get("id");

  let selectedGame = null;
  if (selected) {
    try {
      selectedGame = JSON.parse(selected);
    } catch {
      selectedGame = null;
    }
  }

  const selectedId = selectedGame ? String(getGameId(selectedGame) || "") : "";
  const resolvedId = urlId || selectedId;

  if (!selectedGame && !resolvedId) {
    content.innerHTML =
      '<div class="empty">No game data found. Go back and click View Entry from the catalog or search page.</div>';
    return;
  }

  let gameData = selectedGame;

  // If URL id differs from stale storage, prioritize URL and fetch fresh data.
  if (urlId && selectedId && selectedId !== urlId) {
    gameData = null;
  }

  if (!gameData && resolvedId) {
    const details = await fetchGameDetailsById(resolvedId);
    if (!details) {
      content.innerHTML =
        '<div class="empty">Could not load that game right now. Please go back and try again.</div>';
      return;
    }

    gameData = details;
  }

  let description = descriptionText(gameData);

  if (description === "No description available.") {
    const details = await fetchGameDetailsById(resolvedId || String(getGameId(gameData) || ""));
    if (details) {
      gameData = { ...gameData, ...details };
      description = descriptionText(gameData);
    }
  }

  const image = gameData.image || "https://via.placeholder.com/1200x600?text=No+Image";
  const release = gameData.release_date || gameData.year || "TBA";
  const reviews = gameData?.rating?.count
    ? gameData.rating.count.toLocaleString()
    : "N/A";
  const adult = isAdultGame(gameData);

  content.innerHTML = `
    <article class="panel">
      <div class="thumb-wrap">
        <img class="hero ${adult ? "adult-thumb" : ""}" src="${image}" alt="${gameData.name || "Game"}" />
        ${adult ? '<span class="adult-badge">18+</span>' : ""}
      </div>
      <div class="body">
        <h1>${gameData.name || "Untitled Game"}</h1>

        <div class="grid">
          <div class="item">
            <div class="label">Score</div>
            <div class="value">${scoreText(gameData)}</div>
          </div>
          <div class="item">
            <div class="label">Release</div>
            <div class="value">${release}</div>
          </div>
          <div class="item">
            <div class="label">Platforms</div>
            <div class="value">${platformText(gameData)}</div>
          </div>
          <div class="item">
            <div class="label">Genres</div>
            <div class="value">${genresText(gameData)}</div>
          </div>
          <div class="item">
            <div class="label">Reviews</div>
            <div class="value">${reviews}</div>
          </div>
          <div class="item">
            <div class="label">Game ID</div>
            <div class="value">${resolvedId || String(getGameId(gameData) || "N/A")}</div>
          </div>
        </div>

        <div class="desc">${description}</div>
      </div>
    </article>
  `;
}

// Initialize page behavior.
setupBackLink();
render();
