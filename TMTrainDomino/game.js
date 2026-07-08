/* =========================================================================
 * TMTrainDomino — ざぶとんジャンプ（落語家の座布団積み上げ）
 * ※id は TMTrainDomino のまま（ランチャー互換）。中身は完全新規。
 *
 * ルール: 高座の落語家（うさぎ・正座）を上フリックでジャンプさせる。
 *   空中の間に新しい座布団が横からスッと山の一番上へ差し込まれ、
 *   着地すると +1枚。差し込み位置のズレが蓄積すると山が傾き、
 *   閾値を超えると崩壊 → ゲームオーバー。
 *   ★無限モード: 画面外に沈んだ下層メッシュはプール循環で上に回す。
 *   高くなるほど ①崩壊閾値が下がる ②風で山が揺れる ③差し込みが速くなる。
 *   10枚ごとに拍手＋座布団の色替わりで節目を演出。
 * 操作: 上フリック（Down→Up の上方向移動量でジャンプ力が決まる）。
 *   フリックの強さ＝滞空時間。座布団は一定速度で滑り込むので、
 *   「ちょうど中央に来た瞬間に着地する」強さを見極めるのが腕。
 * スコア: 積んだ座布団の枚数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var CUSHION_W = 1.9;       // 座布団の幅
  var CUSHION_H = 0.34;      // 座布団の厚み
  var CUSHION_D = 1.9;       // 座布団の奥行き
  var BASE_Y = 0.62;         // 高座の天面（座布団の山の底）
  var POOL_SIZE = 40;        // 座布団メッシュプール（循環再利用・枚数は無限）
  var VISIBLE_MAX = 30;      // 画面に残す最大枚数（下層はプールへ返却）
  var SLIDE_START = 3.4;     // 差し込み開始X（画面外寄り）
  var SLIDE_SPEED = 4.4;     // 差し込み基本速度（高さに応じて上昇）
  var JUMP_DUR_MIN = 0.55;   // 最弱フリックの滞空時間
  var JUMP_DUR_ADD = 0.5;    // 最強フリックで +0.5秒
  var FLICK_MIN_PX = 28;     // 上フリック成立の最小移動量(px)
  var FLICK_FULL_PX = 260;   // この移動量でジャンプ力最大
  var OFFSET_CLAMP = 1.3;    // 1枚あたりの水平ズレ上限
  var PERFECT_EPS = 0.09;    // ピタ差し判定
  var LEAN_MAX = 2.1;        // 累積ズレの崩壊閾値（基準値・高さで実効値が低下）
  var WARN_RATIO = 0.55;     // 警告開始（閾値比）
  var DUST_COUNT = 14;       // ほこりパーティクルプール
  var MILESTONE = 10;        // 節目演出の間隔（枚）
  var PHASE = { SIT: 0, AIR: 1, FALL: 2, DONE: 3 };

  /* ---------- 座布団の配色（10枚ごとの節目で色替わり） ---------- */
  var COLOR_TIERS = [
    [0x6b4fa8, 0xa93f55, 0x8d6fc4, 0x7a8f4a],  // 紫紺・緋・藤・鶯（開始）
    [0xc9563c, 0xe0a032, 0xb04a68, 0xd97f4e],  // 暖色（10〜）
    [0x3d7ea6, 0x48a58f, 0x5a6fb8, 0x40b4c4],  // 寒色（20〜）
    [0xb8963e, 0xd4b054, 0x9c7f2e, 0xe0c46e]   // 金（30〜、以降ループ）
  ];
  var CUSHION_COLORS = COLOR_TIERS[0];
  var TUFT_COLOR = 0xf0e6c8;

  /* ---------- 高さによる難易度カーブ ---------- */
  function effLeanMax() {       // ①高いほど崩壊閾値が下がる（崩れやすく）
    return Math.max(0.9, LEAN_MAX - stackCount * 0.02);
  }
  function windAmpNow() {       // ②高いほど風の揺れが強い
    return Math.min(0.55, Math.max(0, stackCount - 8) * 0.015);
  }
  function slideSpeedNow() {    // ③高いほど差し込みが速い
    return SLIDE_SPEED * (1 + Math.min(1.1, stackCount * 0.02));
  }

  /* ---------- 多言語ヒント ---------- */
  var HINT_FLICK = { en: 'Flick up to jump!', ja: 'うえにフリックでジャンプ！', es: '¡Desliza hacia arriba para saltar!', 'pt-BR': 'Deslize para cima para pular!', fr: 'Glissez vers le haut pour sauter !', de: 'Nach oben wischen zum Springen!', it: 'Scorri in su per saltare!', ko: '위로 스와이프해서 점프!', 'zh-Hans': '向上滑动跳跃！', tr: 'Zıplamak için yukarı kaydır!' };
  var HINT_WOBBLE = { en: 'Wobbling...!', ja: 'ぐらぐら…！', es: '¡Se tambalea...!', 'pt-BR': 'Balançando...!', fr: 'Ça vacille... !', de: 'Es wackelt...!', it: 'Traballa...!', ko: '흔들흔들…!', 'zh-Hans': '摇摇晃晃…！', tr: 'Sallanıyor...!' };
  var HINT_PERFECT = { en: 'Perfect! ✨', ja: 'ぴったり！✨', es: '¡Perfecto! ✨', 'pt-BR': 'Perfeito! ✨', fr: 'Parfait ! ✨', de: 'Perfekt! ✨', it: 'Perfetto! ✨', ko: '완벽! ✨', 'zh-Hans': '完美！✨', tr: 'Mükemmel! ✨' };

  /* ---------- 状態 ---------- */
  var phase;
  var cushions;        // [{entry, offset, cum, slotY}] 可視の山（下から順・最大VISIBLE_MAX）
  var stackCount;      // 論理的な総枚数（土台込み・無限に増える）
  var totalLean;       // 累積ズレ（符号付き）
  var score;
  var slideEntry;      // 差し込み中の座布団（プールエントリ）
  var slideX, slideDir, slideSlotY, slideSpeedCur;
  var windPhase, windX; // 風のゆらぎ（山全体が揺れて差し込みズレを生む）
  var jumpT, jumpDur, jumpH, seatY;
  var warnActive, warnBeepT;
  var shakeT;
  var glowT, glowMat;
  var landAnimT;
  var collapseT, collapseData; // 崩壊アニメ [{obj, x,y,vx,vy,vr,rot}]
  var bunnyVX, bunnyVY, bunnyVR;
  var camY;
  var flickDownY, flickMinY, flickValid;
  var hintState;       // 'flick' | 'wobble' | 'perfect' | '' （変化時のみ setHint）

  /* ---------- Three.js オブジェクト（init で全生成） ---------- */
  var bunny;
  var cushionPool = []; // [{group, mat}]
  var dustPool = [];    // [{mesh, active, x,y,z, vx,vy,vz, life}]
  var pileShadow;

  /* ---------- ヒント（状態変化時のみ） ---------- */
  function setHintState(ctx, s, msg) {
    if (hintState === s) return;
    hintState = s;
    ctx.setHint(msg ? ctx.t(msg) : '');
  }

  /* ---------- ほこり ---------- */
  function spawnDust(cx, cy, n) {
    var spawned = 0;
    for (var i = 0; i < DUST_COUNT && spawned < n; i++) {
      var d = dustPool[i];
      if (d.active) continue;
      d.active = true;
      var ang = Math.random() * Math.PI * 2;
      d.x = cx + Math.cos(ang) * CUSHION_W * 0.5;
      d.y = cy;
      d.z = Math.sin(ang) * CUSHION_D * 0.4 + 0.3;
      d.vx = Math.cos(ang) * (1.2 + Math.random() * 1.2);
      d.vy = 0.6 + Math.random() * 0.9;
      d.vz = Math.sin(ang) * 0.8;
      d.life = 0.55;
      d.mesh.visible = true;
      d.mesh.material.opacity = 0.7;
      var s = 0.1 + Math.random() * 0.12;
      d.mesh.scale.set(s, s, s);
      spawned++;
    }
  }

  /* ---------- 山の座標を毎フレーム反映（傾き・風ゆらぎ演出込み） ---------- */
  function layoutPile(warnStrength, now) {
    var n = cushions.length;
    for (var i = 0; i < n; i++) {
      var c = cushions[i];
      var hf = n > 1 ? i / (n - 1) : 0;
      var wobble = warnStrength > 0 && i >= n - 3
        ? Math.sin(now * 0.01 + i * 1.7) * 0.05 * warnStrength : 0;
      c.entry.group.position.x = c.cum + totalLean * 0.06 * hf * hf + windX * hf;
      c.entry.group.position.y = c.slotY;
      c.entry.group.rotation.z = -c.offset * 0.25 - totalLean * 0.05 * hf + wobble;
    }
  }

  function pileTopY() { return BASE_Y + stackCount * CUSHION_H; }
  function topCum() { return cushions.length ? cushions[cushions.length - 1].cum : 0; }

  /* ---------- 正座 / 空中ポーズ ---------- */
  function poseSit() {
    bunny.legL.rotation.x = -2.35; bunny.legR.rotation.x = -2.35;
    bunny.armL.rotation.z = -0.3; bunny.armR.rotation.z = 0.3;
    bunny.armL.rotation.x = -0.7; bunny.armR.rotation.x = -0.7;
    bunny.group.rotation.z = 0;
  }
  function poseAir() {
    bunny.legL.rotation.x = -1.2; bunny.legR.rotation.x = -1.6;
    bunny.armL.rotation.z = -2.5; bunny.armR.rotation.z = 2.5;
    bunny.armL.rotation.x = 0; bunny.armR.rotation.x = 0;
  }
  function seatBunny(x, y) {
    bunny.group.position.x = x;
    bunny.group.position.y = y - 0.42; // 正座で沈む分
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMTrainDomino',
    title: { en: 'Cushion Stack', ja: 'ざぶとんジャンプ', es: 'Torre de Cojines', 'pt-BR': 'Pilha de Almofadas', fr: 'Pile de Coussins', de: 'Kissen-Stapel', it: 'Pila di Cuscini', ko: '방석 점프', 'zh-Hans': '坐垫跳跃', tr: 'Minder Kulesi' },
    howto: { en: 'Flick up to make the performer jump!\nA new cushion slides in while airborne.\nLand centered — too much lean and it all falls!', ja: 'うえにフリックでジャンプ！\n空中のあいだに ざぶとんが すべりこむ\nまんなかに着地！かたむきすぎると くずれるよ！', es: '¡Desliza arriba para saltar!\nUn cojín se desliza mientras estás en el aire.\n¡Aterriza centrado o todo se caerá!', 'pt-BR': 'Deslize para cima para pular!\nUma almofada desliza enquanto está no ar.\nPouse no centro — se inclinar demais, cai tudo!', fr: 'Glissez vers le haut pour sauter !\nUn coussin se glisse pendant le saut.\nAtterrissez au centre, sinon tout s\'écroule !', de: 'Nach oben wischen zum Springen!\nIn der Luft rutscht ein Kissen hinein.\nMittig landen — sonst kippt alles um!', it: 'Scorri in su per saltare!\nUn cuscino scivola dentro mentre sei in aria.\nAtterra al centro o crolla tutto!', ko: '위로 스와이프해서 점프!\n공중에 있는 동안 방석이 끼워진다.\n가운데 착지! 너무 기울면 무너져요!', 'zh-Hans': '向上滑动让表演者跳起！\n空中时坐垫会滑入。\n落在正中央——太歪就全塌了！', tr: 'Zıplamak için yukarı kaydır!\nHavadayken yeni minder kayar.\nOrtaya in — çok eğilirse hepsi devrilir!' },
    scoreLabel: { en: 'cushions', ja: 'まい', es: 'cojines', 'pt-BR': 'almofadas', fr: 'coussins', de: 'Kissen', it: 'cuscini', ko: '장', 'zh-Hans': '块', tr: 'minder' },
    bg: 0x2e1f33,
    cameraFov: 55,
    cameraPos: [0, 3.4, 8.6],
    cameraLookAt: [0, 1.5, 0],
    fitWidth: 8.5,

    init: function (ctx) {
      var THREE = ctx.THREE;

      /* --- 床（寄席の板の間） --- */
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 20), Style.mat(0x5a4030));
      floor.rotation.x = -Math.PI / 2;
      ctx.scene.add(floor);

      /* --- 高座（緋毛氈の台） --- */
      var daiWood = new THREE.Mesh(Style.roundedBox(5.2, 0.5, 3.4, 0.08), Style.mat(0x3f2c1e));
      daiWood.position.set(0, 0.25, 0);
      ctx.scene.add(daiWood);
      var carpet = new THREE.Mesh(Style.roundedBox(5.0, 0.16, 3.2, 0.06), Style.mat(0x9c2f3a));
      carpet.position.set(0, 0.54, 0);
      ctx.scene.add(carpet);

      /* --- 金屏風（パネル4枚・交互に少し角度） --- */
      var pg = new THREE.PlaneGeometry(1.7, 4.6);
      for (var bi = 0; bi < 4; bi++) {
        var panel = new THREE.Mesh(pg, Style.mat(bi % 2 ? 0xd9b45a : 0xe4c46e, { roughness: 0.7 }));
        panel.position.set(-2.55 + bi * 1.7, 2.5, -2.6 + (bi % 2 ? 0.12 : 0));
        panel.rotation.y = (bi % 2 ? -1 : 1) * 0.09;
        ctx.scene.add(panel);
        var frame = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 4.6), Style.mat(0x2a1c12));
        frame.position.set(panel.position.x - 0.85, 2.5, panel.position.z + 0.01);
        frame.rotation.y = panel.rotation.y;
        ctx.scene.add(frame);
      }

      /* --- めくり（白地に赤枠・文字なしの飾り模様） --- */
      var cv = document.createElement('canvas');
      cv.width = 96; cv.height = 192;
      var c2 = cv.getContext('2d');
      c2.fillStyle = '#f6efe0'; c2.fillRect(0, 0, 96, 192);
      c2.strokeStyle = '#c23b2e'; c2.lineWidth = 8;
      c2.strokeRect(8, 8, 80, 176);
      c2.fillStyle = '#c23b2e';
      c2.beginPath(); c2.arc(48, 60, 14, 0, Math.PI * 2); c2.fill();
      c2.fillRect(40, 96, 16, 60);
      var mekuri = new THREE.Mesh(
        new THREE.PlaneGeometry(0.75, 1.5),
        new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) })
      );
      mekuri.position.set(2.9, 1.95, -1.3);
      mekuri.rotation.y = -0.25;
      ctx.scene.add(mekuri);
      var stand = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.5, 8), Style.mat(0x2a1c12));
      stand.position.set(2.9, 0.75, -1.32);
      ctx.scene.add(stand);

      /* --- 山の接地シャドウ --- */
      pileShadow = Style.softShadow(1.5);
      pileShadow.position.set(0, BASE_Y + 0.02, 0);
      ctx.scene.add(pileShadow);

      /* --- 座布団プール --- */
      var cushionGeo = Style.roundedBox(CUSHION_W, CUSHION_H, CUSHION_D, 0.12);
      var tuftGeo = new THREE.SphereGeometry(0.06, 8, 8);
      for (var pi = 0; pi < POOL_SIZE; pi++) {
        var g = new THREE.Group();
        var mat = Style.mat(CUSHION_COLORS[pi % CUSHION_COLORS.length]);
        var m = new THREE.Mesh(cushionGeo, mat);
        g.add(m);
        var tuft = new THREE.Mesh(tuftGeo, Style.mat(TUFT_COLOR));
        tuft.scale.set(1, 0.5, 1);
        tuft.position.y = CUSHION_H / 2;
        g.add(tuft);
        g.visible = false;
        ctx.scene.add(g);
        cushionPool.push({ group: g, mat: mat });
      }

      /* --- 落語家（うさぎ） --- */
      bunny = GameBunny.make(THREE, { scale: 0.62 });
      ctx.scene.add(bunny.group);

      /* --- ほこりプール --- */
      var dustGeo = new THREE.SphereGeometry(1, 6, 6);
      for (var di = 0; di < DUST_COUNT; di++) {
        var dMat = new THREE.MeshBasicMaterial({ color: 0xd8cbb0, transparent: true, opacity: 0, depthWrite: false });
        var dm = new THREE.Mesh(dustGeo, dMat);
        dm.visible = false;
        ctx.scene.add(dm);
        dustPool.push({ mesh: dm, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
      }
    },

    start: function (ctx) {
      var i;
      for (i = 0; i < POOL_SIZE; i++) {
        cushionPool[i].group.visible = false;
        cushionPool[i].group.rotation.z = 0;
        cushionPool[i].mat.emissive.setRGB(0, 0, 0);
        cushionPool[i].mat.color.setHex(COLOR_TIERS[0][i % COLOR_TIERS[0].length]);
      }
      for (i = 0; i < DUST_COUNT; i++) {
        dustPool[i].active = false;
        dustPool[i].mesh.visible = false;
      }

      phase = PHASE.SIT;
      cushions = [];
      stackCount = 1;
      totalLean = 0;
      score = 0;
      slideEntry = null;
      slideDir = 1;
      windPhase = 0;
      windX = 0;
      warnActive = false; warnBeepT = 0;
      shakeT = 0; glowT = 0; glowMat = null;
      landAnimT = 0;
      collapseT = 0; collapseData = null;
      camY = 1.5;
      flickValid = false;
      hintState = null;

      // 最初の1枚（土台・スコア外）
      var e0 = cushionPool[0];
      e0.group.visible = true;
      e0.group.position.set(0, BASE_Y + CUSHION_H / 2, 0);
      cushions.push({ entry: e0, offset: 0, cum: 0, slotY: BASE_Y + CUSHION_H / 2 });

      poseSit();
      seatBunny(0, pileTopY());
      bunny.group.rotation.set(0, 0, 0);
      bunny.hop(0);
      pileShadow.position.set(0, BASE_Y + 0.02, 0);

      ctx.setScore(0);
      setHintState(ctx, 'flick', HINT_FLICK);
    },

    onPointerDown: function (ctx, p) {
      flickDownY = p.y;
      flickMinY = p.y;
      flickValid = (phase === PHASE.SIT);
    },

    onPointerMove: function (ctx, p) {
      if (p.y < flickMinY) flickMinY = p.y;
    },

    onPointerUp: function (ctx, p) {
      if (!flickValid || phase !== PHASE.SIT) return;
      flickValid = false;
      var rise = flickDownY - Math.min(flickMinY, p.y);
      if (rise < FLICK_MIN_PX) return;

      // フリック量 → ジャンプ力（滞空時間）
      var power = Math.min(1, Math.max(0.12, (rise - FLICK_MIN_PX) / FLICK_FULL_PX));
      jumpDur = JUMP_DUR_MIN + JUMP_DUR_ADD * power;
      jumpH = 1.1 + power * 1.5;
      jumpT = 0;
      seatY = pileTopY();

      // 新しい座布団が横からスッと差し込まれる（プールを循環再利用・高いほど速い）
      slideDir = -slideDir;
      slideX = slideDir * SLIDE_START + topCum();
      slideSlotY = BASE_Y + stackCount * CUSHION_H + CUSHION_H / 2;
      slideSpeedCur = slideSpeedNow();
      slideEntry = cushionPool[stackCount % POOL_SIZE];
      // 節目色: 10枚ごとに座布団の色が替わる
      var tier = COLOR_TIERS[Math.floor(score / MILESTONE) % COLOR_TIERS.length];
      slideEntry.mat.color.setHex(tier[stackCount % tier.length]);
      slideEntry.mat.emissive.setRGB(0, 0, 0);
      slideEntry.group.visible = true;
      slideEntry.group.rotation.z = 0;
      slideEntry.group.position.set(slideX, slideSlotY, 0);

      phase = PHASE.AIR;
      poseAir();
      ctx.sfx.tap();
      ctx.vibrate(10);
    },

    update: function (ctx, dt) {
      var now = performance.now();
      var i;

      bunny.flop(ctx.elapsed);

      /* --- 風のゆらぎ: 高いほど山全体が揺れて差し込みズレを生む --- */
      windPhase += dt * (0.9 + Math.min(1.5, stackCount * 0.012));
      windX = Math.sin(windPhase) * windAmpNow();

      /* --- 空中: ジャンプ放物線 + 座布団スライド --- */
      if (phase === PHASE.AIR) {
        jumpT += dt;
        var nt = Math.min(1, jumpT / jumpDur);
        bunny.group.position.y = (seatY - 0.42) + jumpH * 4 * nt * (1 - nt);
        bunny.group.rotation.z = -slideDir * Math.sin(nt * Math.PI) * 0.18;

        slideX -= slideDir * slideSpeedCur * dt;
        slideEntry.group.position.x = slideX;

        if (nt >= 1) land(ctx);
      }

      /* --- 着地アニメ（屈伸） --- */
      if (landAnimT > 0) {
        landAnimT -= dt;
        bunny.hop(1 - Math.max(0, landAnimT) / 0.25);
      }

      /* --- 不安定警告: 赤ゆらぎ + 警告音 --- */
      var warnStrength = 0;
      if (phase === PHASE.SIT || phase === PHASE.AIR) {
        var ratio = Math.abs(totalLean) / effLeanMax();
        var nowWarn = ratio > WARN_RATIO;
        warnStrength = nowWarn ? (ratio - WARN_RATIO) / (1 - WARN_RATIO) : 0;
        if (nowWarn && !warnActive) {
          warnActive = true;
          warnBeepT = 0;
          setHintState(ctx, 'wobble', HINT_WOBBLE);
          ctx.vibrate(40);
        } else if (!nowWarn && warnActive) {
          warnActive = false;
          setHintState(ctx, '', null);
        }
        if (warnActive) {
          warnBeepT -= dt;
          if (warnBeepT <= 0) {
            warnBeepT = 0.85;
            ctx.sfx.bounce();
          }
        }
        layoutPile(warnStrength, now);

        // 上位3枚の赤ゆらぎ（発光中の1枚は除く）
        var n = cushions.length;
        for (i = 0; i < n; i++) {
          var mat = cushions[i].entry.mat;
          if (mat === glowMat && glowT > 0) continue;
          if (warnActive && i >= n - 3) {
            var pulse = (0.28 + 0.22 * Math.sin(now * 0.012 + i)) * (0.4 + 0.6 * warnStrength);
            mat.emissive.setRGB(pulse, 0, 0);
          } else {
            mat.emissive.setRGB(0, 0, 0);
          }
        }

        // 落語家・シャドウの追従
        if (phase === PHASE.SIT) {
          var top = cushions[cushions.length - 1];
          bunny.group.position.x = top.entry.group.position.x;
        }
        pileShadow.position.x = topCum() * 0.5;
      }

      /* --- ピタ差し発光のフェード --- */
      if (glowT > 0 && glowMat) {
        glowT -= dt;
        var gk = Math.max(0, glowT / 0.6);
        glowMat.emissive.setRGB(0.9 * gk, 0.7 * gk, 0.15 * gk);
        if (glowT <= 0) glowMat.emissive.setRGB(0, 0, 0);
      }

      /* --- 崩壊アニメ --- */
      if (phase === PHASE.FALL) {
        collapseT += dt;
        for (i = 0; i < collapseData.length; i++) {
          var cd = collapseData[i];
          cd.vy -= 14 * dt;
          cd.x += cd.vx * dt;
          cd.y += cd.vy * dt;
          cd.rot += cd.vr * dt;
          if (cd.y < BASE_Y - 2) cd.y = BASE_Y - 2;
          cd.obj.position.x = cd.x;
          cd.obj.position.y = cd.y;
          cd.obj.rotation.z = cd.rot;
        }
        // 落語家も転げ落ちる
        bunnyVY -= 14 * dt;
        bunny.group.position.x += bunnyVX * dt;
        bunny.group.position.y += bunnyVY * dt;
        bunny.group.rotation.z += bunnyVR * dt;
        if (bunny.group.position.y < BASE_Y - 1.5) bunny.group.position.y = BASE_Y - 1.5;

        if (collapseT > 1.5) {
          phase = PHASE.DONE;
          ctx.gameOver(score);
        }
      }

      /* --- ほこり --- */
      for (i = 0; i < DUST_COUNT; i++) {
        var d = dustPool[i];
        if (!d.active) continue;
        d.life -= dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        d.vy -= 1.5 * dt;
        d.mesh.position.set(d.x, d.y, d.z);
        d.mesh.material.opacity = Math.max(0, d.life / 0.55) * 0.7;
        if (d.life <= 0) {
          d.active = false;
          d.mesh.visible = false;
        }
      }

      /* --- カメラ: 山の高さに追従 + 画面揺れ --- */
      var wantY = 1.5 + Math.max(0, pileTopY() - 1.3) * 0.92;
      camY += (wantY - camY) * Math.min(1, dt * 3);
      var shX = 0, shY = 0;
      if (shakeT > 0) {
        shakeT -= dt;
        var sk = Math.max(0, shakeT / 0.3) * 0.12;
        shX = (Math.random() * 2 - 1) * sk;
        shY = (Math.random() * 2 - 1) * sk;
      }
      ctx.camera.position.set(shX, camY + 1.9 + shY, 8.6);
      ctx.camera.lookAt(0, camY, 0);
    }
  });

  /* ---------- 拍手演出（節目・WebAudio SFXの重ねがけ） ---------- */
  function applause(ctx) {
    ctx.sfx.success();
    for (var i = 0; i < 6; i++) {
      setTimeout(function () { ctx.sfx.tap(); }, 100 + Math.random() * 550);
    }
  }

  /* ---------- 着地処理 ---------- */
  function land(ctx) {
    var prevCum = topCum();
    // 風で揺れた実際の山頂位置に対するズレ（高いほど狙いにくい）
    var offset = slideX - (prevCum + windX);
    if (offset > OFFSET_CLAMP) offset = OFFSET_CLAMP;
    if (offset < -OFFSET_CLAMP) offset = -OFFSET_CLAMP;

    var landedEntry = slideEntry;
    var perfect = Math.abs(offset) < PERFECT_EPS;
    if (perfect) {
      offset = 0;
      totalLean *= 0.8; // ピタ差しは山を安定させる
      glowMat = landedEntry.mat;
      glowT = 0.6;
      ctx.sfx.score();
      setHintState(ctx, 'perfect', HINT_PERFECT);
    } else {
      totalLean += offset;
      ctx.sfx.bounce();
      if (hintState === 'perfect') setHintState(ctx, '', null);
    }

    var cum = prevCum + offset;
    landedEntry.group.position.set(cum, slideSlotY, 0);
    cushions.push({ entry: landedEntry, offset: offset, cum: cum, slotY: slideSlotY });
    slideEntry = null;
    stackCount++;

    // ★無限化: 画面外に沈んだ下層メッシュはプールへ返却（山の下から取り除いて上に回す）
    if (cushions.length > VISIBLE_MAX) {
      var bottom = cushions.shift();
      bottom.entry.group.visible = false;
      bottom.entry.mat.emissive.setRGB(0, 0, 0);
    }

    score++;
    ctx.setScore(score);
    ctx.vibrate(15);

    // 着地: 画面揺れ + ほこり
    shakeT = 0.3;
    spawnDust(cum, slideSlotY - CUSHION_H / 2, 6);

    // 落語家が正座で着地
    poseSit();
    seatBunny(cum, pileTopY());
    landAnimT = 0.25;
    phase = PHASE.SIT;

    // 崩壊判定（実効閾値は高さで低下）
    if (Math.abs(totalLean) > effLeanMax()) {
      startCollapse(ctx);
      return;
    }

    // 節目演出: 10枚ごとに拍手＋金色発光＋ほこり大放出（次層から色替わり）
    if (score % MILESTONE === 0) {
      applause(ctx);
      glowMat = landedEntry.mat;
      glowT = 0.9;
      spawnDust(cum, slideSlotY + CUSHION_H, 8);
      ctx.vibrate(40);
      hintState = 'milestone';
      ctx.setHint('👏 ' + score + '! ✨');
    }
  }

  /* ---------- 崩壊開始 ---------- */
  function startCollapse(ctx) {
    phase = PHASE.FALL;
    collapseT = 0;
    collapseData = [];
    var dir = totalLean >= 0 ? 1 : -1;
    for (var i = 1; i < cushions.length; i++) { // 土台1枚は残す
      var c = cushions[i];
      collapseData.push({
        obj: c.entry.group,
        x: c.entry.group.position.x,
        y: c.entry.group.position.y,
        vx: dir * (0.6 + i * 0.18 + Math.random() * 0.8),
        vy: 1.2 + Math.random() * 1.5,
        vr: -dir * (3 + Math.random() * 4),
        rot: c.entry.group.rotation.z
      });
      c.entry.mat.emissive.setRGB(0, 0, 0);
    }
    bunnyVX = dir * 2.6;
    bunnyVY = 3.2;
    bunnyVR = -dir * 7;
    poseAir();
    setHintState(ctx, '', null);
    ctx.sfx.fail();
    ctx.vibrate(120);
    shakeT = 0.3;
  }
})();
