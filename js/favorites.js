// Firebase project configuration for shared favorites data.
const firebaseConfig = {
    apiKey: "AIzaSyBsFT1xZf_IgcfnBWIfh7Tt8jfRr-RZN4Q",
    authDomain: "my-team-project-8b98c.firebaseapp.com",
    databaseURL: "https://my-team-project-8b98c-default-rtdb.firebaseio.com",
    projectId: "my-team-project-8b98c",
    storageBucket: "my-team-project-8b98c.firebasestorage.app",
    messagingSenderId: "327995312132",
    appId: "1:327995312132:web:3dbd51c0e3c54ce33e8d51"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();
const favoritesRef = database.ref('favorites');

// API configuration used to enrich favorites by game ID.
const GAME_API_BASE_URL = 'https://api.gamebrain.co/v1/games';
const GAME_API_KEY = '177aade7624c44a48329961a32e26aa4';

// DOM targets used for filtering + rendering favorites.
const catalogGrid = document.getElementById('catalog-grid');
const searchInput = document.getElementById('search-input');
const statusModal = document.getElementById('status-modal');
const statusSelect = document.getElementById('status-select');
const statusSaveButton = document.getElementById('status-save');
const statusCancelButton = document.getElementById('status-cancel');
const statusModalGame = document.getElementById('status-modal-game');

// In-memory state for current favorites, cached API lookups, and pending requests.
let favorites = {};
const gameCache = {};
const pendingLookups = new Set();
let editingStatusGameId = null;

const STATUS_OPTIONS = ['playing', 'wishlist', 'completed'];

// Builds a detail endpoint URL for one game ID.
function buildGameApiUrl(gameId) {
    const base = GAME_API_BASE_URL.replace(/\/$/, '');
    return `${base}/${encodeURIComponent(gameId)}`;
}

// Converts different rating payload shapes into a consistent 0-10 string.
function normalizeRatingValue(rawRating) {
    if (typeof rawRating === 'number') {
        return rawRating <= 1 ? (rawRating * 10).toFixed(1) : rawRating.toFixed(1);
    }

    if (rawRating && typeof rawRating.mean === 'number') {
        return (rawRating.mean * 10).toFixed(1);
    }

    return null;
}

// Normalizes truthy values that may come as booleans, numbers, or strings.
function toBool(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

// Detects adult-only flag from several possible API/favorite object shapes.
function isAdultGame(game) {
    if (!game || typeof game !== 'object') {
        return false;
    }

    if (toBool(game.adultOnly) || toBool(game.adult_only)) {
        return true;
    }

    if (toBool(game?.tag?.adult_only) || toBool(game?.tags?.adult_only)) {
        return true;
    }

    if (Array.isArray(game.tags)) {
        return game.tags.some((tag) => {
            if (typeof tag === 'string') {
                return tag.toLowerCase() === 'adult_only';
            }

            return tag && typeof tag === 'object' && toBool(tag.adult_only);
        });
    }

    return false;
}

function normalizeStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return STATUS_OPTIONS.includes(normalized) ? normalized : 'wishlist';
}

function statusLabel(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'playing') return 'Playing';
    if (normalized === 'completed') return 'Completed';
    return 'Wishlist';
}

// Normalizes raw API payload to the card shape expected by this page.
function normalizeGameFromApi(payload, fallbackId) {
    if (!payload) {
        return null;
    }

    const game = payload.data || payload;
    const normalizedId = String(game.id ?? game.gameId ?? fallbackId);

    const genres = Array.isArray(game.genres)
        ? game.genres.map((genre) => genre.name || genre).filter(Boolean).join(', ')
        : game.genre || 'Unknown';

    const platforms = Array.isArray(game.platforms)
        ? game.platforms
            .map((platform) => platform.name || platform.platform?.name || platform)
            .filter(Boolean)
            .join(', ')
        : game.platform || 'Unknown';

    return {
        id: normalizedId,
        title: game.title || game.name || `Game #${normalizedId}`,
        genre: genres,
        platform: platforms,
        imageUrl: game.coverUrl || game.image || game.background_image || game.thumbnail || '',
        rating: normalizeRatingValue(game.rating),
        adultOnly: isAdultGame(game)
    };
}

// Fetches one game by ID and memoizes it in the local cache.
async function fetchGameById(gameId) {
    if (gameCache[gameId]) {
        return gameCache[gameId];
    }

    if (!GAME_API_BASE_URL.includes('your-api.example.com')) {
        try {
            const response = await fetch(buildGameApiUrl(gameId), {
                headers: {
                    Authorization: `Bearer ${GAME_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                return null;
            }

            const payload = await response.json();
            const normalized = normalizeGameFromApi(payload, gameId);
            if (normalized) {
                gameCache[gameId] = normalized;
            }

            return normalized;
        } catch {
            return null;
        }
    }

    return null;
}

// Builds one favorites card, including optional adult overlay + image fallback.
function createGameCard(gameId, favoriteEntry, resolvedGame) {
    const game = resolvedGame || favoriteEntry.cached || {
        id: gameId,
        title: `Game #${gameId}`,
        genre: 'Unknown',
        platform: 'Unknown',
        imageUrl: '',
        rating: null,
        adultOnly: false
    };
    const isAdult = isAdultGame(game) || isAdultGame(favoriteEntry) || isAdultGame(favoriteEntry?.cached);

    const card = document.createElement('article');
    card.className = 'game-card';

    const cover = document.createElement('div');
    cover.className = 'game-cover';
    const fallbackCoverText = `${game.title || `Game #${gameId}`} cover art unavailable`;

    if (game.imageUrl) {
        const image = document.createElement('img');
        image.src = game.imageUrl;
        image.alt = `${game.title} cover art`;
        image.loading = 'lazy';
        if (isAdult) {
            image.classList.add('adult-thumb');
        }
        image.onerror = () => {
            image.remove();
            cover.classList.add('no-image');
            cover.textContent = fallbackCoverText;
        };
        cover.appendChild(image);
    } else {
        cover.classList.add('no-image');
        cover.textContent = fallbackCoverText;
    }

    if (isAdult) {
        const badge = document.createElement('span');
        badge.className = 'adult-badge';
        badge.textContent = '18+';
        cover.appendChild(badge);
    }

    const content = document.createElement('div');
    content.className = 'game-content';

    const title = document.createElement('h3');
    title.textContent = game.title;

    const meta = document.createElement('div');
    meta.className = 'game-meta';

    const idPill = document.createElement('span');
    idPill.className = 'pill';
    idPill.textContent = `ID: ${gameId}`;

    const statusPill = document.createElement('span');
    const currentStatus = normalizeStatus(favoriteEntry?.status);
    statusPill.className = `pill status-pill status-${currentStatus}`;
    statusPill.textContent = statusLabel(currentStatus);

    meta.append(idPill, statusPill);

    const details = document.createElement('div');
    details.className = 'game-details';

    const platformDetail = document.createElement('span');
    platformDetail.textContent = `Platform: ${game.platform || 'Unknown'}`;

    const genreDetail = document.createElement('span');
    genreDetail.textContent = `Genre: ${game.genre || 'Unknown'}`;

    const ratingDetail = document.createElement('span');
    ratingDetail.textContent = `Rating: ${game.rating ? `${game.rating}/10` : 'Unrated'}`;

    details.append(platformDetail, genreDetail, ratingDetail);

    const actions = document.createElement('div');
    actions.className = 'game-actions';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'card-button delete-btn';
    deleteButton.textContent = 'Unfavorite';
    deleteButton.addEventListener('click', () => removeFavorite(gameId));

    const editStatusButton = document.createElement('button');
    editStatusButton.type = 'button';
    editStatusButton.className = 'card-button edit-status-btn';
    editStatusButton.textContent = 'Edit status';
    editStatusButton.addEventListener('click', () => openStatusEditor(gameId, game.title, currentStatus));

    actions.append(editStatusButton, deleteButton);
    content.append(meta, title, details, actions);
    card.append(cover, content);

    return card;
}

function openStatusEditor(gameId, gameTitle, currentStatus) {
    if (!statusModal || !statusSelect || !statusModalGame) {
        return;
    }

    editingStatusGameId = gameId;
    statusSelect.value = normalizeStatus(currentStatus);
    statusModalGame.textContent = gameTitle ? `Game: ${gameTitle}` : `Game ID: ${gameId}`;
    statusModal.classList.remove('hidden');
}

function closeStatusEditor() {
    if (!statusModal) {
        return;
    }

    editingStatusGameId = null;
    statusModal.classList.add('hidden');
}

async function saveStatusChange() {
    if (!editingStatusGameId || !statusSelect) {
        return;
    }

    const status = normalizeStatus(statusSelect.value);
    await favoritesRef.child(editingStatusGameId).update({
        status,
        statusUpdatedAt: Date.now()
    });

    closeStatusEditor();
}

// Renders favorites list with client-side filtering and empty-state handling.
function renderGames() {
    const searchValue = searchInput.value.trim().toLowerCase();

    const favoriteList = Object.entries(favorites)
        .map(([gameId, favorite]) => ({ gameId, ...favorite }))
        .sort((first, second) => first.gameId.localeCompare(second.gameId));

    const filteredFavorites = favoriteList.filter((favorite) => {
        const resolvedGame = gameCache[favorite.gameId] || favorite.cached;
        const title = resolvedGame?.title || '';
        const matchesSearch =
            !searchValue ||
            favorite.gameId.toLowerCase().includes(searchValue) ||
            title.toLowerCase().includes(searchValue);
        return matchesSearch;
    });

    catalogGrid.innerHTML = '';

    if (!filteredFavorites.length) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<h3>No favorites yet</h3><p>Favorite a game from the Search page to store it.</p>';
        catalogGrid.appendChild(emptyState);
        return;
    }

    filteredFavorites.forEach((favorite) => {
        const resolvedGame = gameCache[favorite.gameId] || favorite.cached || null;
        catalogGrid.appendChild(createGameCard(favorite.gameId, favorite, resolvedGame));

        if (!resolvedGame) {
            resolveFavoriteFromApi(favorite.gameId);
        }
    });
}

// Lazily resolves missing favorite metadata from the API and syncs it back to Firebase.
async function resolveFavoriteFromApi(gameId) {
    if (pendingLookups.has(gameId)) {
        return;
    }

    pendingLookups.add(gameId);
    const resolved = await fetchGameById(gameId);

    if (resolved) {
        favoritesRef.child(gameId).update({
            cached: resolved,
            syncedAt: Date.now()
        });
    }

    pendingLookups.delete(gameId);
}

// Removes favorite entry from Firebase and local cache.
function removeFavorite(gameId) {
    favoritesRef.child(gameId).remove();
    delete gameCache[gameId];
}

// Input filtering + realtime Firebase updates.
searchInput.addEventListener('input', renderGames);

if (statusCancelButton) {
    statusCancelButton.addEventListener('click', closeStatusEditor);
}

if (statusModal) {
    statusModal.addEventListener('click', (event) => {
        if (event.target === statusModal) {
            closeStatusEditor();
        }
    });
}

if (statusSaveButton) {
    statusSaveButton.addEventListener('click', async () => {
        try {
            await saveStatusChange();
        } catch {
            // Keep modal open on failure; UI will refresh on next successful save.
        }
    });
}

favoritesRef.on('value', (snapshot) => {
    favorites = snapshot.val() || {};
    renderGames();
});

// Initial paint to show empty-state before first Firebase snapshot arrives.
renderGames();