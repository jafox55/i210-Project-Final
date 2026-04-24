// Shared 18+ mask toggle for pages that display game cards/details.
//
// Behavior summary:
// 1) Read a saved preference from localStorage.
// 2) Add/remove a class on <body> that controls blur/badge visibility via CSS.
// 3) Render one toggle UI near the page heading.
// 4) Persist changes so the setting carries across pages and reloads.

// Storage key used across the site.
const ADULT_MASK_PREF_KEY = "gamearchive:adultMaskDisabled";

// Reads saved preference; defaults to false (mask ON) when unset/unavailable.
function readAdultMaskPreference() {
  try {
    return localStorage.getItem(ADULT_MASK_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

// Saves preference safely; storage errors are ignored to avoid UI breakage.
function saveAdultMaskPreference(isDisabled) {
  try {
    localStorage.setItem(ADULT_MASK_PREF_KEY, String(isDisabled));
  } catch {
    // Ignore storage errors (private mode/quota/etc.).
  }
}

// Applies preference by toggling a single class on <body>.
// CSS listens to this class and disables blur + 18+ badge when active.
function applyAdultMaskPreference(isDisabled) {
  document.body.classList.toggle("adult-mask-disabled", isDisabled);
}

// Finds a sensible host area to place the toggle.
// Catalog/Search pages use .catalog-section; details uses .details-section;
// favorites uses .favorites-shell.
function findToggleHost() {
  return (
    document.querySelector(".catalog-section") ||
    document.querySelector(".details-section") ||
    document.querySelector(".favorites-shell")
  );
}

// Creates and inserts the toggle UI once per page.
function renderAdultMaskToggle(initiallyDisabled) {
  const host = findToggleHost();
  if (!host) return;

  // Prevent duplicate insertion if this script ever runs more than once.
  if (host.querySelector(".adult-visibility-toggle")) return;

  const label = document.createElement("label");
  label.className = "adult-visibility-toggle";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = initiallyDisabled;
  checkbox.setAttribute("aria-label", "Disable 18+ blur and badge");

  const text = document.createElement("span");
  text.textContent = "Disable 18+ blur and badge";

  label.append(checkbox, text);
  host.appendChild(label);

  // Keep page + storage in sync whenever the user changes the toggle.
  checkbox.addEventListener("change", () => {
    applyAdultMaskPreference(checkbox.checked);
    saveAdultMaskPreference(checkbox.checked);
  });
}

// Entry point for this file.
(function initAdultMaskToggle() {
  const isDisabled = readAdultMaskPreference();
  applyAdultMaskPreference(isDisabled);
  renderAdultMaskToggle(isDisabled);
})();
