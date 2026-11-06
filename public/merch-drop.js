// Home page: "New merch is dropping" announcement. Shows once every few days per visitor.
(function () {
  var KEY = "gs-merch-drop-v1", DAYS = 3;
  try {
    var last = +localStorage.getItem(KEY) || 0;
    if (Date.now() - last < DAYS * 864e5) return;
  } catch (e) {}
  var css =
    ".mdx{position:fixed;inset:0;z-index:9998;background:rgba(10,10,10,.72);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;opacity:0;transition:opacity .35s}" +
    ".mdx.on{opacity:1}" +
    ".mdx .mdc{position:relative;width:min(100%,420px);background:#0a0a0a;color:#fff;border:1px solid #a8884a;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;font-family:Georgia,serif}" +
    ".mdx .mdi{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;object-position:center 25%}" +
    ".mdx .mdb{padding:20px 22px 22px;text-align:center}" +
    ".mdx .mdk{margin:0 0 6px;color:#c9ad6e;font:600 .72rem/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase}" +
    ".mdx h2{margin:0 0 8px;font:600 1.55rem/1.15 Cinzel,'Bodoni Moda',Georgia,serif;letter-spacing:.04em}" +
    ".mdx p.mdt{margin:0 0 16px;color:#e8e2d6;font-size:.98rem;line-height:1.45}" +
    ".mdx .mdg{display:inline-block;background:#8f1b38;color:#fff;text-decoration:none;padding:12px 24px;font:600 .95rem system-ui,sans-serif;letter-spacing:.03em}" +
    ".mdx .mdg:hover{background:#4a0c1a}" +
    ".mdx .mdn{display:block;margin:12px auto 0;background:none;border:0;color:#bfb6a5;font:.85rem system-ui,sans-serif;cursor:pointer;text-decoration:underline}" +
    ".mdx .mdx-x{position:absolute;top:6px;right:8px;background:rgba(10,10,10,.6);border:0;color:#fff;font-size:1.6rem;line-height:1;width:36px;height:36px;cursor:pointer}" +
    ".mdx .mde{color:#c9ad6e;letter-spacing:.35em;margin:0 0 12px;font-size:.9rem}";
  function show() {
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    var d = document.createElement("div");
    d.className = "mdx";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-label", "New merch announcement");
    d.innerHTML =
      '<div class="mdc"><button class="mdx-x" aria-label="Close">&times;</button>' +
      '<img class="mdi" src="img/persephone-art.jpg" alt="Persephone, original painting by Lauren">' +
      '<div class="mdb"><p class="mdk">Society Merch</p><h2>New merch is dropping</h2>' +
      '<p class="mde">&#9651; &#9651; &#9661; &#9661;</p>' +
      '<p class="mdt">The Persephone Edition and Gilt Society. pieces: embroidered caps, tees, hoodies, mugs and more. Made to order.</p>' +
      '<a class="mdg" href="merch.html">Shop Society Merch &rarr;</a>' +
      '<button class="mdn" type="button">Maybe later</button></div></div>';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add("on"); });
    function close() {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      d.classList.remove("on");
      setTimeout(function () { d.remove(); }, 350);
      document.removeEventListener("keydown", esc);
    }
    function esc(e) { if (e.key === "Escape") close(); }
    d.querySelector(".mdx-x").onclick = close;
    d.querySelector(".mdn").onclick = close;
    d.querySelector(".mdg").addEventListener("click", function () { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} });
    d.addEventListener("click", function (e) { if (e.target === d) close(); });
    document.addEventListener("keydown", esc);
    d.querySelector(".mdg").focus({ preventScroll: true });
  }
  setTimeout(show, 1200);
})();
