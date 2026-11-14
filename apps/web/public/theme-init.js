/* Runs before React/CSS so the first paint already matches the saved theme. */
(function () {
  try {
    var preference = 'system';
    var raw = localStorage.getItem('nh-auth-cache');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.user && parsed.user.prefs && parsed.user.prefs.theme) {
        preference = parsed.user.prefs.theme;
      }
    }
    if (preference === 'system') preference = localStorage.getItem('nh-theme') || 'system';
    var dark = preference === 'dark' || (preference === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    var motion = localStorage.getItem('nh-reduce-motion');
    if (motion !== null) document.documentElement.dataset.reduceMotion = motion === 'true' ? 'true' : 'false';
  } catch (_) {
    /* storage may be unavailable; the default theme still applies */
  }
})();
