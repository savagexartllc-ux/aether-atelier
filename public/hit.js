// Gilt Society visit counter: page views and merch Buy clicks. No cookies, no personal data.
(function () {
  function send(d) {
    try {
      var body = JSON.stringify(d);
      if (navigator.sendBeacon) navigator.sendBeacon("/api/hit", new Blob([body], { type: "application/json" }));
      else fetch("/api/hit", { method: "POST", body: body, keepalive: true });
    } catch (e) {}
  }
  var first = 0, src = "", ref = null;
  try {
    if (!sessionStorage.getItem("gs-s")) { first = 1; sessionStorage.setItem("gs-s", "1"); }
    var q = new URLSearchParams(location.search);
    src = q.get("utm_source") || q.get("src") || sessionStorage.getItem("gs-src") || "";
    if (src) sessionStorage.setItem("gs-src", src);
    if (first) sessionStorage.setItem("gs-ref", document.referrer || "");
    ref = sessionStorage.getItem("gs-ref");
  } catch (e) {}
  if (ref == null) ref = document.referrer;
  send({ k: "view", p: location.pathname, r: document.referrer, u: src, s: first });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href*="buy.stripe.com"]');
    if (!a) return;
    var card = a.closest("article");
    var name = card && card.querySelector("h3") ? card.querySelector("h3").textContent : "";
    if (!name) { var h = document.querySelector(".mgx .mgh"); name = h ? h.textContent : ""; }
    send({ k: "buy", p: location.pathname, r: ref, u: src, i: name || a.href.split("/").pop() });
  }, true);
})();
