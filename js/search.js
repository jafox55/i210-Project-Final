// API configuration and simple session request guard.
const API_KEY = "177aade7624c44a48329961a32e26aa4";
const API_BASE_URL = "https://api.gamebrain.co/v1";
const REQUEST_LIMIT = 10;
const SEARCH_STORAGE_KEY = "gamebrain:lastSearch";

// DOM references for search controls and render targets.
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const clearButton = document.getElementById("clearButton");
const resultsDiv = document.getElementById("results");
const messageDiv = document.getElementById("message");

// Firebase configuration used for shared favorites data.
const firebaseConfig = {
  apiKey: "AIzaSyBsFT1xZf_IgcfnBWIfh7Tt8jfRr-RZN4Q",
  authDomain: "my-team-project-8b98c.firebaseapp.com",
  databaseURL: "https://my-team-project-8b98c-default-rtdb.firebaseio.com",
  projectId: "my-team-project-8b98c",
  storageBucket: "my-team-project-8b98c.firebasestorage.app",
  messagingSenderId: "327995312132",
  appId: "1:327995312132:web:3dbd51c0e3c54ce33e8d51",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();
const favoritesRef = database.ref("favorites");

// Runtime state for favorites + current rendered results.
let favoriteIds = new Set();
let currentResults = [];

// Lightweight in-memory search cache and request counter.
const cache = new Map();
let requestCount = 0;

// Persists the current search input between page visits.
function saveSearchQuery(value) {
  try {
    localStorage.setItem(SEARCH_STORAGE_KEY, value);
  } catch {
    // Ignore storage errors
  }
}

// Restores the last search string from localStorage.
function restoreSearchQuery() {
  try {
    const saved = localStorage.getItem(SEARCH_STORAGE_KEY);
    if (saved) {
      searchInput.value = saved;
    }
  } catch {
    // Ignore storage errors
  }
}

// Shows a status/error message in the shared message box.
function setMessage(text, error = false) {
  messageDiv.classList.remove("hidden");
  messageDiv.className = error ? "msg err" : "msg";
  messageDiv.textContent = text;
}

// Hides the status message region.
function clearMessage() {
  messageDiv.classList.add("hidden");
}

// Converts platform arrays/objects to display text.
function platformText(game) {
  const platforms = [
    ...(Array.isArray(game.platforms) ? game.platforms : []),
    ...(Array.isArray(game.platform) ? game.platform : game.platform ? [game.platform] : []),
  ]
    .map((p) => {
      if (!p) return "";
      if (typeof p === "string") return p;
      return p.name || p.platform?.name || p.slug || "";
    })
    .filter(Boolean);

  const unique = [...new Set(platforms)];
  return unique.length ? unique.join(", ") : "Unknown";
}

// Formats rating display text.
function scoreText(game) {
  return typeof game?.rating?.mean === "number"
    ? `${(game.rating.mean * 10).toFixed(1)}/10`
    : "N/A";
}

// Returns a stable identifier from multiple possible API keys.
function getGameId(game) {
  return game.id || game.game_id || game._id || game.slug || game.name;
}

// Normalizes API boolean-like values.
function toBool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

// Fast adult detection using common API tag shapes.
function hasAdultOnlyTag(game) {
  // Most direct shapes from API responses
  if (toBool(game?.tag?.adult_only)) return true;
  if (toBool(game?.adult_only)) return true;

  // tags can be object/array/string in some payloads
  if (toBool(game?.tags?.adult_only)) return true;

  if (Array.isArray(game?.tags)) {
    for (const tag of game.tags) {
      if (typeof tag === "object" && tag && toBool(tag.adult_only)) return true;
      if (typeof tag === "string" && tag.toLowerCase() === "adult_only") return true;
    }
  }

  return false;
}

// Broader adult detection fallback for inconsistent payloads.
function isAdultGame(game) {
  if (hasAdultOnlyTag(game)) return true;

  const directFlags = [game.adult, game.nsfw, game.is_adult, game.isAdult].some(toBool);

  if (directFlags) return true;

  const ageText = [
    game.age_rating,
    game.ageRating,
    game.esrb_rating,
    game.esrb,
    game.content_rating,
    game.contentRating,
  ]
    .map((v) => (v == null ? "" : String(v)))
    .join(" ")
    .toLowerCase();

  if (/(18\+|ao|adults? only|mature 17\+|mature 18\+)/i.test(ageText)) {
    return true;
  }

  const genres = [
    game.genre,
    ...(Array.isArray(game.genres)
      ? game.genres.map((g) => (typeof g === "string" ? g : g?.name || ""))
      : []),
    game.tags,
  ]
    .flat()
    .map((v) => (v == null ? "" : String(v)))
    .join(" ")
    .toLowerCase();

  return /(adult|erotic|hentai|nsfw|porn|sexual)/i.test(genres);
}

// Normalizes whitespace for description text candidates.
function sanitizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

// Recursively finds potentially useful description strings in payloads.
function findDescriptionCandidate(input, depth = 0) {
  if (!input || depth > 4) return "";

  if (typeof input === "string") {
    const cleaned = sanitizeText(input);
    return cleaned.length >= 20 ? cleaned : "";
  }

  if (Array.isArray(input)) {
    let best = "";
    input.forEach((item) => {
      const candidate = findDescriptionCandidate(item, depth + 1);
      if (candidate.length > best.length) best = candidate;
    });
    return best;
  }

  if (typeof input === "object") {
    const preferredKeyMatch = /(description|summary|overview|synopsis|about|blurb|story)/i;
    let best = "";

    Object.entries(input).forEach(([key, value]) => {
      if (!preferredKeyMatch.test(key)) return;
      const candidate = findDescriptionCandidate(value, depth + 1);
      if (candidate.length > best.length) best = candidate;
    });

    return best;
  }

  return "";
}

// Packages selected game data so details page has robust fallback fields.
function buildTemplateGameData(game) {
  const shortDescription = sanitizeText(
    game.short_description || game["short description"] || game.shortDescription,
  );
  const longDescription =
    sanitizeText(game.description || game.summary || game.overview || game.synopsis) ||
    findDescriptionCandidate(game);

  return {
    ...game,
    template_adult_only: hasAdultOnlyTag(game),
    template_short_description: shortDescription,
    template_description: longDescription,
  };
}

// Saves selected card state and navigates to the details page.
function openGameTemplate(game) {
  const gameId = getGameId(game);
  const templateGame = buildTemplateGameData(game);
  sessionStorage.setItem("selectedGame", JSON.stringify(templateGame));

  const params = new URLSearchParams();
  params.set("id", String(gameId || ""));
  params.set("from", "search");
  window.location.href = `gamedetails.html?${params.toString()}`;
}

// Renders all result cards and wires details/favorite interactions.
function renderResults(games) {
  resultsDiv.innerHTML = "";

  if (!games.length) {
    setMessage("No games found. Try a different search.");
    return;
  }

  clearMessage();

  games.forEach((game) => {
    const card = document.createElement("article");
    card.className = "card";
    const adult = isAdultGame(game);
    const id = String(getGameId(game));
    const isFavorite = favoriteIds.has(id);

    const image = game.image || "https://via.placeholder.com/600x340?text=No+Image";
    const release = game.release_date || game.year || "TBA";
    card.innerHTML = `
      <div class="thumb-wrap">
        <button
          class="favorite-star ${isFavorite ? "active" : ""}"
          type="button"
          aria-label="${isFavorite ? "Remove from favorites" : "Add to favorites"}"
          aria-pressed="${isFavorite ? "true" : "false"}"
          title="${isFavorite ? "Remove from favorites" : "Add to favorites"}"
        >
          ${isFavorite ? "★" : "☆"}
        </button>
        <img
          src="${image}"
          alt="${game.name || "Game"}"
          loading="lazy"
          class="${adult ? "adult-thumb" : ""}"
        />
        ${adult ? '<span class="adult-badge">18+</span>' : ""}
      </div>
      <div class="card-body">
        <h3>${game.name || "Untitled Game"}</h3>
        <p class="meta"><strong>Score:</strong> ${scoreText(game)}</p>
        <p class="meta"><strong>Released:</strong> ${release}</p>
        <p class="meta"><strong>Genre:</strong> ${Array.isArray(game.genres) ? game.genres.map((g) => (typeof g === "string" ? g : g?.name || "")).filter(Boolean).join(", ") || "Unknown" : game.genre || "Unknown"}</p>
        <div class="card-actions">
          <button class="toggle-btn" type="button">Show details</button>
        </div>
      </div>
    `;

    const toggleBtn = card.querySelector(".toggle-btn");
    const starBtn = card.querySelector(".favorite-star");
    toggleBtn.addEventListener("click", () => openGameTemplate(game));
    setStarState(starBtn, isFavorite);

    starBtn.addEventListener("click", async (event) => {
      event.stopPropagation();

      const gameId = String(getGameId(game));
      const nowFavorite = !favoriteIds.has(gameId);

      try {
        if (nowFavorite) {
          await saveFavoriteToFirebase(game);
          favoriteIds.add(gameId);
        } else {
          await removeFavoriteFromFirebase(game);
          favoriteIds.delete(gameId);
        }

        setStarState(starBtn, nowFavorite);
      } catch {
        setMessage("Could not update favorites right now.", true);
      }
    });

    resultsDiv.appendChild(card);
  });
}

// Keeps in-page favorite stars synchronized with Firebase changes.
favoritesRef.on("value", (snapshot) => {
  const value = snapshot.val() || {};
  favoriteIds = new Set(
    Object.values(value)
      .map((entry) => String(entry?.gameId || ""))
      .filter(Boolean),
  );

  if (currentResults.length) {
    renderResults(currentResults);
  }
});

// Builds the search endpoint URL for a query.
function buildSearchURL(query) {
  const params = new URLSearchParams();
  params.append("query", query);
  params.append("limit", "30");
  return `${API_BASE_URL}/games?${params.toString()}`;
}

// Maps HTTP status codes to user-friendly errors.
function httpErrorText(status) {
  if (status === 401 || status === 403) return "API key/auth issue (401/403).";
  if (status === 402) return "Plan limit reached for this endpoint (402).";
  if (status === 429) return "Rate limit hit (429).";
  return `Request failed (${status}).`;
}

// Executes search request flow: validation, cache, fetch, and rendering.
async function searchGames() {
  const query = searchInput.value.trim();

  if (!query) {
    setMessage("Enter a search term.", true);
    return;
  }

  if (!API_KEY || API_KEY === "YOUR_API_KEY") {
    setMessage("Set a valid API key first.", true);
    return;
  }

  const key = query.toLowerCase();
  saveSearchQuery(query);

  if (cache.has(key)) {
    const cachedGames = cache.get(key);
    currentResults = cachedGames;
    renderResults(cachedGames);
    return;
  }

  if (requestCount >= REQUEST_LIMIT) {
    setMessage(
      "Session request cap reached. Reuse prior searches or reload later.",
      true,
    );
    return;
  }

  searchButton.disabled = true;
  setMessage("Searching...");

  try {
    const response = await fetch(buildSearchURL(query), {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    requestCount += 1;

    if (!response.ok) {
      setMessage(httpErrorText(response.status), true);
      return;
    }

    const data = await response.json();
    const games = Array.isArray(data.results) ? data.results : [];
    cache.set(key, games);
    currentResults = games;
    renderResults(games);
  } catch {
    setMessage("Network error. Check your connection and try again.", true);
  } finally {
    searchButton.disabled = false;
  }
}

// Uses encoded game ID as Firebase key-safe path segment.
function favoriteKey(game) {
  return encodeURIComponent(String(getGameId(game)));
}

// Updates favorite star visual state and accessibility attributes.
function setStarState(starBtn, isFavorite) {
  starBtn.classList.toggle("active", isFavorite);
  starBtn.textContent = isFavorite ? "★" : "☆";
  starBtn.setAttribute(
    "aria-label",
    isFavorite ? "Remove from favorites" : "Add to favorites",
  );
  starBtn.setAttribute(
    "title",
    isFavorite ? "Remove from favorites" : "Add to favorites",
  );
  starBtn.setAttribute("aria-pressed", isFavorite ? "true" : "false");
}

// Writes favorite card metadata to Firebase.
async function saveFavoriteToFirebase(game) {
  const key = favoriteKey(game);
  await favoritesRef.child(key).set({
    gameId: String(getGameId(game)),
    favoritedAt: Date.now(),
    cached: {
      id: String(getGameId(game)),
      title: game.name || "Untitled Game",
      genre: Array.isArray(game.genres)
        ? game.genres.map((g) => (typeof g === "string" ? g : g?.name || "")).filter(Boolean).join(", ")
        : game.genre || "Unknown",
      platform: platformText(game),
      imageUrl: game.image || "",
      rating: typeof game?.rating?.mean === "number" ? (game.rating.mean * 10).toFixed(1) : null,
    },
  });
}

// Removes favorite entry from Firebase.
async function removeFavoriteFromFirebase(game) {
  const key = favoriteKey(game);
  await favoritesRef.child(key).remove();
}

// Event wiring for search, clear, and keyboard interactions.
searchButton.addEventListener("click", searchGames);
searchInput.addEventListener("input", () => {
  saveSearchQuery(searchInput.value);
  clearButton.style.display = searchInput.value ? "block" : "none";
});
searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchGames();
});
clearButton.addEventListener("click", () => {
  searchInput.value = "";
  saveSearchQuery("");
  clearButton.style.display = "none";
  resultsDiv.innerHTML = "";
  clearMessage();
  searchInput.focus();
});

restoreSearchQuery();
clearButton.style.display = searchInput.value ? "block" : "none";
setMessage("Ready. Search by game title or platform keyword.");
