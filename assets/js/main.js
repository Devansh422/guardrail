/* ==========================================================================
   Guardrail landing page behaviour
   ========================================================================== */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGSAP = typeof window.gsap !== "undefined";
  if (hasGSAP && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  var PAL = { cream: "#FBF5DD", sand: "#E7E1B1", moss: "#306D29", forest: "#0D530E", bg: "#000000" };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var round = function (v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; };

  /* ------------------------------------------------------------ hero bg -- */
  function heroBackground() {
    if (typeof window.InstancedMouseEffect !== "function") return;
    var fx;
    try {
      fx = new window.InstancedMouseEffect({
        speed: 0.85,
        frequency: 0.9,
        mouseSize: 1.15,
        rotationSpeed: 0,
        rotationAmmount: 0,
        mouseScaling: 0.3,
        mouseIndent: 1.15,
        color: PAL.moss,
        colorDegrade: 1.15,
        shape: "square"
      });
    } catch (e) { return; }

    if (fx && fx.rendering && fx.rendering.renderer) {
      fx.rendering.renderer.setClearColor(PAL.bg, 1);
    }

    // Stop drawing the hero once it has scrolled away.
    if (!fx || !fx.rendering || !("IntersectionObserver" in window)) return;
    var real = fx.rendering.render.bind(fx.rendering);
    var noop = function () {};
    var hero = $(".hero");
    if (!hero) return;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { fx.rendering.render = en.isIntersecting ? real : noop; });
    }, { threshold: 0.01 }).observe(hero);
  }

  /* ---------------------------------------------------------- footer bg -- */
  function footerBackground() {
    var host = $("#app");
    // App and the distortion presets are top-level lexical declarations in the
    // vendor scripts, so they live on the global scope but not on window.
    var AppCtor = (typeof App === "function") ? App : null;
    var distortion = (typeof LongRaceDistortion !== "undefined") ? LongRaceDistortion : null;
    if (!host || !AppCtor || !distortion) return;

    var app = new AppCtor(host, {
      distortion: distortion,
      length: 400,
      roadWidth: 10,
      islandWidth: 5,
      lanesPerRoad: 2,
      fov: 90,
      fovSpeedUp: 150,
      speedUp: 2,
      carLightsFade: 0.4,
      totalSideLightSticks: 50,
      lightPairsPerRoadWay: 70,
      shoulderLinesWidthPercentage: 0.05,
      brokenLinesWidthPercentage: 0.1,
      brokenLinesLengthPercentage: 0.5,
      lightStickWidth: [0.12, 0.5],
      lightStickHeight: [1.3, 1.7],
      movingAwaySpeed: [60, 80],
      movingCloserSpeed: [-120, -160],
      carLightsLength: [400 * 0.05, 400 * 0.15],
      carLightsRadius: [0.05, 0.14],
      carWidthPercentage: [0.3, 0.5],
      carShiftX: [-0.2, 0.2],
      carFloorSeparation: [0.05, 1],
      colors: {
        roadColor: 0x000000,
        islandColor: 0x000000,
        background: 0x000000,
        shoulderLines: 0x0d530e,
        brokenLines: 0x0d530e,
        leftCars: [0xfbf5dd, 0xe7e1b1, 0xfbf5dd],
        rightCars: [0x306d29, 0xe7e1b1, 0x306d29],
        sticks: 0xe7e1b1
      }
    });

    app.loadAssets().then(function () {
      app.init();
      // Only burn frames while the footer is actually on screen.
      if (!("IntersectionObserver" in window)) return;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            if (app.disposed) { app.disposed = false; app.clock.getDelta(); app.tick(); }
          } else {
            app.disposed = true;
          }
        });
      }, { threshold: 0.01 });
      io.observe(host);
    });
  }

  /* ------------------------------------------------------- split + reveal - */
  function splitLines(el) {
    var words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    var frag = document.createDocumentFragment();
    words.forEach(function (w, i) {
      var s = document.createElement("span");
      s.className = "wd";
      s.style.display = "inline-block";
      s.style.overflow = "hidden";
      s.style.verticalAlign = "top";
      var inner = document.createElement("i");
      inner.style.display = "inline-block";
      inner.style.fontStyle = "normal";
      inner.textContent = w;
      s.appendChild(inner);
      frag.appendChild(s);
      if (i < words.length - 1) frag.appendChild(document.createTextNode(" "));
    });
    el.appendChild(frag);
    return $$("i", el);
  }

  var heroParts = null;

  function inHero(el) { var h = $(".hero"); return !!(h && h.contains(el)); }

  function reveals() {
    $$("[data-split]").forEach(function (el) {
      var parts = splitLines(el);
      if (!hasGSAP || REDUCED) return;
      gsap.set(parts, { yPercent: 108 });
      if (inHero(el)) { heroParts = parts; return; }
      gsap.to(parts, {
        yPercent: 0,
        duration: 1.05,
        ease: "expo.out",
        stagger: 0.045,
        scrollTrigger: { trigger: el, start: "top 88%" }
      });
    });

    if (!hasGSAP || REDUCED) return;

    $$("[data-fade]").forEach(function (el) {
      if (inHero(el)) { gsap.set(el, { y: 26, opacity: 0 }); return; }
      gsap.from(el, {
        y: 26, opacity: 0, duration: 1, ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 90%" }
      });
    });

    $$(".fact").forEach(function (el) { gsap.set(el, { y: 24, opacity: 0 }); });
    gsap.set(".hero__cue", { opacity: 0 });

    $$(".target, .stage, .code, .footer__col").forEach(function (el) {
      gsap.from(el, {
        y: 24, opacity: 0, duration: .9, ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 92%" }
      });
    });
  }

  /* --------------------------------------------------------- hero intro -- */
  function heroIntro() {
    if (!hasGSAP || REDUCED) {
      if (heroParts) gsap.set(heroParts, { yPercent: 0 });
      gsap.set(".hero [data-fade], .fact, .hero__cue", { y: 0, opacity: 1 });
      return;
    }
    var tl = gsap.timeline();
    if (heroParts) tl.to(heroParts, { yPercent: 0, duration: 1.15, ease: "expo.out", stagger: .05 }, 0);
    tl.to(".hero [data-fade]", { y: 0, opacity: 1, duration: 1, ease: "expo.out", stagger: .1 }, .35)
      .to(".fact", { y: 0, opacity: 1, duration: .9, ease: "expo.out", stagger: .09 }, .5)
      .to(".hero__cue", { opacity: 1, duration: .8, ease: "power2.out" }, .9);
  }

  /* ------------------------------------------------------ slice reveal --- */
  /* SliceRevealer demo 1, variant #1: four vertical slices leaving upward
     behind a stagger, with the companion stage tween scaling 1.3 to 1.
     Retimed to a 1.4s sequence, split at 650ms between text and slices.     */
  function sliceReveal(done) {
    var host = $("#reveal");
    if (!host) { document.body.classList.remove("is-revealing"); done(); return; }

    var slices = $$(".reveal__slice", host);
    var mark = $("#revealMark");
    var stage = $(".hero__canvas");

    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      host.classList.add("is-done");
      document.body.classList.remove("is-revealing");
      if (hasGSAP && window.ScrollTrigger) ScrollTrigger.refresh();
      done();
    }
    // The page must never stay covered, whatever happens to the animation.
    setTimeout(finish, 2100);

    // A deep link should land where it points, not behind the slices.
    if (REDUCED || location.hash || typeof window.anime !== "function") { finish(); return; }

    // 1.4s, split at 650ms: the wordmark owns the first half, the slices the
    // second. Every curve is a cubic-bezier so the motion settles rather than
    // arriving flat.
    var TEXT = 650, SLICE = 510, STAGGER = 80;

    // anime.js here is v2, which resolves easings by name only. It has no
    // cubicBezier() string parser, so these are the built-in curves.
    var EASE_IN_SETTLE = "easeOutExpo";     // long, soft landing
    var EASE_OUT_AWAY  = "easeInQuart";     // accelerates off screen
    var EASE_SLICE     = "easeInOutQuint";  // deep S curve on the lift
    var EASE_STAGE     = "easeOutQuint";

    anime({
      targets: mark, duration: TEXT, easing: EASE_IN_SETTLE,
      opacity: [0, 1], translateY: [30, 0], scale: [.94, 1]
    });
    anime({
      targets: mark, duration: 280, delay: TEXT, easing: EASE_OUT_AWAY,
      opacity: [1, 0], translateY: [0, -24]
    });

    if (stage) {
      anime({ targets: stage, duration: 750, delay: TEXT, easing: EASE_STAGE, scale: [1.3, 1] });
    }

    anime({
      targets: slices,
      duration: SLICE,
      delay: function (_, i) { return TEXT + i * STAGGER; },
      easing: EASE_SLICE,
      translateY: "-100%",
      complete: finish
    });
  }

  /* -------------------------------------------------------------- lenis -- */
  var lenis = null;

  function smoothScroll() {
    if (REDUCED || typeof window.Lenis !== "function" || !hasGSAP) return;

    lenis = new Lenis({
      duration: 1.05,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      gestureOrientation: "vertical"
    });

    if (window.ScrollTrigger) lenis.on("scroll", ScrollTrigger.update);

    window.lenis = lenis;
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);

    // in-page links go through lenis so the easing is consistent
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (ev) {
        var id = a.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        ev.preventDefault();
        lenis.scrollTo(target, { offset: 0, duration: 1.2 });
      });
    });
  }

  /* ---------------------------------------------------------------- nav -- */
  function navBehaviour() {
    var nav = $("#nav");
    if (!nav) return;
    var on = false;
    function upd() {
      var s = window.scrollY > window.innerHeight * 0.6;
      if (s !== on) { on = s; nav.classList.toggle("is-stuck", s); }
    }
    upd();
    window.addEventListener("scroll", upd, { passive: true });
    if (lenis) lenis.on("scroll", upd);
  }

  /* ------------------------------------------------------- mobile menu -- */
  function mobileMenu() {
    var burger = $("#navBurger"), panel = $("#navPanel");
    if (!burger || !panel) return;

    function setOpen(open) {
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      panel.hidden = !open;
      document.body.classList.toggle("menu-open", open);
      if (lenis) { open ? lenis.stop() : lenis.start(); }
      if (open && hasGSAP && !REDUCED) {
        gsap.from($$("a", panel), { y: 28, opacity: 0, duration: .6, ease: "expo.out", stagger: .06 });
      }
    }

    burger.addEventListener("click", function () {
      setOpen(burger.getAttribute("aria-expanded") !== "true");
    });
    $$("a", panel).forEach(function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 860) setOpen(false);
    });
  }

  /* ------------------------------------------------------------ marquee -- */
  function marquee() {
    var track = $("#marqueeTrack");
    if (!track) return;
    var html = track.innerHTML;
    track.innerHTML = html + html + html;
    if (!hasGSAP || REDUCED) return;

    var half = track.scrollWidth / 3;
    var tl = gsap.to(track, { x: -half, duration: 24, ease: "none", repeat: -1 });

    if (!window.ScrollTrigger) return;
    var settle;
    ScrollTrigger.create({
      trigger: document.body,
      start: 0,
      end: "max",
      onUpdate: function (self) {
        var v = clamp(Math.abs(self.getVelocity()) / 1200, 0, 4);
        gsap.to(tl, { timeScale: 1 + v, duration: .35, overwrite: true });
        clearTimeout(settle);
        settle = setTimeout(function () {
          gsap.to(tl, { timeScale: 1, duration: 1.2, overwrite: true });
        }, 220);
      }
    });
  }

  /* ------------------------------------------------- orthogonality plot -- */
  function orthogonalityPlot() {
    var svg = $("#plotSvg");
    if (!svg) return;

    var W = 600, H = 460, N = 150;
    var gPoints = $("#plotPoints"), gGrid = $("#plotGrid");
    var line = $("#plotLine"), region = $("#plotRegion");
    var grab = $("#plotGrab");
    var elMissed = $("#plotMissed"), elNoise = $("#plotNoise"), elThresh = $("#plotThresh");
    var note = $("#plotNote");
    var mode = "confidence";
    var t = 0.5;

    var NS = "http://www.w3.org/2000/svg";
    for (var g = 1; g < 6; g++) {
      var ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", 0); ln.setAttribute("x2", W);
      ln.setAttribute("y1", (H / 6) * g); ln.setAttribute("y2", (H / 6) * g);
      ln.setAttribute("class", "plot__grid");
      gGrid.appendChild(ln);
      var lv = document.createElementNS(NS, "line");
      lv.setAttribute("y1", 0); lv.setAttribute("y2", H);
      lv.setAttribute("x1", (W / 6) * g); lv.setAttribute("x2", (W / 6) * g);
      lv.setAttribute("class", "plot__grid");
      gGrid.appendChild(lv);
    }

    // Confidence and cost are drawn independently: that independence is the point.
    var pts = [];
    var seed = 7;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    for (var i = 0; i < N; i++) {
      var conf = 0.06 + rnd() * 0.92;
      var cost = Math.pow(rnd(), 1.7);
      var bad = cost > 0.62;
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", conf * W);
      c.setAttribute("cy", H - cost * H);
      c.setAttribute("r", bad ? 5 : 3.4);
      c.setAttribute("class", "pt " + (bad ? "pt--bad" : "pt--safe"));
      gPoints.appendChild(c);
      pts.push({ conf: conf, cost: cost, bad: bad, el: c });
    }

    function paint() {
      var missed = 0, noise = 0;
      pts.forEach(function (p) {
        var caught = mode === "confidence" ? (p.conf < t) : (p.cost > 1 - t);
        if (p.bad && !caught) missed++;
        if (!p.bad && caught) noise++;
        p.el.classList.toggle("is-caught", caught);
        p.el.style.opacity = caught ? "1" : (p.bad ? ".85" : ".26");
      });

      if (mode === "confidence") {
        line.setAttribute("x1", t * W); line.setAttribute("x2", t * W);
        line.setAttribute("y1", 0); line.setAttribute("y2", H);
        region.setAttribute("x", 0); region.setAttribute("y", 0);
        region.setAttribute("width", t * W); region.setAttribute("height", H);
      } else {
        var y = (1 - t) * H;
        line.setAttribute("x1", 0); line.setAttribute("x2", W);
        line.setAttribute("y1", y); line.setAttribute("y2", y);
        region.setAttribute("x", 0); region.setAttribute("y", 0);
        region.setAttribute("width", W); region.setAttribute("height", y);
      }

      elMissed.textContent = missed;
      elNoise.textContent = noise;
      elThresh.textContent = Math.round(t * 100);
      grab.setAttribute("aria-valuenow", Math.round(t * 100));
      var r = $("#plotRange");
      if (r && document.activeElement !== r) r.value = Math.round(t * 100);
    }

    function setMode(m) {
      mode = m;
      $$(".switch__btn", $("#plotSwitch")).forEach(function (b) {
        var on = b.dataset.mode === m;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      grab.style.cursor = m === "confidence" ? "ew-resize" : "ns-resize";
      note.textContent = m === "confidence"
        ? "Raise the threshold to protect the transfer and you buy approval requests for thousands of harmless file operations. Lower it to keep the agent useful and the transfer goes through unguarded. No vertical line separates the two populations."
        : "The same points, cut horizontally. Guardrail gates on the axis that actually carries the risk, so the costly calls are caught at a fraction of the interruption budget a confidence threshold would have spent.";
      paint();
    }

    function fromEvent(ev) {
      var r = grab.getBoundingClientRect();
      var cx = (ev.touches ? ev.touches[0].clientX : ev.clientX);
      var cy = (ev.touches ? ev.touches[0].clientY : ev.clientY);
      t = mode === "confidence"
        ? clamp((cx - r.left) / r.width, 0.02, 0.98)
        : clamp(1 - (cy - r.top) / r.height, 0.02, 0.98);
      paint();
    }

    var dragging = false;
    grab.addEventListener("pointerdown", function (e) { dragging = true; grab.setPointerCapture(e.pointerId); fromEvent(e); });
    grab.addEventListener("pointermove", function (e) { if (dragging) fromEvent(e); });
    grab.addEventListener("pointerup", function () { dragging = false; });
    grab.addEventListener("pointercancel", function () { dragging = false; });
    grab.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { t = clamp(t - .02, .02, .98); paint(); e.preventDefault(); }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { t = clamp(t + .02, .02, .98); paint(); e.preventDefault(); }
    });

    var range = $("#plotRange");
    if (range) {
      range.addEventListener("input", function () {
        t = clamp(parseFloat(range.value) / 100, 0.02, 0.98);
        paint();
      });
    }

    $$(".switch__btn", $("#plotSwitch")).forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.dataset.mode); });
    });

    setMode("confidence");

    if (hasGSAP && !REDUCED && window.ScrollTrigger) {
      gsap.from(pts.map(function (p) { return p.el; }), {
        scale: 0, transformOrigin: "50% 50%", duration: .8, ease: "back.out(2)",
        stagger: { amount: .7, from: "random" },
        scrollTrigger: { trigger: svg, start: "top 82%" }
      });
      gsap.from([line, region], {
        opacity: 0, duration: .8, ease: "power2.out", delay: .5,
        scrollTrigger: { trigger: svg, start: "top 82%" }
      });
    }
  }

  /* --------------------------------------------------------- pipeline ----- */
  function pipeline() {
    var pipe = $("#pipe");
    if (!pipe || !hasGSAP || !window.ScrollTrigger) return;

    var fill = $("#pipeFill"), token = $("#pipeToken");
    var stages = $$(".stage", pipe);
    var meters = stages.map(function (s) { return $("span", $(".stage__meter", s)); });
    var labels = [
      'db.dropTable("users")',
      'U upper bound 0.94',
      'affordances left: 0',
      'verdict: escalate'
    ];

    if (REDUCED) {
      fill.style.width = "100%";
      stages.forEach(function (s, i) { s.classList.add("is-live"); meters[i].style.width = "100%"; });
      return;
    }

    ScrollTrigger.create({
      trigger: pipe,
      start: "top 78%",
      end: "bottom 62%",
      scrub: 0.6,
      onUpdate: function (self) {
        var p = self.progress;
        fill.style.width = (p * 100).toFixed(2) + "%";
        token.style.left = (p * 100).toFixed(2) + "%";

        var idx = clamp(Math.floor(p * 4), 0, 3);
        token.firstElementChild.textContent = labels[idx];

        stages.forEach(function (s, i) {
          var local = clamp(p * 4 - i, 0, 1);
          meters[i].style.width = (local * 100).toFixed(1) + "%";
          s.classList.toggle("is-live", local > 0.02 && local < 1);
          if (local >= 1) s.classList.add("is-live");
        });
      }
    });
  }

  /* -------------------------------------------------------------- sim ----- */
  function simulator() {
    var list = $("#simList");
    if (!list) return;

    var CASES = [
      {
        name: "Rename a temp file",
        ctx: "development workspace, backup 4 minutes old",
        call: 'fs.rename("/tmp/a.log", "/tmp/b.log")',
        lat: 0.06, mon: 0.0, soc: 0.0, perr: 0.31, cint: 0.06,
        why: "Cheap to reverse and contained inside a system the agent controls. The call proceeds and is written to the audit log."
      },
      {
        name: "Force push to main",
        ctx: "shared branch, last fetch by a collaborator 40 seconds ago",
        call: 'git.push({ force: true, ref: "main" })',
        lat: 0.55, mon: 0.08, soc: 0.42, perr: 0.22, cint: 0.06,
        why: "Revertible until a collaborator has pulled. The contextual head reads that event from the trajectory and amplifies the estimate."
      },
      {
        name: "Issue a refund",
        ctx: "live ledger, counterparty is an external merchant",
        call: 'payments.refund({ amount: 12400.00 })',
        lat: 0.48, mon: 0.91, soc: 0.35, perr: 0.18, cint: 0.06,
        why: "A compensating action exists but it needs the counterparty to cooperate, and the money has already crossed an organisational boundary."
      },
      {
        name: "Drop the users table",
        ctx: "production, backup deleted 2 steps earlier in this trajectory",
        call: 'db.dropTable("users")',
        lat: 0.97, mon: 0.72, soc: 0.88, perr: 0.31, cint: 0.06,
        why: "The compositional head sees that the last recovery affordance was consumed two calls ago. Nothing here can be walked back."
      }
    ];

    var els = {
      call: $("#simCall"), ctx: $("#simCtx"),
      damage: $("#simDamage"), math: $("#simMath"), cint: $("#simCint"),
      beam: $("#simBeam"), verdict: $("#simVerdict"), why: $("#simWhy")
    };
    var vtxt = $(".verdict__txt", els.verdict);
    var bars = {};
    $$(".bar", $("#simBars")).forEach(function (b) {
      bars[b.dataset.k] = { fill: $("i", b), val: $(".bar__v", b) };
    });

    CASES.forEach(function (c, i) {
      var b = document.createElement("button");
      b.className = "sim__item" + (i === 0 ? " is-on" : "");
      b.setAttribute("role", "tab");
      b.innerHTML = "<h4>" + c.name + "</h4><span>" + c.ctx + "</span>";
      b.addEventListener("click", function () { show(i, true); });
      list.appendChild(b);
    });
    var items = $$(".sim__item", list);

    var current = -1, timer = null, userLocked = false;

    function tween(obj, key, to, setter) {
      if (!hasGSAP || REDUCED) { obj[key] = to; setter(to); return; }
      gsap.to(obj, { duration: .9, ease: "expo.out", [key]: to, onUpdate: function () { setter(obj[key]); } });
    }

    var state = { lat: 0, mon: 0, soc: 0, dmg: 0, cint: 0, beam: 50 };

    function show(i, byUser) {
      if (i === current) return;
      current = i;
      var c = CASES[i];
      if (byUser) { userLocked = true; if (timer) clearInterval(timer); }

      items.forEach(function (it, k) { it.classList.toggle("is-on", k === i); });

      els.call.textContent = c.call;
      els.ctx.textContent = c.ctx;
      els.why.textContent = c.why;

      var U = round(0.42 * c.lat + 0.34 * c.mon + 0.24 * c.soc, 3);
      var damage = round(c.perr * U, 3);
      var escalate = damage > c.cint;

      ["lat", "mon", "soc"].forEach(function (k) {
        tween(state, k, c[k], function (v) {
          bars[k].fill.style.width = (v * 100).toFixed(1) + "%";
          bars[k].val.textContent = round(v, 2).toFixed(2);
        });
      });

      tween(state, "dmg", damage, function (v) { els.damage.textContent = v.toFixed(3); });
      tween(state, "cint", c.cint, function (v) { els.cint.textContent = v.toFixed(3); });

      var beamPos = clamp(50 + (damage - c.cint) * 260, 4, 96);
      tween(state, "beam", beamPos, function (v) { els.beam.style.left = v + "%"; });

      els.math.textContent = "P_err " + c.perr.toFixed(2) + "  x  U " + U.toFixed(3);

      els.verdict.dataset.v = escalate ? "escalate" : "execute";
      vtxt.textContent = escalate ? "ESCALATE" : "EXECUTE";

      if (hasGSAP && !REDUCED) {
        gsap.fromTo(els.verdict, { opacity: .2 }, { opacity: 1, duration: .55, ease: "power2.out" });
        gsap.fromTo(els.call, { x: -14, opacity: 0 }, { x: 0, opacity: 1, duration: .6, ease: "expo.out" });
      }
    }

    function cycle() {
      timer = setInterval(function () {
        if (userLocked) return;
        show((current + 1) % CASES.length);
      }, 4200);
    }

    show(0);
    if (!REDUCED && window.ScrollTrigger) {
      ScrollTrigger.create({
        trigger: list, start: "top 80%", once: true,
        onEnter: function () { cycle(); }
      });
    }
  }

  /* ------------------------------------------------------- composition --- */
  /* Three arrangements of the same two calls. Rows build one at a time while
     the block is pinned, so the comparison is still on screen at the end.   */
  function composition() {
    var pin = $("#composePin"), wrap = $("#compose");
    if (!pin || !wrap) return;

    var rows = $$(".sc", wrap);
    var close = $("#composeClose");
    if (!rows.length) return;

    // which copy each row destroys, and what the arrow does
    var PLAN = [
      { gone: ["backup"], recover: true },
      { gone: ["primary"], recover: true },
      { gone: ["backup", "primary"], recover: false }
    ];

    function parts(row) {
      return {
        copies: $$(".copy", row),
        line: $(".sc__line", row),
        tip: $(".sc__tip", row),
        cross: $$(".sc__cross line", row),
        note: $(".sc__note", row),
        verdict: $(".sc__v", row),
        head: $(".sc__head", row)
      };
    }

    function drain(copy, gone) {
      copy.classList.toggle("is-gone", gone);
      $(".copy__s", copy).textContent = gone ? "deleted, nothing to read" : "holds the data";
    }

    // labels only; bar widths belong to the tween so scrubbing stays smooth
    function paintLabels(row, i, on) {
      var plan = PLAN[i];
      $$(".copy", row).forEach(function (c) {
        drain(c, on && plan.gone.indexOf(c.dataset.copy) > -1);
      });
    }

    function paintRow(row, i, on) {
      paintLabels(row, i, on);
      var plan = PLAN[i];
      $$(".copy", row).forEach(function (c) {
        var gone = on && plan.gone.indexOf(c.dataset.copy) > -1;
        $("i", $(".copy__bar", c)).style.width = gone ? "0%" : "100%";
      });
    }

    if (!hasGSAP || REDUCED || !window.ScrollTrigger) {
      rows.forEach(function (r, i) {
        paintRow(r, i, true);
        if (!PLAN[i].recover) {
          $$(".sc__cross line", r).forEach(function (l) { l.style.opacity = 1; });
        }
      });
      return;
    }

    function build(endPct, pinIt) {
    // resting state, re-applied each time a media context takes over
    rows.forEach(function (row, i) {
      var p = parts(row);
      gsap.set(row, { opacity: .18 });
      gsap.set(p.line, { strokeDasharray: 140, strokeDashoffset: 140 });
      gsap.set(p.tip, { opacity: 0 });
      gsap.set(p.cross, { opacity: 0, scale: 0, transformOrigin: "center center" });
      gsap.set(p.note, { opacity: 0, x: -8 });
      gsap.set(p.verdict, { opacity: 0, y: 10 });
      paintRow(row, i, false);
    });
    gsap.set(close, { opacity: 0, y: 14 });

    var tl = gsap.timeline({
      scrollTrigger: pinIt ? {
        trigger: pin,
        start: "top top",
        end: "+=" + endPct + "%",
        pin: true,
        pinSpacing: true,
        anticipatePin: 1,
        scrub: 0.7,
        invalidateOnRefresh: true
      } : {
        // too short to pin without clipping, so let it scroll through instead
        trigger: pin,
        start: "top 80%",
        end: "bottom 55%",
        scrub: 0.7,
        invalidateOnRefresh: true
      }
    });

    rows.forEach(function (row, i) {
      var p = parts(row);
      var plan = PLAN[i];
      var at = i * 1.0;

      // the row wakes up
      tl.to(row, { opacity: 1, duration: .28, ease: "power2.out" }, at)
        .from(p.head, { x: -14, duration: .35, ease: "power3.out" }, at);

      // the copies it destroys drain away
      p.copies.forEach(function (c) {
        if (plan.gone.indexOf(c.dataset.copy) < 0) return;
        tl.to($("i", $(".copy__bar", c)), { width: "0%", duration: .4, ease: "power2.inOut" }, at + .18);
      });

      // the wording rides a tween in the same slot, so it reverses with the scrub
      var flag = { v: 0 };
      tl.to(flag, {
        v: 1, duration: .4, ease: "none",
        onUpdate: function () { paintLabels(row, i, flag.v > .5); }
      }, at + .18);

      if (plan.recover) {
        tl.to(p.line, { strokeDashoffset: 0, duration: .4, ease: "power2.out" }, at + .4)
          .to(p.tip, { opacity: 1, duration: .2 }, at + .72)
          .to(p.note, { opacity: 1, x: 0, duration: .35, ease: "power2.out" }, at + .6);
      } else {
        // the arrow reaches for a copy that is not there and is struck out
        tl.to(p.line, { strokeDashoffset: 40, duration: .4, ease: "power2.out" }, at + .4)
          .to(p.cross, { opacity: 1, scale: 1, duration: .3, ease: "back.out(3)", stagger: .06 }, at + .62)
          .to(p.note, { opacity: 1, x: 0, duration: .35, ease: "power2.out" }, at + .62);
      }

      tl.to(p.verdict, { opacity: 1, y: 0, duration: .3, ease: "power3.out" }, at + .74);
    });

      tl.to(close, { opacity: 1, y: 0, duration: .4, ease: "power2.out" }, rows.length - .1);
      tl.to({}, { duration: .35 });
    }

    // matchMedia rebuilds and reverts cleanly across breakpoints and rotation
    var mm = gsap.matchMedia();
    mm.add("(min-width: 901px)", function () { build(300, true); });
    mm.add("(max-width: 900px) and (orientation: portrait)", function () {
      // only pin if the whole comparison actually fits the screen
      build(240, pin.scrollHeight <= window.innerHeight + 4);
    });
    mm.add("(max-width: 900px) and (orientation: landscape)", function () { build(0, false); });
  }

  /* ------------------------------------------------------------- chart --- */
  function frontier() {
    var svg = $("#chartSvg");
    if (!svg) return;
    var NS = "http://www.w3.org/2000/svg";
    var grid = $("#chartGrid");

    for (var i = 1; i < 5; i++) {
      var ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", 60); ln.setAttribute("x2", 590);
      ln.setAttribute("y1", 42 + i * 65); ln.setAttribute("y2", 42 + i * 65);
      ln.setAttribute("class", "chart__grid");
      grid.appendChild(ln);
    }

    var b2 = $("#chartB2"), gr = $("#chartGR"), area = $("#chartArea");
    area.setAttribute("d",
      "M 60 42 C 130 60, 168 132, 214 196 C 268 268, 380 322, 590 340 L 590 366 C 500 358, 400 330, 330 268 C 250 190, 170 92, 60 60 Z");

    var marks = $("#chartMarks");
    [[214, 196], [330, 268]].forEach(function (p, k) {
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]); c.setAttribute("r", 5);
      c.setAttribute("fill", k === 0 ? PAL.cream : PAL.sand);
      marks.appendChild(c);
    });

    function fmt(dt, v) {
      var suffix = dt.dataset.suffix || "";
      var end = parseFloat(dt.dataset.count);
      return (end >= 1000 ? Math.round(v).toLocaleString("en-US") : Math.round(v)) + suffix;
    }

    if (!hasGSAP || REDUCED || !window.ScrollTrigger) {
      area.style.opacity = 1;
      $$(".target dt").forEach(function (dt) { dt.textContent = fmt(dt, parseFloat(dt.dataset.count)); });
      return;
    }

    [b2, gr].forEach(function (p) {
      var len = p.getTotalLength();
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });
    gsap.set(marks.children, { scale: 0, transformOrigin: "50% 50%" });

    var tl = gsap.timeline({ scrollTrigger: { trigger: svg, start: "top 80%" } });
    tl.to(b2, { strokeDashoffset: 0, duration: 1.5, ease: "power2.inOut" })
      .to(gr, { strokeDashoffset: 0, duration: 1.5, ease: "power2.inOut" }, 0.35)
      .to(area, { opacity: 1, duration: .9, ease: "power2.out" }, 1.2)
      .to(marks.children, { scale: 1, duration: .6, ease: "back.out(2.4)", stagger: .12 }, 1.3);

    // counters
    $$(".target dt").forEach(function (dt) {
      var end = parseFloat(dt.dataset.count);
      var suffix = dt.dataset.suffix || "";
      var o = { v: 0 };
      gsap.to(o, {
        v: end, duration: 1.8, ease: "expo.out",
        scrollTrigger: { trigger: dt, start: "top 90%" },
        onUpdate: function () { dt.textContent = fmt(dt, o.v); }
      });
    });
  }

  /* -------------------------------------------------------------- code --- */
  function codeReveal() {
    if (!hasGSAP || REDUCED || !window.ScrollTrigger) return;
    $$("[data-code] code").forEach(function (code) {
      var lines = code.innerHTML.split("\n");
      code.innerHTML = lines.map(function (l) {
        return '<span class="cl" style="display:block">' + (l.length ? l : "&nbsp;") + "</span>";
      }).join("");
      gsap.from($$(".cl", code), {
        opacity: 0, x: -10, duration: .5, ease: "power2.out", stagger: .045,
        scrollTrigger: { trigger: code, start: "top 88%" }
      });
    });
  }

  /* --------------------------------------------------------- hero scroll - */
  function heroParallax() {
    if (!hasGSAP || REDUCED || !window.ScrollTrigger) return;
    var hero = $(".hero");
    if (!hero) return;
    gsap.to(".hero__inner, .hero__foot", {
      y: -90, opacity: 0.15, ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: .4 }
    });
  }

  /* --------------------------------------------------------------- boot -- */
  function boot() {
    smoothScroll();
    navBehaviour();
    mobileMenu();
    reveals();
    heroParallax();
    marquee();
    orthogonalityPlot();
    pipeline();
    simulator();
    composition();
    frontier();
    codeReveal();
    heroBackground();
    footerBackground();
    if (hasGSAP && window.ScrollTrigger) ScrollTrigger.refresh();

    // Hold the page under the slices, then lift them and play the hero in.
    if (!location.hash) window.scrollTo(0, 0);
    sliceReveal(heroIntro);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  window.addEventListener("load", function () {
    if (hasGSAP && window.ScrollTrigger) ScrollTrigger.refresh();
  });
})();
