/* =========================================================================
 * TMSubPearl — せんすいかんパール
 * コンセプト: 深度スコア制の縦スクロール潜水。
 *   潜水艦は画面上部寄りに固定され、世界が上へ流れてどんどん深く潜る。
 *   酸素は時間で減り、パール入りの光る泡を取ると回復（深いほど回復量UP）。
 *   クラゲ・岩にぶつかると酸素が大きく減る。酸素0でゲームオーバー。
 *   スコア = 最終到達深度（m）。深くなるほど背景が暗くなり、
 *   障害物が増え、潜水艦のライト円錐が目立つ。
 * 操作: ドラッグ（左右タッチ）で潜水艦を横移動。潜行は自動で徐々に加速。
 * スコア: 到達深度 m
 * allowContinue: true（酸素を回復してその場から再開）
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  var X_LIMIT   = 4.2;   // 潜水艦の横移動範囲
  var SUB_Y     = 4.2;   // 潜水艦の画面内固定Y（上部寄り）
  var SPAWN_Y   = -14;   // 出現位置（縦持ちの広い視野でも画面下の外）
  var DESPAWN_Y = 13;    // 画面上へ抜けたら回収
  var DEPTH_PER_UNIT = 2.0; // ワールド1単位 = 2m

  var AIR_MAX        = 100;
  var AIR_DRAIN_BASE = 5.5;  // 毎秒の基礎消費
  var AIR_DRAIN_GAIN = 0.008;// 深度による追加消費（/m）
  var AIR_DRAIN_CAP  = 4.0;  // 追加消費の上限
  var HIT_DMG        = 22;   // 障害物ダメージ
  var PEARL_AIR_BASE = 16;   // パール回復の基礎量
  var PEARL_AIR_GAIN = 0.03; // 深いほど回復UP（/m）
  var PEARL_AIR_CAP  = 14;   // 追加回復の上限
  var INVULN_TIME    = 1.2;  // 被弾後の無敵秒

  var SPEED_BASE = 3.0;      // 潜行スクロール速度（world/s）
  var SPEED_GAIN = 0.006;    // 深度による加速（/m）
  var SPEED_CAP  = 3.0;      // 加速上限（base+cap = 6.0）

  /* ---- プール定数 ---- */
  var PEARL_COUNT  = 8;
  var JELLY_COUNT  = 8;
  var ROCK_COUNT   = 6;
  var BUBBLE_COUNT = 24;
  var KELP_COUNT   = 5;

  /* ---- シーンオブジェクト ---- */
  var subGroup, subBody, subTower, subPropeller;
  var lightCone, lightConeMat;   // 深海で目立つライト円錐
  var seaSurface;
  var pearlGroups = [];  // プール（光る泡＋中のパール）
  var jellyMeshes = [];  // プール
  var rockMeshes  = [];  // プール
  var bubbleMeshes = []; // プール（装飾の泡）
  var kelpGroups  = [];  // プール（海藻・スクロール装飾）
  var pearlData = [];    // {active, x, y, phase}
  var jellyData = [];    // {active, x, y, vx, phase}
  var rockData  = [];    // {active, x, y, r}
  var bubbleData = [];   // {active, x, y, vy}
  var kelpData  = [];    // {active, x, y}

  /* ---- 状態 ---- */
  var subX, subVX, subTargetX;
  var depth;         // 到達深度（m）＝スコア
  var shownDepth;    // 表示済み深度（DOM更新間引き）
  var nextMilestone; // 次の深度マイルストーン表示
  var air;
  var gameActive;
  var invulnT;       // 被弾後無敵の残り秒
  var hitFlashT;     // 被弾フラッシュ残り秒
  var pearlFlashT;   // パール取得フラッシュ残り秒
  var pearlTimer, jellyTimer, rockTimer, kelpTimer;

  /* ---- UI ---- */
  var airBarBg, airBarEl;

  /* ---- マテリアル（共有） ---- */
  var subMat, towerMat, propMat;
  var pearlShellMat, pearlCoreMat, jellyMat, jellyGelMat, rockMat, bubbleMat, kelpMat;
  var bgShallow, bgMid, bgDeep, bgWork; // 深度別背景色（補間用）

  /* ---- 深度に応じた潜行速度 ---- */
  function scrollSpeed() {
    return SPEED_BASE + Math.min(SPEED_CAP, depth * SPEED_GAIN);
  }

  /* ---- パールを画面下に出現 ---- */
  function spawnPearl(i) {
    pearlData[i].active = true;
    pearlData[i].x = (Math.random() - 0.5) * 2 * (X_LIMIT - 0.3);
    pearlData[i].y = SPAWN_Y - Math.random() * 2;
    pearlData[i].phase = Math.random() * Math.PI * 2;
    pearlGroups[i].position.set(pearlData[i].x, pearlData[i].y, 0);
    pearlGroups[i].visible = true;
  }

  /* ---- クラゲを画面下に出現 ---- */
  function spawnJelly(i) {
    jellyData[i].active = true;
    jellyData[i].x = (Math.random() - 0.5) * 2 * (X_LIMIT - 0.2);
    jellyData[i].y = SPAWN_Y - Math.random() * 2;
    jellyData[i].vx = (Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.8 + Math.min(1.0, depth * 0.002));
    jellyData[i].phase = Math.random() * Math.PI * 2;
    jellyMeshes[i].position.set(jellyData[i].x, jellyData[i].y, 0);
    jellyMeshes[i].visible = true;
  }

  /* ---- 岩を画面下に出現 ---- */
  function spawnRock(i) {
    rockData[i].active = true;
    rockData[i].x = (Math.random() - 0.5) * 2 * X_LIMIT;
    rockData[i].y = SPAWN_Y - Math.random() * 3;
    rockData[i].r = 0.7 + Math.random() * 0.5;
    var rm = rockMeshes[i];
    rm.position.set(rockData[i].x, rockData[i].y, 0);
    rm.scale.set(rockData[i].r * (1.1 + Math.random() * 0.5), rockData[i].r, rockData[i].r);
    rm.rotation.z = Math.random() * Math.PI * 2;
    rm.visible = true;
  }

  /* ---- 装飾の泡を出現 ---- */
  function spawnBubble(i, anywhere) {
    bubbleData[i].active = true;
    bubbleData[i].x = (Math.random() - 0.5) * 2 * (X_LIMIT + 0.6);
    bubbleData[i].y = anywhere ? (Math.random() * 18 - 9) : (SPAWN_Y - Math.random() * 2);
    bubbleData[i].vy = 1.2 + Math.random() * 1.6;
    bubbleMeshes[i].position.set(bubbleData[i].x, bubbleData[i].y, (Math.random() - 0.5) * 2);
    bubbleMeshes[i].visible = true;
  }

  /* ---- 海藻を左右端に出現（浅場のみ・移動感の演出）---- */
  function spawnKelp(i) {
    kelpData[i].active = true;
    kelpData[i].x = (Math.random() < 0.5 ? -1 : 1) * (X_LIMIT + 0.3 + Math.random() * 0.6);
    kelpData[i].y = SPAWN_Y - Math.random() * 2;
    kelpGroups[i].position.set(kelpData[i].x, kelpData[i].y, -1.2);
    kelpGroups[i].visible = true;
  }

  /* ---- 空気バー更新 ---- */
  function updateAirBar() {
    if (!airBarEl) return;
    var pct = Math.max(0, air / AIR_MAX * 100);
    airBarEl.style.width = pct + '%';
    airBarEl.style.background = air > 30 ? '#4fc3f7' : '#ef5350';
  }

  Shell.registerGame({
    id: 'TMSubPearl',
    title: { en: 'Sub Pearl', ja: 'せんすいかんパール', es: 'Perlas Submarinas', 'pt-BR': 'Pérolas Submarinas', fr: 'Perles Sous-Marines', de: 'U-Boot Perlen', it: 'Perle Subacquee', ko: '잠수함 진주', 'zh-Hans': '潜艇珍珠', tr: 'Denizaltı İnci' },
    howto: {
      en: 'Dive as deep as you can!\nDrag left/right to steer. Grab glowing pearl bubbles for oxygen.\nDodge jellyfish & rocks — depth is your score!',
      ja: 'どこまで深くもぐれるかチャレンジ！\nドラッグで左右にそうじゅう。光るパールの泡で酸素回復。\nクラゲと岩をよけろ — もぐった深さがスコア！',
      es: '¡Sumérgete lo más profundo posible!\nArrastra para moverte. Atrapa burbujas de perla brillantes para oxígeno.\n¡Esquiva medusas y rocas — la profundidad es tu puntuación!',
      'pt-BR': 'Mergulhe o mais fundo que puder!\nArraste para os lados. Pegue bolhas de pérola brilhantes para oxigênio.\nDesvie de águas-vivas e rochas — a profundidade é sua pontuação!',
      fr: 'Plongez aussi profond que possible !\nGlissez pour vous déplacer. Attrapez les bulles de perle lumineuses pour l\'oxygène.\nÉvitez méduses et rochers — la profondeur est votre score !',
      de: 'Tauche so tief du kannst!\nZiehe links/rechts zum Steuern. Sammle leuchtende Perlenblasen für Sauerstoff.\nWeiche Quallen und Felsen aus — die Tiefe ist dein Punktestand!',
      it: 'Immergiti più a fondo che puoi!\nTrascina per muoverti. Prendi le bolle di perla luminose per l\'ossigeno.\nEvita meduse e rocce — la profondità è il tuo punteggio!',
      ko: '얼마나 깊이 잠수할 수 있을까!\n드래그로 좌우 조종. 빛나는 진주 방울로 산소 회복.\n해파리와 바위를 피하세요 — 깊이가 곧 점수!',
      'zh-Hans': '挑战你能潜多深！\n左右拖动操控潜艇。收集发光珍珠泡补充氧气。\n躲开水母和岩石 — 深度就是你的分数！',
      tr: 'Olabildiğince derine dal!\nSürükleyerek yönlendir. Oksijen için parlayan inci baloncuklarını topla.\nDenizanası ve kayalardan kaç — derinlik senin skorun!'
    },
    scoreLabel: { en: 'm', ja: 'm', es: 'm', 'pt-BR': 'm', fr: 'm', de: 'm', it: 'm', ko: 'm', 'zh-Hans': 'm', tr: 'm' },
    allowContinue: true,
    bg: 0x2fa0d8,
    cameraFov: 60,
    cameraPos: [0, 0, 13],
    cameraLookAt: [0, 0, 0],
    fitWidth: 11,

    init: function (ctx) {
      var THREE = ctx.THREE;

      /* 深度別背景色（浅瀬→中層→深海。update で補間） */
      bgShallow = new THREE.Color(0x2fa0d8);
      bgMid     = new THREE.Color(0x0d5e96);
      bgDeep    = new THREE.Color(0x041a2e);
      bgWork    = new THREE.Color(0x2fa0d8);
      ctx.scene.background = bgWork;

      /* 海面（開始時に頭上へ流れ去る演出用） */
      seaSurface = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 2.5),
        new THREE.MeshLambertMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.5 })
      );
      seaSurface.position.set(0, 7.2, -1);
      ctx.scene.add(seaSurface);

      /* 潜水艦（画面上部寄りに固定・世界が流れる） */
      subGroup = new THREE.Group();
      subMat   = Style.mat(0xfdd835).clone();  // 被弾フラッシュで色を変えるため clone
      towerMat = Style.mat(0xf9a825).clone();
      propMat  = Style.mat(0xbdbdbd);
      subBody = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), subMat);
      subBody.scale.set(1.8, 0.7, 0.7);
      subGroup.add(subBody);
      subTower = new THREE.Mesh(Style.roundedBox(0.25, 0.3, 0.2), towerMat);
      subTower.position.set(0.1, 0.42, 0);
      subGroup.add(subTower);
      subPropeller = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 6), propMat);
      subPropeller.rotation.z = Math.PI / 2;
      subPropeller.position.set(-0.9, 0, 0);
      subGroup.add(subPropeller);
      /* ライト円錐（下向き・深いほど不透明に） */
      lightConeMat = new THREE.MeshBasicMaterial({
        color: 0xaadfff, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      lightCone = new THREE.Mesh(new THREE.ConeGeometry(2.0, 5.5, 16, 1, true), lightConeMat);
      lightCone.position.set(0.2, -3.1, 0); // 頂点が船体、下に広がる
      subGroup.add(lightCone);
      ctx.scene.add(subGroup);

      /* パールプール（光る泡＋中のパール） */
      pearlShellMat = new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false });
      pearlCoreMat = new THREE.MeshLambertMaterial({ color: 0xfff6f8, emissive: 0xdd88aa });
      for (var i = 0; i < PEARL_COUNT; i++) {
        var pg = new THREE.Group();
        var shellM = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), pearlShellMat);
        pg.add(shellM);
        var core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), pearlCoreMat);
        pg.add(core);
        pg.visible = false;
        ctx.scene.add(pg);
        pearlGroups.push(pg);
        pearlData.push({ active: false, x: 0, y: 0, phase: 0 });
      }

      /* クラゲプール（ベル形: Sphere + Cone） */
      jellyMat    = new THREE.MeshLambertMaterial({ color: 0xce93d8, transparent: true, opacity: 0.85 });
      jellyGelMat = new THREE.MeshLambertMaterial({ color: 0xe1bee7, transparent: true, opacity: 0.5 });
      for (var j = 0; j < JELLY_COUNT; j++) {
        var jg = new THREE.Group();
        var bell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), jellyMat);
        bell.scale.y = 0.7;
        jg.add(bell);
        var tent = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), jellyGelMat);
        tent.position.y = -0.3;
        jg.add(tent);
        jg.visible = false;
        ctx.scene.add(jg);
        jellyMeshes.push(jg);
        jellyData.push({ active: false, x: 0, y: 0, vx: 0, phase: 0 });
      }

      /* 岩プール（フラットシェーディングでゴツゴツ感） */
      rockMat = new THREE.MeshLambertMaterial({ color: 0x5a6a72, flatShading: true });
      var rockGeo = new THREE.SphereGeometry(1, 6, 5);
      for (var r = 0; r < ROCK_COUNT; r++) {
        var rock = new THREE.Mesh(rockGeo, rockMat);
        rock.visible = false;
        ctx.scene.add(rock);
        rockMeshes.push(rock);
        rockData.push({ active: false, x: 0, y: 0, r: 1 });
      }

      /* 装飾の泡プール */
      bubbleMat = new THREE.MeshLambertMaterial({ color: 0xb3e5fc, transparent: true, opacity: 0.4 });
      var bubbleGeo = new THREE.SphereGeometry(0.07, 6, 4);
      for (var b = 0; b < BUBBLE_COUNT; b++) {
        var bm = new THREE.Mesh(bubbleGeo, bubbleMat);
        bm.visible = false;
        ctx.scene.add(bm);
        bubbleMeshes.push(bm);
        bubbleData.push({ active: false, x: 0, y: 0, vy: 0 });
      }

      /* 海藻プール（画面端をスクロールして流れる） */
      kelpMat = Style.mat(0x3a9a5a);
      for (var k = 0; k < KELP_COUNT; k++) {
        var kelp = new THREE.Group();
        for (var kseg = 0; kseg < 3; kseg++) {
          var blade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6), kelpMat);
          blade.position.y = 0.5 + kseg * 0.85;
          blade.rotation.z = (kseg % 2 ? 0.22 : -0.22);
          kelp.add(blade);
        }
        kelp.visible = false;
        ctx.scene.add(kelp);
        kelpGroups.push(kelp);
        kelpData.push({ active: false, x: 0, y: 0 });
      }

      /* 酸素バー（画面上部・泡アイコン付き） */
      airBarBg = document.createElement('div');
      airBarBg.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);' +
        'width:60vw;height:14px;background:rgba(0,0,0,.3);border-radius:7px;z-index:11;display:none;';
      airBarEl = document.createElement('div');
      airBarEl.style.cssText = 'height:100%;width:100%;background:#4fc3f7;border-radius:7px;';
      var airLabel = document.createElement('div');
      airLabel.style.cssText = 'text-align:center;margin-top:3px;line-height:0;';
      for (var dp = 0; dp < 3; dp++) {
        var dot = document.createElement('span');
        var ds = 4 + dp * 2;
        dot.style.cssText = 'display:inline-block;width:' + ds + 'px;height:' + ds + 'px;margin:0 3px;' +
          'border-radius:50%;background:rgba(255,255,255,.95);box-shadow:0 1px 3px rgba(0,0,0,.4);';
        airLabel.appendChild(dot);
      }
      airBarBg.appendChild(airBarEl);
      airBarBg.appendChild(airLabel);
      document.body.appendChild(airBarBg);
    },

    start: function (ctx) {
      subX = 0; subVX = 0; subTargetX = 0;
      depth = 0;
      shownDepth = -1;
      nextMilestone = 100;
      air = AIR_MAX;
      gameActive = true;
      invulnT = 0;
      hitFlashT = 0;
      pearlFlashT = 0;
      pearlTimer = 0.8;
      jellyTimer = 1.6;
      rockTimer = 4.0;
      kelpTimer = 0.4;

      /* プールをすべて休止状態に */
      var i;
      for (i = 0; i < PEARL_COUNT; i++) { pearlData[i].active = false; pearlGroups[i].visible = false; }
      for (i = 0; i < JELLY_COUNT; i++) { jellyData[i].active = false; jellyMeshes[i].visible = false; }
      for (i = 0; i < ROCK_COUNT; i++)  { rockData[i].active = false;  rockMeshes[i].visible = false; }
      for (i = 0; i < KELP_COUNT; i++)  { kelpData[i].active = false;  kelpGroups[i].visible = false; }
      /* 装飾の泡は最初から画面内にばらまく */
      for (i = 0; i < BUBBLE_COUNT; i++) spawnBubble(i, true);

      subGroup.position.set(0, SUB_Y, 0);
      subGroup.rotation.z = 0;
      subMat.color.setHex(0xfdd835);
      towerMat.color.setHex(0xf9a825);
      lightConeMat.opacity = 0;

      seaSurface.visible = true;
      seaSurface.position.y = 7.2;

      bgWork.copy(bgShallow);

      airBarBg.style.display = '';
      updateAirBar();
      ctx.setScore(0);
      ctx.setHint('⬅ ➡ ⬇');
    },

    onContinue: function (ctx) {
      /* 酸素を回復してその場から再開。周囲の障害物を掃除して即死を防ぐ */
      air = AIR_MAX * 0.6;
      gameActive = true;
      invulnT = 2.0;
      hitFlashT = 0;
      subMat.color.setHex(0xfdd835);
      towerMat.color.setHex(0xf9a825);
      var i;
      for (i = 0; i < JELLY_COUNT; i++) {
        if (jellyData[i].active && jellyData[i].y > -2) { jellyData[i].active = false; jellyMeshes[i].visible = false; }
      }
      for (i = 0; i < ROCK_COUNT; i++) {
        if (rockData[i].active && rockData[i].y > -2) { rockData[i].active = false; rockMeshes[i].visible = false; }
      }
      updateAirBar();
      ctx.setHint('▶');
    },

    onPointerDown: function (ctx, p) {
      subTargetX = Math.max(-X_LIMIT, Math.min(X_LIMIT, p.nx * (X_LIMIT + 1)));
    },

    onPointerMove: function (ctx, p) {
      subTargetX = Math.max(-X_LIMIT, Math.min(X_LIMIT, p.nx * (X_LIMIT + 1)));
    },

    update: function (ctx, dt) {
      if (!gameActive) return;

      var speed = scrollSpeed();

      /* ---- 深度加算（＝スコア） ---- */
      depth += speed * DEPTH_PER_UNIT * dt;
      var d = Math.floor(depth);
      if (d !== shownDepth) {
        shownDepth = d;
        ctx.setScore(d);
      }
      if (depth >= nextMilestone) {
        ctx.setHint(nextMilestone + 'm ⬇');
        ctx.sfx.score();
        nextMilestone += 100;
      }

      /* ---- 酸素管理（深いほど消費が速い） ---- */
      air -= (AIR_DRAIN_BASE + Math.min(AIR_DRAIN_CAP, depth * AIR_DRAIN_GAIN)) * dt;
      updateAirBar();
      if (air <= 0) {
        air = 0;
        gameActive = false;
        ctx.sfx.fail();
        ctx.vibrate(40);
        ctx.gameOver(Math.floor(depth));
        return;
      }

      /* ---- 潜水艦の横移動 ---- */
      var prevX = subX;
      subX += (subTargetX - subX) * Math.min(dt * 6, 1);
      subX = Math.max(-X_LIMIT, Math.min(X_LIMIT, subX));
      subVX = (subX - prevX) / Math.max(dt, 0.001);
      subGroup.position.set(subX, SUB_Y, 0);
      /* 少し前傾＋横移動でバンク */
      subGroup.rotation.z = -0.22 + Math.max(-0.3, Math.min(0.3, -subVX * 0.06));
      subPropeller.rotation.y += dt * (6 + speed * 2);

      /* ---- 深度で環境が変わる（背景色・ライト円錐） ---- */
      if (depth < 150) {
        bgWork.copy(bgShallow).lerp(bgMid, depth / 150);
      } else {
        bgWork.copy(bgMid).lerp(bgDeep, Math.min(1, (depth - 150) / 300));
      }
      lightConeMat.opacity = Math.min(0.3, Math.max(0, (depth - 80) * 0.0012));

      /* ---- 海面が頭上へ流れ去る（開始演出） ---- */
      if (seaSurface.visible) {
        seaSurface.position.y += speed * dt;
        if (seaSurface.position.y > 12) seaSurface.visible = false;
      }

      /* ---- 出現タイマー（深いほど障害物が増える） ---- */
      pearlTimer -= dt;
      jellyTimer -= dt;
      rockTimer  -= dt;
      kelpTimer  -= dt;
      var i;
      if (pearlTimer <= 0) {
        for (i = 0; i < PEARL_COUNT; i++) { if (!pearlData[i].active) { spawnPearl(i); break; } }
        pearlTimer = 1.1 + Math.random() * 0.7;
      }
      if (jellyTimer <= 0) {
        for (i = 0; i < JELLY_COUNT; i++) { if (!jellyData[i].active) { spawnJelly(i); break; } }
        jellyTimer = Math.max(0.55, 1.7 - depth * 0.002) * (0.8 + Math.random() * 0.4);
      }
      if (rockTimer <= 0 && depth > 60) {
        for (i = 0; i < ROCK_COUNT; i++) { if (!rockData[i].active) { spawnRock(i); break; } }
        rockTimer = Math.max(0.8, 2.4 - depth * 0.003) * (0.8 + Math.random() * 0.4);
      }
      if (kelpTimer <= 0 && depth < 120) {
        for (i = 0; i < KELP_COUNT; i++) { if (!kelpData[i].active) { spawnKelp(i); break; } }
        kelpTimer = 1.2 + Math.random() * 1.2;
      }

      /* ---- パールの更新（上へ流れる・取得で酸素回復） ---- */
      for (i = 0; i < PEARL_COUNT; i++) {
        var pd = pearlData[i];
        if (!pd.active) continue;
        pd.y += speed * dt;
        pd.phase += dt * 3;
        var pg = pearlGroups[i];
        pg.position.set(pd.x + Math.sin(pd.phase) * 0.15, pd.y, 0);
        var pulse = 1 + Math.sin(pd.phase * 2) * 0.12;
        pg.scale.set(pulse, pulse, pulse);
        if (pd.y > DESPAWN_Y) { pd.active = false; pg.visible = false; continue; }

        var ddx = pg.position.x - subX, ddy = pd.y - SUB_Y;
        if (ddx * ddx + ddy * ddy < 0.9 * 0.9) {
          pd.active = false;
          pg.visible = false;
          var gain = PEARL_AIR_BASE + Math.min(PEARL_AIR_CAP, depth * PEARL_AIR_GAIN);
          air = Math.min(AIR_MAX, air + gain);
          pearlFlashT = 0.35;
          updateAirBar();
          ctx.sfx.score();
          ctx.vibrate(15);
        }
      }

      /* ---- クラゲの更新 ---- */
      for (i = 0; i < JELLY_COUNT; i++) {
        var jd = jellyData[i];
        if (!jd.active) continue;
        jd.phase += dt * 1.5;
        jd.y += speed * dt + Math.sin(jd.phase) * 0.3 * dt;
        jd.x += jd.vx * dt;
        if (jd.x > X_LIMIT + 0.3 || jd.x < -X_LIMIT - 0.3) jd.vx *= -1;
        var jm = jellyMeshes[i];
        jm.position.set(jd.x, jd.y, 0);
        jm.children[0].scale.y = 0.7 + Math.sin(jd.phase * 2) * 0.15; // 収縮演出
        if (jd.y > DESPAWN_Y) { jd.active = false; jm.visible = false; continue; }

        if (invulnT <= 0) {
          var jdx = jd.x - subX, jdy = jd.y - SUB_Y;
          if (jdx * jdx + jdy * jdy < 0.85 * 0.85) _hitObstacle(ctx);
        }
      }

      /* ---- 岩の更新 ---- */
      for (i = 0; i < ROCK_COUNT; i++) {
        var rd = rockData[i];
        if (!rd.active) continue;
        rd.y += speed * dt;
        rockMeshes[i].position.y = rd.y;
        if (rd.y > DESPAWN_Y) { rd.active = false; rockMeshes[i].visible = false; continue; }

        if (invulnT <= 0) {
          var rdx = rd.x - subX, rdy = rd.y - SUB_Y;
          var rr = rd.r + 0.55;
          if (rdx * rdx + rdy * rdy < rr * rr) _hitObstacle(ctx);
        }
      }

      /* ---- 装飾の泡（世界より速く上昇＝潜行の体感） ---- */
      for (i = 0; i < BUBBLE_COUNT; i++) {
        var bd = bubbleData[i];
        if (!bd.active) continue;
        bd.y += (speed + bd.vy) * dt;
        bubbleMeshes[i].position.y = bd.y;
        if (bd.y > DESPAWN_Y) spawnBubble(i, false);
      }

      /* ---- 海藻（浅場の装飾） ---- */
      for (i = 0; i < KELP_COUNT; i++) {
        var kd = kelpData[i];
        if (!kd.active) continue;
        kd.y += speed * dt;
        kelpGroups[i].position.y = kd.y;
        if (kd.y > DESPAWN_Y + 2) { kd.active = false; kelpGroups[i].visible = false; }
      }

      /* ---- 被弾後の無敵＆フラッシュ ---- */
      if (invulnT > 0) invulnT -= dt;
      if (hitFlashT > 0) {
        hitFlashT -= dt;
        var blink = Math.floor(hitFlashT * 12) % 2 === 0;
        airBarEl.style.background = blink ? '#ff1744' : '#ffffff';
        subMat.color.setHex(blink ? 0xff5544 : 0xfdd835);
        towerMat.color.setHex(blink ? 0xff5544 : 0xf9a825);
        if (hitFlashT <= 0) {
          subMat.color.setHex(0xfdd835);
          towerMat.color.setHex(0xf9a825);
          updateAirBar();
        }
      }

      /* ---- パール取得フラッシュ（艦がほんのり白く光る） ---- */
      if (pearlFlashT > 0) {
        pearlFlashT -= dt;
        var glow = pearlFlashT / 0.35;
        if (hitFlashT <= 0) {
          subMat.color.setHSL(0.14, 0.7, 0.55 + glow * 0.35);
          if (pearlFlashT <= 0) subMat.color.setHex(0xfdd835);
        }
      }
    }
  });

  /* ---- 障害物ヒット: 酸素大幅減＋赤フラッシュ＋無敵付与 ---- */
  function _hitObstacle(ctx) {
    air = Math.max(0, air - HIT_DMG);
    invulnT = INVULN_TIME;
    hitFlashT = 0.6;
    updateAirBar();
    ctx.sfx.fail();
    ctx.vibrate(30);
    ctx.setHint('⚠');
  }

})();
