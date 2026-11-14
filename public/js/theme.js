// Loaded (not as a module) right after the stylesheet, so a chosen theme is in
// place before the first paint. "" = follow the device's light/dark setting.
(function () {
  var KEY = "ffrc_theme";
  var root = document.documentElement;
  function syncThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    var panel = getComputedStyle(root).getPropertyValue("--panel").trim();
    if (meta && panel) meta.setAttribute("content", panel);
  }
  function apply(value) {
    if (value === "light" || value === "dark") root.setAttribute("data-theme", value);
    else root.removeAttribute("data-theme");
    syncThemeColor();
  }
  function read() {
    try {
      return localStorage.getItem(KEY) || "";
    } catch (e) {
      return "";
    }
  }
  apply(read());
  if (window.matchMedia) {
    var media = window.matchMedia("(prefers-color-scheme: light)");
    if (media.addEventListener) media.addEventListener("change", syncThemeColor);
  }
  window.ffrcTheme = {
    get: read,
    set: function (value) {
      try {
        if (value) localStorage.setItem(KEY, value);
        else localStorage.removeItem(KEY);
      } catch (e) {
        /* storage unavailable: still applies for this visit */
      }
      apply(value);
    }
  };
})();
