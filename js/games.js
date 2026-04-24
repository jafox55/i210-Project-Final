// API configuration for catalog page requests.
const API_KEY = "177aade7624c44a48329961a32e26aa4";
const API_BASE_URL = "https://api.gamebrain.co/v1";
const CATALOG_COUNT = 20;

// Root container where catalog cards are rendered.
const gameContainer = document.getElementById("gameContainer");
let loadMoreTrigger = null;
let loadMoreObserver = null;
let isLoading = false;
let hasMoreGames = true;
let currentOffset = 0;
let totalResults = null;
const renderedIds = new Set();
let favoriteIds = new Set();

// Firebase configuration for shared favorites state.
const firebaseConfig = {
  apiKey: "AIzaSyBsFT1xZf_IgcfnBWIfh7Tt8jfRr-RZN4Q",
  authDomain: "my-team-project-8b98c.firebaseapp.com",
  databaseURL: "https://my-team-project-8b98c-default-rtdb.firebaseio.com",
  projectId: "my-team-project-8b98c",
  storageBucket: "my-team-project-8b98c.firebasestorage.app",
  messagingSenderId: "327995312132",
  appId: "1:327995312132:web:3dbd51c0e3c54ce33e8d51",
};

if (typeof firebase !== "undefined" && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const favoritesRef =
  typeof firebase !== "undefined" ? firebase.database().ref("favorites") : null;

// Formats API score from 0-1 scale to user-friendly 0-10 scale.
function scoreText(game) {
  return typeof game?.rating?.mean === "number"
    ? `${(game.rating.mean * 10).toFixed(1)}/10`
    : "N/A";
}

function gameId(game) {
  return game?.id || game?.game_id || game?._id || game?.slug || game?.name;
}

function gameName(game) {
  return String(game?.name || "").trim() || "Untitled Game";
}

// Chooses the primary platform text for a card.
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
  // Show only the first platform; fall back to genre from list endpoint
  return unique.length ? unique[0] : (sanitizeText(game.genre) || "Unknown");
}

// Sanitizes incoming text fields from the API payload.
function sanitizeText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Recursively scans game payloads to discover a description-like value.
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

// Utility used for handling API boolean-like values.
function toBool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

// Detects whether a game should be marked as adult-only.
function isAdultGame(game) {
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

// Stores extra template fields used by the details page fallback behavior.
function buildTemplateGameData(game) {
  return {
    ...game,
    template_short_description: sanitizeText(
      game.short_description || game["short description"] || game.shortDescription,
    ),
    template_description: sanitizeText(
      game.description || game.summary || game.overview || game.synopsis,
    ),
    template_discovered_description: findDescriptionCandidate(game),
  };
}

// Persists selected game data to session storage before navigation.
function saveSelectedGame(game) {
  try {
    sessionStorage.setItem("selectedGame", JSON.stringify(buildTemplateGameData(game)));
  } catch {
    // Ignore storage errors.
  }
}

// Converts an ID to a Firebase-safe key.
function favoriteKey(game) {
  return encodeURIComponent(String(gameId(game) || ""));
}

// Updates star button visuals and accessibility state.
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

// Saves a catalog game as a favorite in Firebase.
async function saveFavoriteToFirebase(game) {
  if (!favoritesRef) return;

  const key = favoriteKey(game);
  await favoritesRef.child(key).set({
    gameId: String(gameId(game)),
    favoritedAt: Date.now(),
    cached: {
      id: String(gameId(game)),
      title: gameName(game),
      genre: Array.isArray(game.genres)
        ? game.genres.map((g) => (typeof g === "string" ? g : g?.name || "")).filter(Boolean).join(", ")
        : game.genre || "Unknown",
      platform: platformText(game),
      imageUrl: game.image || "",
      rating: typeof game?.rating?.mean === "number" ? (game.rating.mean * 10).toFixed(1) : null,
      adultOnly: isAdultGame(game),
    },
  });
}

// Removes a catalog game from favorites in Firebase.
async function removeFavoriteFromFirebase(game) {
  if (!favoritesRef) return;

  const key = favoriteKey(game);
  await favoritesRef.child(key).remove();
}

// Syncs all currently rendered star buttons with latest favorites state.
function syncRenderedStarButtons() {
  if (!gameContainer) return;

  const stars = gameContainer.querySelectorAll(".favorite-star[data-game-id]");
  stars.forEach((starBtn) => {
    const id = String(starBtn.getAttribute("data-game-id") || "");
    setStarState(starBtn, favoriteIds.has(id));
  });
}

// Removes duplicate game entries by a normalized identifier.
function uniqueById(games) {
  const seen = new Set();
  const output = [];

  games.forEach((game) => {
    const id = String(gameId(game) || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    output.push(game);
  });

  return output;
}

// Fetches one catalog page with multiple sort parameter fallbacks.
async function fetchCatalogPage(offset) {
  const paramSets = [
    { limit: String(CATALOG_COUNT), offset: String(offset), sort: "-rating.count" },
    { limit: String(CATALOG_COUNT), offset: String(offset), ordering: "-rating.count" },
    { limit: String(CATALOG_COUNT), offset: String(offset), sort: "-rating.mean" },
    { limit: String(CATALOG_COUNT), offset: String(offset), ordering: "-rating.mean" },
    { limit: String(CATALOG_COUNT), offset: String(offset) },
  ];

  for (const paramSet of paramSets) {
    try {
      const params = new URLSearchParams(paramSet);
      const response = await fetch(`${API_BASE_URL}/games?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const results = Array.isArray(data?.results) ? uniqueById(data.results) : [];
      return {
        games: results.slice(0, CATALOG_COUNT),
        receivedCount: Array.isArray(data?.results) ? data.results.length : 0,
        totalResults: typeof data?.total_results === "number" ? data.total_results : null,
      };
    } catch {
      // Try next params set.
    }
  }

  return null;
}

// Builds one catalog card and wires the "View Entry" action.
function renderCard(game) {
  const card = document.createElement("article");
  card.className = "game-card";

  const id = encodeURIComponent(String(gameId(game) || ""));
  const name = gameName(game);
  const image = game.image || "https://via.placeholder.com/400x200?text=No+Image";
  const linkHref = `gamedetails.html?id=${id}&from=games`;
  const adult = isAdultGame(game);
  const rawGameId = String(gameId(game) || "");
  const isFavorite = favoriteIds.has(rawGameId);

  card.innerHTML = `
    <div class="thumb-wrap">
      <button
        class="favorite-star ${isFavorite ? "active" : ""}"
        type="button"
        data-game-id="${rawGameId}"
        aria-label="${isFavorite ? "Remove from favorites" : "Add to favorites"}"
        aria-pressed="${isFavorite ? "true" : "false"}"
        title="${isFavorite ? "Remove from favorites" : "Add to favorites"}"
      >
        ${isFavorite ? "★" : "☆"}
      </button>
      <img src="${image}" alt="${name}" loading="lazy" class="${adult ? "adult-thumb" : ""}" />
      ${adult ? '<span class="adult-badge">18+</span>' : ""}
    </div>
    <h3 class="game-title">${name}</h3>
    <p class="game-meta">Genre: ${platformText(game)} | Rating: ${scoreText(game)}</p>
    <a href="${linkHref}" class="view-entry">View Entry</a>
  `;

  const viewLink = card.querySelector(".view-entry");
  const starBtn = card.querySelector(".favorite-star");
  viewLink.addEventListener("click", () => saveSelectedGame(game));

  starBtn.addEventListener("click", async (event) => {
    event.stopPropagation();

    const nowFavorite = !favoriteIds.has(rawGameId);

    try {
      if (nowFavorite) {
        await saveFavoriteToFirebase(game);
        favoriteIds.add(rawGameId);
      } else {
        await removeFavoriteFromFirebase(game);
        favoriteIds.delete(rawGameId);
      }

      setStarState(starBtn, nowFavorite);
    } catch {
      // Keep current star state if Firebase update fails.
    }
  });

  return card;
}

// Displays a simple error card in the catalog container.
function renderError(text) {
  gameContainer.innerHTML = `<div class="card">${text}</div>`;
}

// Creates and inserts the infinite-scroll trigger element below the grid.
function ensureLoadMoreTrigger() {
  if (loadMoreTrigger || !gameContainer?.parentElement) return;

  loadMoreTrigger = document.createElement("div");
  loadMoreTrigger.className = "catalog-load-more";
  loadMoreTrigger.textContent = "";
  gameContainer.parentElement.appendChild(loadMoreTrigger);
}

// Updates helper text shown near the bottom of the catalog.
function setLoadMoreMessage(text) {
  if (!loadMoreTrigger) return;
  loadMoreTrigger.textContent = text;
}

// Renders only new, non-duplicate games into the catalog grid.
function appendGames(games) {
  let appended = 0;

  games.forEach((game) => {
    const id = String(gameId(game) || "");
    if (!id || renderedIds.has(id)) return;

    renderedIds.add(id);
    gameContainer.appendChild(renderCard(game));
    appended += 1;
  });

  return appended;
}

// Loads the next page and appends it, used by initial load + infinite scroll.
async function loadNextCatalogPage() {
  if (!gameContainer || isLoading || !hasMoreGames) return;

  isLoading = true;
  setLoadMoreMessage("Loading more games…");

  const page = await fetchCatalogPage(currentOffset);
  if (!page) {
    if (!renderedIds.size) {
      renderError("Unable to load games right now. Please try again shortly.");
    }
    setLoadMoreMessage("Could not load more games right now.");
    isLoading = false;
    return;
  }

  if (typeof page.totalResults === "number") {
    totalResults = page.totalResults;
  }

  currentOffset += page.receivedCount || CATALOG_COUNT;
  const appendedCount = appendGames(page.games);

  // Stop only when API returns no results.
  // (This API may cap page size below requested limit.)
  if (!page.receivedCount) {
    hasMoreGames = false;
  }

  // Stop when total count from API has been reached.
  if (typeof totalResults === "number" && currentOffset >= totalResults) {
    hasMoreGames = false;
  }

  if (!hasMoreGames) {
    setLoadMoreMessage(renderedIds.size ? "You've reached the end of the catalog." : "");
    if (loadMoreObserver && loadMoreTrigger) {
      loadMoreObserver.unobserve(loadMoreTrigger);
    }
  } else {
    setLoadMoreMessage(appendedCount ? "Scroll for more games" : "Loading more games…");
  }

  isLoading = false;
}

// Sets up viewport observer that requests more games near the page bottom.
function setupInfiniteScroll() {
  if (!loadMoreTrigger) return;

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadNextCatalogPage();
        }
      });
    },
    {
      root: null,
      rootMargin: "300px 0px",
      threshold: 0.01,
    },
  );

  loadMoreObserver.observe(loadMoreTrigger);
}

// Main page bootstrap: load, render, and handle empty/error states.
async function initCatalog() {
  if (!gameContainer) return;

  gameContainer.innerHTML = '<div class="card">Loading catalog…</div>';
  ensureLoadMoreTrigger();

  gameContainer.innerHTML = "";
  await loadNextCatalogPage();
  setupInfiniteScroll();
}

// Keep catalog stars synced with favorites changed on any page/tab.
if (favoritesRef) {
  favoritesRef.on("value", (snapshot) => {
    const value = snapshot.val() || {};
    favoriteIds = new Set(
      Object.values(value)
        .map((entry) => String(entry?.gameId || ""))
        .filter(Boolean),
    );

    syncRenderedStarButtons();
  });
}

// Start catalog page behavior on script load.
initCatalog();
