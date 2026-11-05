// Society Merch: tap a product photo to see every angle before buying.
(function () {
  var G = window.MERCH_GALLERY || {};
  var css =
    ".mi{position:relative;cursor:zoom-in}" +
    ".mi .gv{position:absolute;right:8px;bottom:8px;background:rgba(10,10,10,.78);color:#fff;font:600 .72rem/1 system-ui,sans-serif;letter-spacing:.04em;padding:7px 10px;border:0;cursor:pointer}" +
    ".mgx{position:fixed;inset:0;z-index:9999;background:rgba(10,10,10,.97);display:none;flex-direction:column;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}" +
    ".mgx.on{display:flex}" +
    ".mgx .mgw{position:relative;width:min(92vw,640px);max-height:72vh;display:flex;align-items:center;justify-content:center;background:#fff}" +
    ".mgx .mgw img{display:block;max-width:100%;max-height:72vh;object-fit:contain}" +
    ".mgx .mgc{position:absolute;top:10px;right:12px;background:none;border:0;color:#fff;font-size:2rem;line-height:1;cursor:pointer}" +
    ".mgx .mgn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(10,10,10,.6);color:#fff;border:0;width:42px;height:42px;font-size:1.4rem;cursor:pointer}" +
    ".mgx .mgp{left:6px}.mgx .mgq{right:6px}" +
    ".mgx .mgt{display:flex;gap:6px;margin-top:10px;max-width:min(92vw,640px);overflow-x:auto;padding-bottom:4px}" +
    ".mgx .mgt img{width:58px;height:58px;object-fit:cover;background:#fff;opacity:.55;cursor:pointer;border:2px solid transparent;flex:0 0 auto}" +
    ".mgx .mgt img.on{opacity:1;border-color:#a8884a}" +
    ".mgx .mgh{color:#fff;font:600 1rem system-ui,sans-serif;margin:0 0 10px;text-align:center}" +
    ".mgx .mgl{color:#c9ad6e;font:.8rem system-ui,sans-serif;margin-top:6px;min-height:1em}" +
    ".mgx .mgb{margin-top:10px;background:#8f1b38;color:#fff;text-decoration:none;padding:11px 22px;font:600 .95rem system-ui,sans-serif}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  var box = document.createElement("div");
  box.className = "mgx";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML =
    '<button class="mgc" aria-label="Close">&times;</button><p class="mgh"></p>' +
    '<div class="mgw"><img alt=""><button class="mgn mgp" aria-label="Previous">&#8249;</button><button class="mgn mgq" aria-label="Next">&#8250;</button></div>' +
    '<p class="mgl"></p><div class="mgt"></div><a class="mgb" target="_blank" rel="noopener">Buy &rarr;</a>';
  document.body.appendChild(box);
  var big = box.querySelector(".mgw img"), thumbs = box.querySelector(".mgt"), lab = box.querySelector(".mgl");
  var list = [], idx = 0;

  function show(i) {
    idx = (i + list.length) % list.length;
    big.src = list[idx].u;
    big.alt = list[idx].t || "";
    lab.textContent = list[idx].t || "";
    [].forEach.call(thumbs.children, function (t, j) { t.className = j === idx ? "on" : ""; });
    var multi = list.length > 1;
    box.querySelector(".mgp").style.display = box.querySelector(".mgq").style.display = multi ? "" : "none";
    thumbs.style.display = multi ? "" : "none";
  }
  function open(card, imgs) {
    list = imgs;
    box.querySelector(".mgh").textContent = (card.querySelector("h3") || {}).textContent || "";
    var b = card.querySelector("a.btn");
    box.querySelector(".mgb").href = b ? b.href : "#";
    thumbs.innerHTML = "";
    imgs.forEach(function (im, j) {
      var t = document.createElement("img");
      t.src = im.u; t.alt = im.t || ""; t.loading = "lazy";
      t.onclick = function () { show(j); };
      thumbs.appendChild(t);
    });
    show(0);
    box.classList.add("on");
    document.body.style.overflow = "hidden";
  }
  function close() { box.classList.remove("on"); document.body.style.overflow = ""; }
  box.querySelector(".mgc").onclick = close;
  box.onclick = function (e) { if (e.target === box) close(); };
  box.querySelector(".mgp").onclick = function () { show(idx - 1); };
  box.querySelector(".mgq").onclick = function () { show(idx + 1); };
  document.addEventListener("keydown", function (e) {
    if (!box.classList.contains("on")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(idx - 1);
    if (e.key === "ArrowRight") show(idx + 1);
  });
  var sx = null;
  big.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
  big.addEventListener("touchend", function (e) {
    if (sx === null) return;
    var dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
    sx = null;
  });

  [].forEach.call(document.querySelectorAll("article.mc"), function (card) {
    var a = card.querySelector("a.btn"), mi = card.querySelector(".mi"), main = mi && mi.querySelector("img");
    if (!a || !mi || !main) return;
    var key = a.href.split("/").pop();
    var imgs = (G[key] || []).slice();
    if (!imgs.length || imgs[0].u !== main.src) imgs.unshift({ u: main.src, t: "" });
    var seen = {};
    imgs = imgs.filter(function (x) { if (seen[x.u]) return false; seen[x.u] = 1; return true; });
    if (imgs.length > 1) {
      var btn = document.createElement("button");
      btn.className = "gv";
      btn.type = "button";
      btn.textContent = "View " + imgs.length + " photos";
      mi.appendChild(btn);
    }
    mi.addEventListener("click", function () { open(card, imgs); });
  });
})();
