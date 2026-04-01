/**
 * ============================================================================
 * FluxType — لعبة طباعة سريعة (Vanilla JS)
 * ============================================================================
 *
 * الهدف:
 *   - عرض كلمات عشوائياً؛ ينسخ اللاعب كل كلمة في حقل الإدخال قبل انتهاء الوقت.
 *   - مستويات صعوبة تغيّر الثواني المتاحة لكل كلمة.
 *
 * تدفق الشاشات (إلزامي بعد كل تحميل للصفحة):
 *   1) شاشة التحميل (LOADER_MS)
 *   2) القائمة: اسم + مستوى → «ابدأ اللعبة»
 *   3) شاشة اللعبة: جولة تعريفية عند أول زيارة (حتى «أكمل» أو «تخطي»)
 *   4) زر «ابدأ الجولة» لا يفعّل إلا بعد اجتياز البوابة (tutorialGatePassed)، ثم يُخفى أثناء اللعب.
 *   5) نهاية الجولة: طبقة ملء الشاشة (فوز/خسارة)، نتيجة الجولة + أعلى نتيجة في localStorage (STORAGE_HIGH_SCORE).
 *
 * الأمان (ملخص):
 *   - تجنّب innerHTML لبيانات المستخدم؛ الأسماء تُعرض عبر textContent فقط.
 *   - شاشة نهاية الجولة تملأ النصوص عبر textContent فقط (لا HTML من الخارج).
 *   - منع اللصق في حقل اللعبة لتقليل الغش؛ لا يوجد طلبات لخادم ولا تخزين حساس.
 *
 * التخزين المحلي:
 *   - STORAGE_ONBOARDING: إخفاء الجولة التعريفية تلقائياً لاحقاً.
 *   - STORAGE_HIGH_SCORE: أعلى عدد كلمات أُنجِز في جولة واحدة (يُحدَّث عند الفوز أو الخسارة).
 *   - لا نخزّن الشاشة النشطة؛ كل refresh يعيد التحميل ثم القائمة.
 *
 * المؤقت:
 *   - deadline = Date.now() + المدة لتفادي انزياح تكرار setInterval دون مزامنة مع الساعة.
 *   - يُمسح المؤقت القديم قبل جولة زمنية جديدة (منع تراكم interval).
 *
 * هيكلة الملف (اقرأ من الأعلى للأسفل):
 *   1) ثوابت التخزين + بنك الكلمات + المستويات
 *   2) state — حالة الجولة الحية فقط (لا تُحفظ عند refresh)
 *   3) مراجع DOM (el) — لقطة عند التحميل
 *   4) التنقل بين الشاشات + النتيجة العليا + طبقة نهاية الجولة
 *   5) منطق اللعب: مؤقت، كلمات، صح/خطأ
 *   6) الجولة التعريفية (Tour) — موضع يدوي (CSS وحده لا يعرف إحداثيات الهدف)
 *   7) أحداث واجهة اللعبة + تهيئة الصفحة
 *
 * ما يُترك للـ CSS عمداً: ألوان، تخطيط، إخفاء [hidden]، استجابة الشاشة، أنيميشن الدخول.
 * ============================================================================
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1) تخزين محلي — مفاتيح ثابتة (لا تغيّرها بعد إطلاق نسخ للمستخدمين دون ترحيل بيانات)
  // ---------------------------------------------------------------------------

  /** مفتاح تفضيل: لا نعرض الجولة التعريفية تلقائياً بعد أول إتمام (اختياري من المستخدم). */
  const STORAGE_ONBOARDING = "fluxtype_onboarding_done";

  /** أعلى نتيجة لكلمة مكتملة في جولة واحدة (عدد صحيح). */
  const STORAGE_HIGH_SCORE = "fluxtype_high_score";

  /** @type {readonly string[]} */
  const WORD_BANK = Object.freeze([
    "hello",
    "world",
    "typing",
    "speed",
    "focus",
    "keyboard",
    "practice",
    "challenge",
    "fluent",
    "accuracy",
    "reaction",
    "dynamic",
    "stream",
    "pixel",
    "vector",
    "console",
    "script",
    "compile",
    "runtime",
    "browser",
    "network",
    "packet",
    "cipher",
    "signal",
    "flux",
  ]);

  const LEVELS = Object.freeze({
    easy: 5,
    normal: 3,
    hard: 2,
    extreme: 1.5,
  });

  const LEVEL_LABELS = Object.freeze({
    easy: "سهل",
    normal: "عادي",
    hard: "صعب",
    extreme: "متطرف",
  });

  const LOADER_MS = 3200;

  // ---------------------------------------------------------------------------
  // 2) حالة الجولة (ذاكرة مؤقتة فقط — تُصفَر عند إعادة تحميل الصفحة)
  // ---------------------------------------------------------------------------

  /**
   * حالة الجولة — كل ما يتغير أثناء اللعب.
   * @type {{
   *   timerId: ReturnType<typeof setInterval> | null;
   *   wordsPool: string[];
   *   levelKey: keyof typeof LEVELS;
   *   playerName: string;
   *   started: boolean;
   *   deadline: number;
   *   roundDurationMs: number;
   *   tutorialGatePassed: boolean;
   * }}
   */
  const state = {
    timerId: null,
    wordsPool: [],
    levelKey: "normal",
    /** محجوز لعرض أو منطق لاحق؛ الاسم يُعرض حالياً من DOM مباشرة */
    playerName: "",
    started: false,
    deadline: 0,
    roundDurationMs: 0,
    /** هل يُسمح بـ beginMatch (بعد إنهاء/تخطي الجولة التعريفية أو إن وُجد تفضيل «تمت المشاهدة»). */
    tutorialGatePassed: false,
  };

  /** @type {{ selector: string; title: string; text: string }[]} */
  const TOUR_STEPS = [
    {
      selector: '[data-tour="header"]',
      title: "شريط اللعبة",
      text: "هنا اسمك وزر الخروج للقائمة. زر «؟» يعيد شرح الواجهة متى شئت.",
    },
    {
      selector: '[data-tour="level-msg"]',
      title: "مستوى الصعوبة",
      text: "يذكرك بالمستوى الذي اخترته والوقت المتاح لكل كلمة بالثواني.",
    },
    {
      selector: '[data-tour="start-btn"]',
      title: "ابدأ الجولة",
      text: "اضغط هنا عندما تكون جاهزاً. لن يبدأ اللعب قبل إنهاء شرح الواجهة (أو تخطيه) في أول مرة.",
    },
    {
      selector: '[data-tour="word-block"]',
      title: "الكلمة والوقت",
      text: "العدّ التنازلي وشريط الوقت. انسخ الكلمة الظاهرة بحروفها كما هي.",
    },
    {
      selector: '[data-tour="input-wrap"]',
      title: "حقل الكتابة",
      text: "اكتب الكلمة هنا. يُفرَّغ تلقائياً مع كل كلمة جديدة ويُركَّز للكتابة.",
    },
    {
      selector: "aside.game-queue-aside",
      title: "الكلمات القادمة",
      text: "كلمات متبقية في الجولة الحالية. الترقيم للتوضيح فقط.",
    },
    {
      selector: '[data-tour="score-row"]',
      title: "النتيجة",
      text: "ما أنجزته من إجمالي الجولة الحالية.",
    },
  ];

  let tourStepIndex = 0;
  let tourOpen = false;

  // ---------------------------------------------------------------------------
  // 3) عناصر DOM — تُقرأ مرة عند التحميل (لا تعيد query في كل إطار)
  // ---------------------------------------------------------------------------

  const el = {
    loader: document.getElementById("screen-loader"),
    menu: document.getElementById("screen-menu"),
    game: document.getElementById("screen-game"),
    playerInput: document.getElementById("player-name"),
    levelSelect: document.getElementById("level-select"),
    menuStart: document.getElementById("menu-start"),
    gamePlayerDisplay: document.getElementById("game-player-display"),
    gameQuit: document.getElementById("game-quit"),
    gameTourHelp: document.getElementById("game-tour-help"),
    gameStartWrap: document.getElementById("game-start-wrap"),
    gameStart: document.getElementById("game-start"),
    uiLvl: document.getElementById("ui-lvl"),
    uiSecs: document.getElementById("ui-secs"),
    wordDisplay: document.getElementById("word-display"),
    wordInput: document.getElementById("word-input"),
    upcoming: document.getElementById("upcoming-words"),
    queueCount: document.getElementById("queue-count"),
    timeLeft: document.getElementById("time-left"),
    timeFill: document.getElementById("time-fill"),
    scoreGot: document.getElementById("score-got"),
    scoreTotal: document.getElementById("score-total"),
    gameOverOverlay: document.getElementById("game-over-overlay"),
    gameOverBadge: document.getElementById("game-over-badge"),
    gameOverTitle: document.getElementById("game-over-title"),
    gameOverSub: document.getElementById("game-over-sub"),
    gameOverScore: document.getElementById("game-over-score"),
    gameOverBest: document.getElementById("game-over-best"),
    gameOverRetry: document.getElementById("game-over-retry"),
    gameOverExit: document.getElementById("game-over-exit"),
    tourOverlay: document.getElementById("tour-overlay"),
    tourHighlight: document.getElementById("tour-highlight"),
    tourCard: document.getElementById("tour-card"),
    tourPointer: document.getElementById("tour-pointer"),
    tourStepLabel: document.getElementById("tour-step-label"),
    tourTitle: document.getElementById("tour-title"),
    tourText: document.getElementById("tour-text"),
    tourNever: document.getElementById("tour-never-show"),
    tourPrev: document.getElementById("tour-prev"),
    tourNext: document.getElementById("tour-next"),
    tourSkip: document.getElementById("tour-skip"),
    tourClose: document.getElementById("tour-close"),
    shadeTop: document.getElementById("tour-shade-top"),
    shadeBottom: document.getElementById("tour-shade-bottom"),
    shadeLeft: document.getElementById("tour-shade-left"),
    shadeRight: document.getElementById("tour-shade-right"),
  };

  // ---------------------------------------------------------------------------
  // 4) الشاشات + النتيجة العليا + شاشة الفوز/الخسارة (نصوص عبر textContent فقط)
  // ---------------------------------------------------------------------------

  function showScreen(screen) {
    document.querySelectorAll(".screen").forEach(function (node) {
      node.classList.remove("is-active");
      node.setAttribute("aria-hidden", "true");
    });
    screen.classList.add("is-active");
    screen.setAttribute("aria-hidden", "false");
    if (screen === el.game) {
      document.body.classList.add("game-mode");
    } else {
      document.body.classList.remove("game-mode");
    }
  }

  function getHighScore() {
    try {
      const n = parseInt(window.localStorage.getItem(STORAGE_HIGH_SCORE), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * يحدّث أعلى نتيجة محفوظة إن تجاوزت الجولة الحالية السابقة.
   * @param {number} runScore عدد الكلمات الصحيحة في هذه الجولة
   * @returns {number} أعلى قيمة بعد التحديث (للعرض)
   */
  function commitHighScore(runScore) {
    const prev = getHighScore();
    const next = Math.max(prev, runScore);
    try {
      if (next !== prev) {
        window.localStorage.setItem(STORAGE_HIGH_SCORE, String(next));
      }
    } catch (e) {
      /* ignore */
    }
    return next;
  }

  function hideGameOverOverlay() {
    if (!el.gameOverOverlay) return;
    el.gameOverOverlay.setAttribute("hidden", "");
    el.gameOverOverlay.setAttribute("aria-hidden", "true");
  }

  /**
   * @param {"win"|"lose"} kind
   * @param {number} runScore
   * @param {number} bestScore قيمة بعد commitHighScore
   */
  function showGameOverOverlay(kind, runScore, bestScore) {
    if (!el.gameOverOverlay) return;
    el.gameOverOverlay.classList.toggle("game-over--win", kind === "win");
    if (kind === "win") {
      el.gameOverBadge.textContent = "فوز";
      el.gameOverTitle.textContent = "مبروك!";
      el.gameOverSub.textContent = "أنهيت كل الكلمات في هذه الجولة.";
    } else {
      el.gameOverBadge.textContent = "خسارة";
      el.gameOverTitle.textContent = "لم تكمل الجولة";
      el.gameOverSub.textContent =
        "انتهى الوقت أو لم تطابق الكلمة. يمكنك لعب جولة جديدة أو العودة للقائمة.";
    }
    el.gameOverScore.textContent = String(runScore);
    el.gameOverBest.textContent = String(bestScore);
    el.gameOverOverlay.removeAttribute("hidden");
    el.gameOverOverlay.setAttribute("aria-hidden", "false");
    window.setTimeout(function () {
      if (el.gameOverRetry) el.gameOverRetry.focus();
    }, 60);
  }

  /** يحدّث زر «ابدأ الجولة» حسب tutorialGatePassed — يمنع البدء قبل إنهاء الشرح عند أول دخول. */
  function updatePlayButtonState() {
    if (!el.gameStart) return;
    el.gameStart.disabled = !state.tutorialGatePassed;
    el.gameStart.title = state.tutorialGatePassed
      ? ""
      : "أكمل الجولة التعريفية أو اضغط «تخطي» في نافذة الشرح أولاً.";
  }

  function clearRoundTimer() {
    if (state.timerId !== null) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function getSecondsForLevel(key) {
    const s = LEVELS[key];
    return typeof s === "number" ? s : LEVELS.normal;
  }

  function updateHudMessage() {
    const sec = getSecondsForLevel(state.levelKey);
    el.uiLvl.textContent = LEVEL_LABELS[state.levelKey] || state.levelKey;
    el.uiSecs.textContent = String(sec);
  }

  // ---------------------------------------------------------------------------
  // 5) منطق اللعب: كلمة، مؤقت، صح/خطأ، شاشة النهاية
  // ---------------------------------------------------------------------------

  function setTimeDisplayIdle() {
    el.timeLeft.textContent = "—";
    if (el.timeFill) el.timeFill.style.width = "0%";
  }

  function updateTimeUi() {
    if (state.roundDurationMs <= 0) {
      setTimeDisplayIdle();
      return;
    }
    const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    el.timeLeft.textContent = String(left);
    const ratio = Math.max(
      0,
      Math.min(1, (state.deadline - Date.now()) / state.roundDurationMs)
    );
    if (el.timeFill) el.timeFill.style.width = ratio * 100 + "%";
  }

  /** تركيز الحقل بعد تحديث DOM؛ مهلة قصيرة تساعد متصفحات ترفض focus المبكر */
  function focusWordInput() {
    if (el.wordInput.disabled) return;
    window.requestAnimationFrame(function () {
      el.wordInput.focus({ preventScroll: true });
      window.setTimeout(function () {
        if (!el.wordInput.disabled) el.wordInput.focus({ preventScroll: true });
      }, 40);
    });
  }

  /** إعادة ضبط واجهة اللعبة دون الخروج من الشاشة (مثلاً بعد خروج للقائمة). */
  function resetGameBoard() {
    clearRoundTimer();
    state.started = false;
    state.wordsPool = [];
    state.roundDurationMs = 0;
    state.deadline = 0;
    el.wordInput.value = "";
    el.wordInput.disabled = true;
    el.wordDisplay.textContent = "ستظهر الكلمة هنا";
    el.upcoming.innerHTML = "";
    if (el.queueCount) el.queueCount.textContent = "0";
    el.scoreGot.textContent = "0";
    setTimeDisplayIdle();
    hideGameOverOverlay();
    if (el.gameStartWrap) el.gameStartWrap.removeAttribute("hidden");
  }

  function renderUpcoming() {
    el.upcoming.innerHTML = "";
    if (el.queueCount) el.queueCount.textContent = String(state.wordsPool.length);
    state.wordsPool.forEach(function (w, i) {
      const wrap = document.createElement("span");
      wrap.className = "queue-chip";
      const num = document.createElement("span");
      num.className = "queue-chip__n";
      num.textContent = i + 1 + ".";
      const text = document.createElement("span");
      text.textContent = w;
      wrap.appendChild(num);
      wrap.appendChild(text);
      el.upcoming.appendChild(wrap);
    });
  }

  /**
   * مؤقت الجولة: interval ~100ms لتحديث العداد والشريط؛ النهاية الفعلية بالمقارنة مع deadline.
   * لا نضيف interval جديداً دون clearRoundTimer() أولاً.
   */
  function scheduleTick() {
    clearRoundTimer();
    const tick = function () {
      updateTimeUi();
      const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
      if (left <= 0) {
        clearRoundTimer();
        updateTimeUi();
        onRoundElapsed();
      }
    };
    state.timerId = setInterval(tick, 100);
    tick();
  }

  /** إجابة صحيحة: زيادة النتيجة ثم كلمة تالية أو فوز. */
  function handleCorrectAnswer() {
    clearRoundTimer();
    bumpScore();
    el.wordInput.value = "";
    if (state.wordsPool.length > 0) {
      nextWord();
    } else {
      el.wordInput.disabled = true;
      state.started = false;
      setTimeDisplayIdle();
      const runScore = parseInt(el.scoreGot.textContent, 10) || 0;
      const best = commitHighScore(runScore);
      showGameOverOverlay("win", runScore, best);
    }
  }

  function handleWrongAnswer() {
    clearRoundTimer();
    el.wordInput.disabled = true;
    state.started = false;
    setTimeDisplayIdle();
    const runScore = parseInt(el.scoreGot.textContent, 10) || 0;
    const best = commitHighScore(runScore);
    showGameOverOverlay("lose", runScore, best);
  }

  /** يُستدعى عند وصول العداد لصفر: مقارنة التطابق (نفس المنطق كالإدخال الفوري). */
  function onRoundElapsed() {
    const target = normalizeWord(el.wordDisplay.textContent);
    const typed = normalizeWord(el.wordInput.value);

    if (target === typed && target.length > 0) {
      handleCorrectAnswer();
    } else {
      handleWrongAnswer();
    }
  }

  function normalizeWord(s) {
    return String(s || "")
      .trim()
      .toLowerCase();
  }

  function bumpScore() {
    const n = parseInt(el.scoreGot.textContent, 10) || 0;
    el.scoreGot.textContent = String(n + 1);
  }

  /** كلمة جديدة من المخزن العشوائي؛ تفريغ الحقل والتركيز. */
  function nextWord() {
    el.wordInput.value = "";
    if (state.wordsPool.length === 0) {
      onRoundElapsed();
      return;
    }
    const idx = Math.floor(Math.random() * state.wordsPool.length);
    const word = state.wordsPool[idx];
    state.wordsPool.splice(idx, 1);
    el.wordDisplay.textContent = word;
    renderUpcoming();
    const sec = getSecondsForLevel(state.levelKey);
    state.roundDurationMs = sec * 1000;
    state.deadline = Date.now() + state.roundDurationMs;
    el.wordInput.disabled = false;
    updateTimeUi();
    scheduleTick();
    focusWordInput();
  }

  /** بداية جولة: نسخ بنك الكلمات وخلطه. */
  function beginMatch() {
    if (!state.tutorialGatePassed) return;
    hideGameOverOverlay();
    if (el.gameStartWrap) el.gameStartWrap.setAttribute("hidden", "");
    el.wordInput.value = "";
    state.wordsPool = WORD_BANK.slice();
    shuffleArray(state.wordsPool);
    el.scoreTotal.textContent = String(state.wordsPool.length);
    el.scoreGot.textContent = "0";
    state.started = true;
    nextWord();
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }

  // ---------------------------------------------------------------------------
  // 6) الجولة التعريفية — تفضيل التخزين + مواضع يدوية (لا بديل CSS بحت للـ spotlight)
  // ---------------------------------------------------------------------------

  function isOnboardingDone() {
    try {
      return window.localStorage.getItem(STORAGE_ONBOARDING) === "1";
    } catch (e) {
      return false;
    }
  }

  function setOnboardingDone() {
    try {
      window.localStorage.setItem(STORAGE_ONBOARDING, "1");
    } catch (e) {
      /* تخزين غير متاح (وضع خاص للمتصفح) — نتجاهل بأمان */
    }
  }

  function getTourTarget() {
    const step = TOUR_STEPS[tourStepIndex];
    if (!step) return null;
    return document.querySelector(step.selector);
  }

  /**
   * يوزّع 4 مستطيلات blur حول مستطيل الهدف؛ الفجوة الوسطى تبقى واضحة.
   * يُنفَّذ في JS لأن عرض/موضع الهدف يعتمد على viewport والخطوة الحالية.
   */
  function layoutTour() {
    const target = getTourTarget();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 10;

    if (!target || !el.shadeTop || !el.tourHighlight) return;

    target.scrollIntoView({ block: "center", behavior: "auto" });
    const rect = target.getBoundingClientRect();
    const t = Math.max(0, rect.top - pad);
    const l = Math.max(0, rect.left - pad);
    const r = Math.min(vw, rect.right + pad);
    const b = Math.min(vh, rect.bottom + pad);
    const holeW = r - l;
    const holeH = b - t;

    el.shadeTop.style.top = "0px";
    el.shadeTop.style.left = "0px";
    el.shadeTop.style.width = vw + "px";
    el.shadeTop.style.height = t + "px";

    el.shadeBottom.style.top = b + "px";
    el.shadeBottom.style.left = "0px";
    el.shadeBottom.style.width = vw + "px";
    el.shadeBottom.style.height = Math.max(0, vh - b) + "px";

    el.shadeLeft.style.top = t + "px";
    el.shadeLeft.style.left = "0px";
    el.shadeLeft.style.width = l + "px";
    el.shadeLeft.style.height = holeH + "px";

    el.shadeRight.style.top = t + "px";
    el.shadeRight.style.left = r + "px";
    el.shadeRight.style.width = Math.max(0, vw - r) + "px";
    el.shadeRight.style.height = holeH + "px";

    el.tourHighlight.style.display = "block";
    el.tourHighlight.style.top = t + "px";
    el.tourHighlight.style.left = l + "px";
    el.tourHighlight.style.width = holeW + "px";
    el.tourHighlight.style.height = holeH + "px";

    positionTourCard(rect, t, l, r, b, vw, vh);
  }

  /**
   * وضع بطاقة الشرح بجانب الهدف مع سهم نحوه.
   * أفضلية: يمين الثقب ← يسار ← أسفل ← أعلى (حسب المساحة المتاحة).
   */
  function positionTourCard(rect, t, l, r, b, vw, vh) {
    if (!el.tourCard || !el.tourPointer) return;

    const margin = 12;
    const gap = 14;
    const card = el.tourCard;
    const cw = Math.min(400, vw - 2 * margin);

    card.style.width = cw + "px";
    card.style.bottom = "auto";
    card.style.transform = "none";
    card.style.left = margin + "px";
    card.style.top = margin + "px";
    card.style.visibility = "hidden";
    void card.offsetHeight;
    const ch = card.offsetHeight || 220;
    card.style.visibility = "";

    const cxHole = (l + r) / 2;
    const cyHole = (t + b) / 2;
    const spaceRight = vw - r - margin;
    const spaceLeft = l - margin;

    let placeLeft;
    let placeTop;
    /** @type {"left"|"right"|"top"|"bottom"} */
    let arrowDir = "left";

    const needW = cw + gap;
    if (spaceRight >= needW || spaceRight >= spaceLeft) {
      placeLeft = r + gap;
      arrowDir = "left";
    } else if (spaceLeft >= needW) {
      placeLeft = l - gap - cw;
      arrowDir = "right";
    } else {
      placeLeft = cxHole - cw / 2;
      placeTop = b + gap;
      arrowDir = "top";
      if (placeTop + ch > vh - margin) {
        placeTop = t - gap - ch;
        arrowDir = "bottom";
      }
    }

    if (arrowDir === "left" || arrowDir === "right") {
      placeLeft = Math.max(margin, Math.min(placeLeft, vw - cw - margin));
      placeTop = cyHole - ch / 2;
      placeTop = Math.max(margin, Math.min(placeTop, vh - ch - margin));
    } else {
      placeLeft = Math.max(margin, Math.min(placeLeft, vw - cw - margin));
      placeTop = Math.max(margin, Math.min(placeTop, vh - ch - margin));
    }

    card.style.left = Math.round(placeLeft) + "px";
    card.style.top = Math.round(placeTop) + "px";

    void card.offsetHeight;
    const crect = card.getBoundingClientRect();
    const yPct = ((cyHole - crect.top) / Math.max(crect.height, 1)) * 100;
    const xPct = ((cxHole - crect.left) / Math.max(crect.width, 1)) * 100;

    el.tourPointer.className = "tour__pointer tour__pointer--" + arrowDir;
    if (arrowDir === "left" || arrowDir === "right") {
      card.style.setProperty("--tour-arrow-y", Math.max(18, Math.min(82, yPct)) + "%");
    } else {
      card.style.setProperty("--tour-arrow-x", Math.max(18, Math.min(82, xPct)) + "%");
    }
  }

  function renderTourContent() {
    const step = TOUR_STEPS[tourStepIndex];
    const total = TOUR_STEPS.length;
    if (!step) return;
    if (el.tourStepLabel) el.tourStepLabel.textContent = tourStepIndex + 1 + " / " + total;
    if (el.tourTitle) el.tourTitle.textContent = step.title;
    if (el.tourText) el.tourText.textContent = step.text;
    if (el.tourPrev) el.tourPrev.disabled = tourStepIndex === 0;
    const last = tourStepIndex === total - 1;
    if (el.tourNext) el.tourNext.textContent = last ? "إنهاء" : "أكمل";
    layoutTour();
  }

  /**
   * يفتح طبقة الشرح. يُفضَّل تأخير رسم المواضع لمرة إطار بعد إزالة hidden
   * حتى تكتمل أبعاد العناصر المستهدفة (خاصة بعد انتقال الشاشة).
   * @param {{ resetStep?: boolean }} [opts]
   */
  function openTour(opts) {
    opts = opts || {};
    if (!el.tourOverlay) return;
    if (opts.resetStep !== false) tourStepIndex = 0;
    tourOpen = true;
    el.tourOverlay.removeAttribute("hidden");
    document.body.classList.add("tour-open");
    if (el.tourNever) el.tourNever.checked = false;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        renderTourContent();
      });
    });
  }

  /** إنهاء الشرح: يفعّل زر البدء (tutorialGatePassed) ويحفظ التفضيل إن وُجد. */
  function endTour() {
    if (!el.tourOverlay) return;
    if (el.tourNever && el.tourNever.checked) {
      setOnboardingDone();
    }
    state.tutorialGatePassed = true;
    updatePlayButtonState();
    tourOpen = false;
    el.tourOverlay.setAttribute("hidden", "");
    if (el.tourHighlight) el.tourHighlight.style.display = "none";
    document.body.classList.remove("tour-open");
    if (el.gameStart) el.gameStart.focus();
  }

  /** إغلاق دون تفعيل اللعب (مثلاً خروج للقائمة أثناء الشرح). */
  function abortTour() {
    if (!tourOpen) return;
    tourOpen = false;
    if (el.tourOverlay) el.tourOverlay.setAttribute("hidden", "");
    if (el.tourHighlight) el.tourHighlight.style.display = "none";
    document.body.classList.remove("tour-open");
  }

  // ---------------------------------------------------------------------------
  // 8) أحداث واجهة اللعبة والتهيئة
  // ---------------------------------------------------------------------------

  el.wordInput.addEventListener("input", function () {
    if (!state.started) return;
    const target = normalizeWord(el.wordDisplay.textContent);
    const typed = normalizeWord(el.wordInput.value);
    if (target.length > 0 && typed === target) {
      handleCorrectAnswer();
    }
  });

  el.wordInput.addEventListener("paste", function (e) {
    e.preventDefault();
  });

  el.gameStart.addEventListener("click", function () {
    if (el.gameStart.disabled || state.started) return;
    beginMatch();
  });

  el.menuStart.addEventListener("click", function () {
    const name = (el.playerInput.value || "").trim();
    if (!name) {
      el.playerInput.focus();
      return;
    }
    const key = el.levelSelect.value;
    if (!(key in LEVELS)) return;
    state.levelKey = /** @type {keyof typeof LEVELS} */ (key);
    state.playerName = name;
    el.gamePlayerDisplay.textContent = name;
    updateHudMessage();
    resetGameBoard();
    el.scoreTotal.textContent = String(WORD_BANK.length);

    state.tutorialGatePassed = isOnboardingDone();
    updatePlayButtonState();
    showScreen(el.game);

    if (!isOnboardingDone()) {
      window.setTimeout(function () {
        openTour();
      }, 350);
    } else {
      el.gameStart.focus();
    }
  });

  el.gameQuit.addEventListener("click", function () {
    if (tourOpen) abortTour();
    clearRoundTimer();
    hideGameOverOverlay();
    resetGameBoard();
    showScreen(el.menu);
    el.playerInput.focus();
  });

  if (el.gameOverRetry) {
    el.gameOverRetry.addEventListener("click", function () {
      beginMatch();
    });
  }

  if (el.gameOverExit) {
    el.gameOverExit.addEventListener("click", function () {
      hideGameOverOverlay();
      resetGameBoard();
      showScreen(el.menu);
      el.playerInput.focus();
    });
  }

  if (el.gameTourHelp) {
    el.gameTourHelp.addEventListener("click", function () {
      openTour();
    });
  }

  if (el.tourNext) {
    el.tourNext.addEventListener("click", function () {
      if (tourStepIndex >= TOUR_STEPS.length - 1) {
        endTour();
        return;
      }
      tourStepIndex += 1;
      renderTourContent();
    });
  }

  if (el.tourPrev) {
    el.tourPrev.addEventListener("click", function () {
      if (tourStepIndex <= 0) return;
      tourStepIndex -= 1;
      renderTourContent();
    });
  }

  function skipTour() {
    endTour();
  }

  if (el.tourSkip) el.tourSkip.addEventListener("click", skipTour);
  if (el.tourClose) el.tourClose.addEventListener("click", skipTour);

  document.querySelectorAll("[data-tour-shade]").forEach(function (shade) {
    shade.addEventListener("click", function () {
      skipTour();
    });
  });

  window.addEventListener("resize", function () {
    if (tourOpen) layoutTour();
  });

  window.addEventListener("keydown", function (e) {
    if (!tourOpen) return;
    if (e.key === "Escape") {
      skipTour();
    }
  });

  /**
   * تهيئة كل تحميل: فرض الترتيب تحميل → قائمة فقط (لا بقاء على شاشة اللعبة بعد refresh).
   */
  window.addEventListener("DOMContentLoaded", function () {
    state.tutorialGatePassed = false;
    updatePlayButtonState();
    showScreen(el.loader);
    el.loader.setAttribute("aria-busy", "true");
    window.setTimeout(function () {
      el.loader.setAttribute("aria-busy", "false");
      showScreen(el.menu);
      el.playerInput.focus();
    }, LOADER_MS);
  });

  updateHudMessage();
  el.scoreTotal.textContent = String(WORD_BANK.length);
  if (el.queueCount) el.queueCount.textContent = "0";
})();
