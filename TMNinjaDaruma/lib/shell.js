/* =========================================================================
 * shell.js — ゲームシェル（threejs-factory 共通ランタイム）
 *
 * 各ゲームは Shell.registerGame(def) を呼ぶだけでよい。シェルが
 * タイトル → プレイ → リザルトの状態遷移、HUD、ベストスコア保存、
 * 広告導線（インタースティシャル/リワード）、効果音、入力正規化、
 * リサイズ、ゲームループを提供する。
 *
 * ゲーム定義（def）の契約:
 *   id          : 'TFXxx'（localStorage キー等に使用）
 *   title       : 表示名（日本語）
 *   howto       : 一言ルール（タイトル画面に表示）
 *   scoreLabel  : スコア単位（'m', '個', '回' など。省略可）
 *   bg          : 背景色 0xRRGGBB（省略時スカイブルー）
 *   fogNear/fogFar : フォグ（省略可）
 *   cameraFov / cameraPos / cameraLookAt : 初期カメラ（省略可）
 *   higherIsBetter : false にすると小さいほど良い記録（省略時 true）
 *   allowContinue  : true でゲームオーバー時にリワードコンティニュー提示
 *   init(ctx)      : 初回のみ。シーン構築。
 *   start(ctx)     : プレイ開始ごと。状態リセット。
 *   update(ctx,dt) : 毎フレーム（PLAYING 中のみ）。dt は秒（最大 0.05）。
 *   onPointerDown/Move/Up(ctx, p) : p = {x, y, nx, ny, dx, dy}
 *        nx,ny は -1..1 正規化座標、dx,dy は Move 時の移動量(px)。
 *   onContinue(ctx): リワードコンティニュー成立時（allowContinue 時のみ）。
 *
 * ctx が提供するもの:
 *   THREE, scene, camera, renderer, width, height, dpr
 *   setScore(v) / addScore(v) / score
 *   endGame(finalScore)   … リザルトへ（広告導線はシェルが処理）
 *   gameOver(finalScore)  … endGame と同じだが「失敗」演出・コンティニュー対象
 *   sfx.tap() .score() .success() .fail() .bounce()
 *   vibrate(ms)
 *   setHint(text)         … プレイ中の小ヒント表示
 *   elapsed               … プレイ開始からの秒
 *   random()              … シード無し Math.random ラッパ
 * ========================================================================= */
(function () {
  'use strict';

  /* =======================================================================
   * Style — 共通アートディレクション「ソフトクレイ / フェルト調」
   *   マット・角丸・パステル(暖色+寒色)・柔らか陰影・ノンテカリ。
   *   全ゲーム共通。game.js から window.Style で参照する:
   *     Style.mat(color)          … 統一マット材質(MeshStandard, 高roughness)
   *     Style.pick(i) / .palette  … パステル配色(暖色+寒色)
   *     Style.roundedBox(w,h,d,r) … 角丸ボックス(r128コアに無いので自前生成)
   *     Style.lights(scene)       … 柔らか照明セット(shellが全ゲームに適用)
   *     Style.softShadow(radius)  … ぼかし接地シャドウ(影の代替・地に足感)
   * ===================================================================== */
  var Style = (function () {
    // 暖色(クリーム/桃/若草) + 寒色(水色/藤/ミント) の広いパステル。少しくすませて優しく。
    var P = {
      cream: 0xfaf3e0, butter: 0xffe9a8, peach: 0xffcdb2, apricot: 0xffb4a2,
      rose: 0xf6c6d0, grass: 0xc7e9a8, sky: 0xbfe3f2, aqua: 0xa8dadc,
      mint: 0xbfe8d4, wisteria: 0xcdb4f0, lavender: 0xdcd0f5, sand: 0xeaddc4
    };
    var LIST = Object.keys(P).map(function (k) { return P[k]; });
    function T() { return window.THREE; }
    return {
      palette: P,
      list: LIST,
      pick: function (i) {
        if (i == null) return LIST[(Math.random() * LIST.length) | 0];
        return LIST[((i % LIST.length) + LIST.length) % LIST.length];
      },
      // 統一マット材質。テカリ無し(metalness 0・roughness 高)でクレイ質感。
      mat: function (color, opts) {
        opts = opts || {};
        return new (T().MeshStandardMaterial)({
          color: color == null ? P.cream : color,
          roughness: opts.roughness != null ? opts.roughness : 0.95,
          metalness: 0.0,
          flatShading: !!opts.flat,
          emissive: opts.emissive != null ? opts.emissive : 0x000000,
          transparent: !!opts.transparent,
          opacity: opts.opacity != null ? opts.opacity : 1,
          side: opts.side != null ? opts.side : T().FrontSide
        });
      },
      // 角丸ボックス: BoxGeometry を角丸立方体SDFへ射影して丸みを付ける。
      roundedBox: function (w, h, d, r, seg) {
        var THREE = T();
        seg = seg || 5;
        r = Math.min(r == null ? Math.min(w, h, d) * 0.18 : r, w / 2, h / 2, d / 2);
        var g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
        var pos = g.attributes.position;
        var hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
        var vx, vy, vz, cx, cy, cz, dx, dy, dz, len;
        for (var i = 0; i < pos.count; i++) {
          vx = pos.getX(i); vy = pos.getY(i); vz = pos.getZ(i);
          cx = Math.max(-hx, Math.min(hx, vx));
          cy = Math.max(-hy, Math.min(hy, vy));
          cz = Math.max(-hz, Math.min(hz, vz));
          dx = vx - cx; dy = vy - cy; dz = vz - cz;
          len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (len > 1e-5) {
            var s = r / len;
            pos.setXYZ(i, cx + dx * s, cy + dy * s, cz + dz * s);
          }
        }
        g.computeVertexNormals();
        return g;
      },
      // 柔らか照明: 半球光(空↔地)主体・弱いキー(暖色)＋寒色フィル。ハード影なし・低コントラスト。
      lights: function (scene) {
        var THREE = T();
        var hemi = new THREE.HemisphereLight(0xfff6ec, 0xe4dccb, 0.98);
        scene.add(hemi);
        var key = new THREE.DirectionalLight(0xfff2e0, 0.42);
        key.position.set(4, 9, 6);
        scene.add(key);
        var fill = new THREE.DirectionalLight(0xe3ecff, 0.22);
        fill.position.set(-5, 4, -4);
        scene.add(fill);
        return { hemi: hemi, key: key, fill: fill };
      },
      // ぼかし接地シャドウ(丸)。影の代替。返り値の Mesh を対象の真下に置く。
      softShadow: function (radius) {
        var THREE = T();
        radius = radius || 1;
        var cv = document.createElement('canvas'); cv.width = cv.height = 128;
        var g2 = cv.getContext('2d');
        var grd = g2.createRadialGradient(64, 64, 4, 64, 64, 62);
        grd.addColorStop(0, 'rgba(70,60,48,0.30)');
        grd.addColorStop(1, 'rgba(70,60,48,0)');
        g2.fillStyle = grd; g2.fillRect(0, 0, 128, 128);
        var m = new THREE.Mesh(
          new THREE.PlaneGeometry(radius * 2, radius * 2),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        return m;
      }
    };
  })();
  window.Style = Style;

  var STATE = { TITLE: 0, PLAYING: 1, RESULT: 2 };

  var Shell = {
    state: STATE.TITLE,
    def: null,
    ctx: null,
    _raf: 0,
    _lastT: 0,
    _usedContinue: false
  };

  /* ---------------- i18n（多言語対応） ----------------
   * 対応: en(既定) ja es pt-BR fr de it ko zh-Hans tr
   * 端末言語を自動判定し、未対応言語は英語にフォールバック。
   * テスト用に ?lang=xx / window.GAME_LANG で上書き可能。
   * ゲーム側は title/howto/scoreLabel を文字列 or {en:..,ja:..} マップで渡せ、
   * ヒントは ctx.t({en:'Tap!', ja:'タップ！'}) で多言語化できる。 */
  var LANGS = ['en', 'ja', 'es', 'pt-BR', 'fr', 'de', 'it', 'ko', 'zh-Hans', 'tr'];
  function detectLang() {
    var q = (location.search.match(/[?&]lang=([\w-]+)/) || [])[1];
    var raw = (q || window.GAME_LANG || navigator.language || 'en').toLowerCase();
    if (raw.indexOf('ja') === 0) return 'ja';
    if (raw.indexOf('pt') === 0) return 'pt-BR';
    if (raw.indexOf('zh') === 0) return 'zh-Hans';
    if (raw.indexOf('es') === 0) return 'es';
    if (raw.indexOf('fr') === 0) return 'fr';
    if (raw.indexOf('de') === 0) return 'de';
    if (raw.indexOf('it') === 0) return 'it';
    if (raw.indexOf('ko') === 0) return 'ko';
    if (raw.indexOf('tr') === 0) return 'tr';
    return 'en';
  }
  Shell.lang = detectLang();
  document.documentElement.lang = Shell.lang;

  // v が文字列ならそのまま。{en,ja,..} マップなら 現言語→en→ja→先頭 の順で解決。
  Shell.tr = function (v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    return v[Shell.lang] || v.en || v.ja || v[Object.keys(v)[0]] || '';
  };

  // シェル共通UI文言（全ゲーム共通のボタン・結果画面）
  var UI_STR = {
    play:        { en: 'PLAY', ja: 'あそぶ', es: 'JUGAR', 'pt-BR': 'JOGAR', fr: 'JOUER', de: 'SPIELEN', it: 'GIOCA', ko: '플레이', 'zh-Hans': '开始', tr: 'OYNA' },
    retry:       { en: 'RETRY', ja: 'もういっかい', es: 'REINTENTAR', 'pt-BR': 'DE NOVO', fr: 'REJOUER', de: 'NOCHMAL', it: 'RIPROVA', ko: '다시하기', 'zh-Hans': '再玩一次', tr: 'TEKRAR' },
    recordHead:  { en: 'SCORE', ja: 'きろく', es: 'PUNTUACIÓN', 'pt-BR': 'PONTUAÇÃO', fr: 'SCORE', de: 'PUNKTE', it: 'PUNTEGGIO', ko: '점수', 'zh-Hans': '得分', tr: 'SKOR' },
    failHead:    { en: 'GAME OVER', ja: 'ざんねん…', es: 'FIN', 'pt-BR': 'FIM DE JOGO', fr: 'PERDU…', de: 'VORBEI…', it: 'GAME OVER', ko: '게임 오버', 'zh-Hans': '游戏结束', tr: 'OYUN BİTTİ' },
    newRecord:   { en: '✨ NEW BEST! ✨', ja: '✨ しんきろく！ ✨', es: '✨ ¡RÉCORD! ✨', 'pt-BR': '✨ NOVO RECORDE! ✨', fr: '✨ RECORD ! ✨', de: '✨ REKORD! ✨', it: '✨ RECORD! ✨', ko: '✨ 신기록! ✨', 'zh-Hans': '✨ 新纪录！ ✨', tr: '✨ REKOR! ✨' },
    bestLabel:   { en: 'BEST', ja: 'これまでのきろく', es: 'MEJOR', 'pt-BR': 'MELHOR', fr: 'MEILLEUR', de: 'BESTE', it: 'MIGLIORE', ko: '최고 기록', 'zh-Hans': '最佳', tr: 'EN İYİ' },
    noRecord:    { en: 'No record yet', ja: 'まだきろくなし', es: 'Sin récord', 'pt-BR': 'Sem recorde', fr: 'Pas de record', de: 'Kein Rekord', it: 'Nessun record', ko: '기록 없음', 'zh-Hans': '暂无记录', tr: 'Kayıt yok' },
    bestPrefix:  { en: 'Best: ', ja: 'ベスト: ', es: 'Mejor: ', 'pt-BR': 'Melhor: ', fr: 'Meilleur : ', de: 'Beste: ', it: 'Migliore: ', ko: '최고: ', 'zh-Hans': '最佳: ', tr: 'En iyi: ' },
    continueAd:  { en: '▶ CONTINUE (Ad)', ja: '▶ つづきから（広告）', es: '▶ CONTINUAR (Anuncio)', 'pt-BR': '▶ CONTINUAR (Anúncio)', fr: '▶ CONTINUER (Pub)', de: '▶ WEITER (Werbung)', it: '▶ CONTINUA (Ad)', ko: '▶ 이어하기 (광고)', 'zh-Hans': '▶ 继续（广告）', tr: '▶ DEVAM (Reklam)' },
    doubleAd:    { en: '🎁 DOUBLE SCORE (Ad)', ja: '🎁 スコア2ばい（広告）', es: '🎁 DOBLE (Anuncio)', 'pt-BR': '🎁 DOBRAR (Anúncio)', fr: '🎁 SCORE x2 (Pub)', de: '🎁 X2 PUNKTE (Werbung)', it: '🎁 x2 (Ad)', ko: '🎁 점수 2배 (광고)', 'zh-Hans': '🎁 得分翻倍（广告）', tr: '🎁 2X SKOR (Reklam)' }
  };
  function uiStr(key) { var m = UI_STR[key]; return (m && (m[Shell.lang] || m.en)) || key; }
  Shell.uiStr = uiStr;

  /* ---------------- DOM / UI ---------------- */
  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || document.body).appendChild(e);
    return e;
  }

  var ui = {};

  function buildUI(def) {
    ui.hud = el('div', 'sh-hud');
    ui.score = el('div', 'sh-score', ui.hud, '0');
    ui.hint = el('div', 'sh-hint', ui.hud, '');

    // TOP画面（全ゲーム共通）: タイトル・あそびかた・これまでのきろく(常時表示)・スタートボタン
    ui.title = el('div', 'sh-panel sh-title');
    el('h1', null, ui.title, Shell.tr(def.title));
    el('p', 'sh-howto', ui.title, Shell.tr(def.howto));
    var bestBox = el('p', 'sh-best-top', ui.title,
      '<span class="sh-best-label"></span>');
    bestBox.firstChild.textContent = uiStr('bestLabel');
    ui.best0 = el('span', null, bestBox, '');
    ui.playBtn = el('button', 'sh-btn sh-btn-main', ui.title, uiStr('play'));

    ui.result = el('div', 'sh-panel sh-result');
    ui.resultHead = el('h2', null, ui.result, uiStr('recordHead'));
    ui.finalScore = el('div', 'sh-final', ui.result, '0');
    ui.best = el('p', 'sh-best', ui.result, '');
    ui.newBadge = el('div', 'sh-new', ui.result, uiStr('newRecord'));
    ui.continueBtn = el('button', 'sh-btn sh-btn-reward', ui.result, uiStr('continueAd'));
    ui.doubleBtn = el('button', 'sh-btn sh-btn-reward', ui.result, uiStr('doubleAd'));
    ui.retryBtn = el('button', 'sh-btn sh-btn-main', ui.result, uiStr('retry'));

    ui.result.style.display = 'none';
    ui.hud.style.display = 'none';
  }

  /* ---------------- 効果音（WebAudio 生成・アセット不要） ---------------- */
  var AC = null;
  function ac() {
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) AC = new C();
    }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function beep(freq, dur, type, vol, slide) {
    var a = ac(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, a.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.15, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  }
  var sfx = {
    tap:     function () { beep(600, 0.06, 'square', 0.08); },
    score:   function () { beep(880, 0.09, 'sine', 0.12, 1320); },
    bounce:  function () { beep(300, 0.08, 'triangle', 0.1, 200); },
    success: function () { beep(660, 0.12, 'sine', 0.15, 990); setTimeout(function(){ beep(990, 0.18, 'sine', 0.15, 1320); }, 110); },
    fail:    function () { beep(220, 0.25, 'sawtooth', 0.12, 110); }
  };

  /* ---------------- ベストスコア ---------------- */
  function bestKey() { return 'tf_best_' + Shell.def.id; }
  function loadBest() {
    var v = localStorage.getItem(bestKey());
    return v == null ? null : parseFloat(v);
  }
  function saveBest(v) { localStorage.setItem(bestKey(), String(v)); }
  function isBetter(a, b) {
    if (b == null) return true;
    return Shell.def.higherIsBetter === false ? a < b : a > b;
  }
  function fmt(v) {
    var s = (Math.round(v * 10) / 10);
    s = (s % 1 === 0) ? String(s) : s.toFixed(1);
    return s + (Shell.def.scoreLabel ? ' ' + Shell.tr(Shell.def.scoreLabel) : '');
  }

  /* ---------------- Three.js セットアップ ---------------- */
  function buildThree(def) {
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false; // モバイル60fps優先。影は各ゲームが軽量表現で代替
    document.body.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(def.bg != null ? def.bg : 0x87ceeb);
    if (def.fogNear != null) scene.fog = new THREE.Fog(scene.background, def.fogNear, def.fogFar || def.fogNear * 3);

    var camera = new THREE.PerspectiveCamera(def.cameraFov || 60,
      window.innerWidth / window.innerHeight, 0.1, 500);
    var cp = def.cameraPos || [0, 5, 10];
    camera.position.set(cp[0], cp[1], cp[2]);
    var cl = def.cameraLookAt || [0, 0, 0];
    camera.lookAt(cl[0], cl[1], cl[2]);

    // 縦持ち実機対応: def.fitWidth (ワールド単位) を宣言すると、注視点距離で
    // その横幅が必ず画面内に収まるよう FOV を広げる（iPhone縦の狭い横視野対策）。
    // 縮める方向には働かない（横長画面では cameraFov のまま）。
    function applyFitWidth() {
      if (!def.fitWidth) return;
      var dx = cp[0] - cl[0], dy = cp[1] - cl[1], dz = cp[2] - cl[2];
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var hFov = 2 * Math.atan((def.fitWidth / 2) / dist);
      var vFov = 2 * Math.atan(Math.tan(hFov / 2) / camera.aspect);
      var deg = vFov * 180 / Math.PI;
      camera.fov = Math.max(def.cameraFov || 60, deg);
      camera.updateProjectionMatrix();
    }
    applyFitWidth();

    var amb = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(amb);
    var dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    window.addEventListener('resize', function () {
      var w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applyFitWidth();
      Shell.ctx.width = w; Shell.ctx.height = h;
      if (Shell.def.onResize) Shell.def.onResize(Shell.ctx, w, h);
    });

    return { renderer: renderer, scene: scene, camera: camera, dpr: dpr };
  }

  /* ---------------- 入力正規化 ---------------- */
  var lastPX = 0, lastPY = 0, pointerDown = false;
  function pt(e) {
    var t = (e.changedTouches && e.changedTouches[0]) || e;
    var x = t.clientX, y = t.clientY;
    var p = {
      x: x, y: y,
      nx: (x / window.innerWidth) * 2 - 1,
      ny: -((y / window.innerHeight) * 2 - 1),
      dx: x - lastPX, dy: y - lastPY
    };
    lastPX = x; lastPY = y;
    return p;
  }
  function bindInput(canvas) {
    function down(e) {
      e.preventDefault(); ac();
      var p = pt(e); p.dx = 0; p.dy = 0; pointerDown = true;
      if (Shell.state === STATE.PLAYING && Shell.def.onPointerDown) Shell.def.onPointerDown(Shell.ctx, p);
    }
    function move(e) {
      e.preventDefault();
      if (!pointerDown) return;
      var p = pt(e);
      if (Shell.state === STATE.PLAYING && Shell.def.onPointerMove) Shell.def.onPointerMove(Shell.ctx, p);
    }
    function up(e) {
      e.preventDefault();
      if (!pointerDown) return;
      pointerDown = false;
      var p = pt(e);
      if (Shell.state === STATE.PLAYING && Shell.def.onPointerUp) Shell.def.onPointerUp(Shell.ctx, p);
    }
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', up, { passive: false });
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', up);
  }

  /* ---------------- 状態遷移 ---------------- */
  function showTitle() {
    Shell.state = STATE.TITLE;
    var b = loadBest();
    ui.best0.textContent = b == null ? uiStr('noRecord') : fmt(b);
    ui.title.style.display = '';
    ui.result.style.display = 'none';
    ui.hud.style.display = 'none';
  }

  function startPlay() {
    Shell.state = STATE.PLAYING;
    Shell._usedContinue = false;
    ui.title.style.display = 'none';
    ui.result.style.display = 'none';
    ui.hud.style.display = '';
    ui.hint.textContent = '';
    Shell.ctx.score = 0;
    Shell.ctx._startT = performance.now();
    Shell.ctx.elapsed = 0;
    ui.score.textContent = fmt(0);
    Shell.def.start(Shell.ctx);
  }

  function resumePlay() { // コンティニュー
    Shell.state = STATE.PLAYING;
    ui.result.style.display = 'none';
    ui.hud.style.display = '';
  }

  function showResult(finalScore, failed, headText) {
    Shell.state = STATE.RESULT;
    Shell.ctx.score = finalScore;
    var best = loadBest();
    var record = isBetter(finalScore, best);
    if (record) saveBest(finalScore);

    ui.hud.style.display = 'none';
    ui.resultHead.textContent = failed ? (Shell.tr(headText) || uiStr('failHead')) : uiStr('recordHead');
    ui.finalScore.textContent = fmt(finalScore);
    ui.best.textContent = uiStr('bestPrefix') + fmt(record ? finalScore : best);
    ui.newBadge.style.display = record && best != null ? '' : 'none';
    if (record && best != null) sfx.success(); else if (failed) sfx.fail();

    var canContinue = failed && Shell.def.allowContinue && !Shell._usedContinue &&
                      window.GameAds && GameAds.rewardedAvailable();
    ui.continueBtn.style.display = canContinue ? '' : 'none';
    var canDouble = !canContinue && window.GameAds && GameAds.rewardedAvailable() && finalScore > 0 &&
                    Shell.def.higherIsBetter !== false;
    ui.doubleBtn.style.display = canDouble ? '' : 'none';

    // スコア送信（バックエンド有効時のみ・Functions 経由）
    if (window.GameBackend && GameBackend.available) {
      GameBackend.submitScore(Shell.def.id, finalScore, Math.round(performance.now() - Shell.ctx._startT));
    }

    // インタースティシャル（頻度制御は GameAds 側）
    if (window.GameAds) {
      GameAds.maybeShowInterstitial(function () {
        ui.result.style.display = '';
      });
      ui.result.style.display = ''; // ネイティブ広告はオーバーレイなので下に出しておく
    } else {
      ui.result.style.display = '';
    }
  }

  /* ---------------- メインループ ---------------- */
  function loop(t) {
    Shell._raf = requestAnimationFrame(loop);
    var dt = Math.min((t - Shell._lastT) / 1000, 0.05);
    Shell._lastT = t;
    if (Shell.state === STATE.PLAYING) {
      Shell.ctx.elapsed = (performance.now() - Shell.ctx._startT) / 1000;
      Shell.def.update(Shell.ctx, dt);
    }
    Shell.ctx.renderer.render(Shell.ctx.scene, Shell.ctx.camera);
  }

  /* ---------------- 公開 API ---------------- */
  Shell.registerGame = function (def) {
    Shell.def = def;
    document.title = Shell.tr(def.title);
    buildUI(def);

    var three = buildThree(def);
    var ctx = {
      THREE: THREE,
      scene: three.scene,
      camera: three.camera,
      renderer: three.renderer,
      dpr: three.dpr,
      width: window.innerWidth,
      height: window.innerHeight,
      score: 0,
      elapsed: 0,
      sfx: sfx,
      random: function () { return Math.random(); },
      vibrate: function (ms) { if (navigator.vibrate) navigator.vibrate(ms || 30); },
      lang: Shell.lang,
      t: Shell.tr,   // ctx.t({en:'Tap!', ja:'タップ！'}) で多言語ヒント
      setScore: function (v) { ctx.score = v; ui.score.textContent = fmt(v); },
      addScore: function (v) { ctx.setScore(ctx.score + (v == null ? 1 : v)); },
      setHint: function (txt) { ui.hint.textContent = Shell.tr(txt) || ''; },
      endGame: function (s) { if (Shell.state === STATE.PLAYING) showResult(s != null ? s : ctx.score, false); },
      gameOver: function (s, msg) { if (Shell.state === STATE.PLAYING) showResult(s != null ? s : ctx.score, true, msg); }
    };
    Shell.ctx = ctx;

    bindInput(three.renderer.domElement);

    ui.playBtn.addEventListener('click', function () { ac(); startPlay(); });
    ui.retryBtn.addEventListener('click', function () { startPlay(); });
    ui.doubleBtn.addEventListener('click', function () {
      GameAds.showRewarded(function (granted) {
        if (granted) {
          var doubled = ctx.score * 2;
          var best = loadBest();
          if (isBetter(doubled, best)) saveBest(doubled);
          ui.finalScore.textContent = fmt(doubled);
          ui.best.textContent = uiStr('bestPrefix') + fmt(isBetter(doubled, best) ? doubled : best);
          sfx.success();
        }
        ui.doubleBtn.style.display = 'none';
      });
    });
    ui.continueBtn.addEventListener('click', function () {
      GameAds.showRewarded(function (granted) {
        if (granted) {
          Shell._usedContinue = true;
          resumePlay();
          if (Shell.def.onContinue) Shell.def.onContinue(ctx);
        } else {
          ui.continueBtn.style.display = 'none';
        }
      });
    });

    def.init(ctx);
    if (window.GameBackend) GameBackend.init();
    showTitle();
    Shell._lastT = performance.now();
    Shell._raf = requestAnimationFrame(loop);
  };

  window.Shell = Shell;
})();
