// Creator-Seite: Angemeldete Besucher sehen bis zur Prüfung nur den Ladehinweis statt kurz die Landingpage.
// Eigene Datei, weil die Sicherheitsregel (CSP script-src 'self') keine Inline-Skripte erlaubt.
(function () {
  try {
    var k = 'leaserun-creator-session-v1', v = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (v && JSON.parse(v).access_token) document.documentElement.classList.add('cr-auth');
  } catch (e) { /* ohne Speicher: Landingpage zeigen */ }
})();
