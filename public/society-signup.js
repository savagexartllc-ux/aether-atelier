// Join the Society: email sign-up pop-up (replaces the merch-drop announcement). Shows once every few days per visitor.
(function () {
  var KEY = "gs-signup-v1", DAYS = 4, DONE = "gs-signup-done";
  try {
    if (localStorage.getItem(DONE)) return;
    var last = +localStorage.getItem(KEY) || 0;
    if (Date.now() - last < DAYS * 864e5) return;
  } catch (e) {}
  var css =
    ".gsx{position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,10,.72);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;opacity:0;transition:opacity .35s}" +
    ".gsx.on{opacity:1}" +
    ".gsx .c{position:relative;width:min(100%,420px);background:#0a0a0a;color:#fff;border:1px solid #a8884a;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;font-family:Georgia,serif}" +
    ".gsx .i{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}" +
    ".gsx .b{padding:20px 22px 22px;text-align:center}" +
    ".gsx .k{margin:0 0 6px;color:#c9ad6e;font:600 .72rem/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase}" +
    ".gsx h2{margin:0 0 8px;font:600 1.5rem/1.15 Cinzel,'Bodoni Moda',Georgia,serif;letter-spacing:.04em}" +
    ".gsx p.t{margin:0 0 14px;color:#e8e2d6;font-size:.98rem;line-height:1.45}" +
    ".gsx input{display:block;width:100%;box-sizing:border-box;margin:0 0 8px;padding:12px 12px;border:1px solid #a8884a;background:#141414;color:#fff;font:1rem system-ui,sans-serif}" +
    ".gsx input::placeholder{color:#9b9488}" +
    ".gsx .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}" +
    ".gsx .g{display:block;width:100%;border:0;background:#8f1b38;color:#fff;padding:13px 20px;font:600 .95rem system-ui,sans-serif;letter-spacing:.03em;cursor:pointer}" +
    ".gsx .g:hover{background:#4a0c1a}.gsx .g[disabled]{opacity:.6}" +
    ".gsx .f{margin:10px 0 0;color:#9b9488;font:.75rem/1.4 system-ui,sans-serif}" +
    ".gsx .e{color:#e8a0a0;font:.85rem system-ui,sans-serif;min-height:1em;margin:4px 0 0}" +
    ".gsx .code{display:inline-block;margin:6px 0 10px;padding:10px 18px;border:1px dashed #c9ad6e;color:#c9ad6e;font:600 1.3rem Cinzel,Georgia,serif;letter-spacing:.12em}" +
    ".gsx .n{display:block;margin:12px auto 0;background:none;border:0;color:#bfb6a5;font:.85rem system-ui,sans-serif;cursor:pointer;text-decoration:underline}" +
    ".gsx .x{position:absolute;top:6px;right:8px;background:rgba(10,10,10,.6);border:0;color:#fff;font-size:1.6rem;line-height:1;width:36px;height:36px;cursor:pointer}" +
    ".gsx .el{color:#c9ad6e;letter-spacing:.35em;margin:0 0 10px;font-size:.9rem}";
  function show() {
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var d = document.createElement("div");
    d.className = "gsx"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "Join the Society");
    d.innerHTML =
      '<div class="c"><button class="x" aria-label="Close">&times;</button>' +
      '<img class="i" src="/img/home/room-iris-rug.jpg?v=2" alt="The Iris rug in a styled living room">' +
      '<div class="b"><p class="k">Gilt Society.</p><h2>Join the Society</h2>' +
      '<p class="el">&#9651; &#9651; &#9661; &#9661;</p>' +
      '<p class="t">First look at new paintings and drops, plus <b>15% off</b> your first order.</p>' +
      '<form novalidate><input name="name" type="text" autocomplete="given-name" placeholder="First name (optional)" maxlength="60">' +
      '<input name="email" type="email" autocomplete="email" placeholder="Email address" required maxlength="200">' +
      '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="g" type="submit">Join &amp; get 15% off</button><p class="e" role="alert"></p></form>' +
      '<p class="f">By joining you agree to get Gilt Society. emails about drops and offers. Unsubscribe anytime. We never share your email.</p>' +
      '<button class="n" type="button">No thanks</button></div></div>';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add("on"); });
    function close() {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      d.classList.remove("on"); setTimeout(function () { d.remove(); }, 350);
      document.removeEventListener("keydown", esc);
    }
    function esc(e) { if (e.key === "Escape") close(); }
    d.querySelector(".x").onclick = close; d.querySelector(".n").onclick = close;
    d.addEventListener("click", function (e) { if (e.target === d) close(); });
    document.addEventListener("keydown", esc);
    var form = d.querySelector("form"), err = d.querySelector(".e"), btn = d.querySelector(".g");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = "Please enter a valid email."; return; }
      btn.disabled = true; err.textContent = "";
      fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, name: form.name.value.trim(), website: form.website.value, source: "popup", page: location.pathname }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) throw 0;
          try { localStorage.setItem(DONE, "1"); } catch (e) {}
          d.querySelector(".b").innerHTML = '<p class="k">Welcome to the Society</p><h2>You’re in.</h2>' +
            '<p class="t">Here’s 15% off your first order. Enter it at checkout:</p><div class="code">WELCOME15</div>' +
            '<p class="t" style="margin-top:8px">Use it once, on your first order. Screenshot it so you have it.</p>' +
            '<a class="g" style="text-decoration:none" href="/merch.html">Shop Society Merch &rarr;</a>';
        })
        .catch(function () { btn.disabled = false; err.textContent = "Something went wrong. Please try again."; });
    });
  }
  setTimeout(show, 6000);
})();
