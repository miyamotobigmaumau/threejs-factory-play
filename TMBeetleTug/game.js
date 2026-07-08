/* =========================================================================
 * TMBeetleTug — カブトつなひき
 * ルール: カブトムシ(自分) vs クワガタ(AI)の綱引き。
 *         連打で基礎パワーを稼ぎ、綱が光る瞬間にタップで「ツノ返し」大引き。
 * 操作: 連打（基本パワー）＋ゾーン光タイミングタップ（ツノ返し）
 * スコア: 連勝数（3本勝負×難度上昇）
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var ROPE_LIMIT    = 3.0;   // 綱の限界オフセット（±）
  var GLOW_MIN      = 1.2;   // 光るゾーンの最短間隔（秒）
  var GLOW_MAX      = 2.5;   // 光るゾーンの最長間隔（秒）
  var GLOW_WARN     = 0.4;   // 光る直前ヒント時間（秒）
  var GLOW_DURATION = 0.5;   // 光っている時間（秒）
  var MASH_PENALTY  = 1.0;   // 光っていない時のタップペナルティ
  var TSUNO_POWER   = 5.0;   // ツノ返しタップのパワー増加量（大技）
  var POWER_DECAY   = 3.0;   // プレイヤーパワーの減衰速度（/秒）
  var BUG_X         = 2.2;   // 虫の初期X座標（絶対値）— 中央寄りに配置して大きく見せる
  var BUG_SCALE     = 1.3;   // 虫の表示スケール（画面の約1/3を占める大きさ）

  /* ---------- シーンオブジェクト（init で生成・以降再利用） ---------- */
  var ground, ringLine;
  var ropeMesh, ropeMarker;     // ropeMarker = 綱の中央に吊るした蜜壺（宝物）
  var potJar, potHoney;         // 蜜壺の部品（演出用）
  var winLineL, winLineR;       // 勝利ライン（左右）
  var kabutoGroup, kuwagataGroup;
  var ropeMat;
  var kabutoBody, kuwagataBody; // 揺れ確認用
  var treeMeshes = [];          // 背景の木

  /* ---------- 蜜しぶきパーティクル（プール方式） ---------- */
  var HONEY_POOL_SIZE = 12;
  var honeyPool = [];           // {mesh, vx, vy, vz, life} を先に確保して再利用

  function spawnHoneyBurst(x, y, z) {
    var n = 0;
    for (var i = 0; i < honeyPool.length; i++) {
      var p = honeyPool[i];
      if (p.life > 0) continue;
      p.life = 0.7 + Math.random() * 0.3;
      p.mesh.visible = true;
      p.mesh.position.set(x, y, z);
      var a = Math.random() * Math.PI * 2;
      var sp = 1.2 + Math.random() * 1.6;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp * 0.5;
      p.vy = 2.2 + Math.random() * 1.8;
      n++;
      if (n >= 10) break;
    }
  }

  function updateHoneyPool(dt) {
    for (var i = 0; i < honeyPool.length; i++) {
      var p = honeyPool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vy -= 9.0 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      var s = Math.max(0.2, p.life);
      p.mesh.scale.setScalar(s);
    }
  }

  /* ---------- DOM UI ---------- */
  var powerBarBg, powerBar;

  /* ---------- ゲーム状態変数 ---------- */
  var ropeOffset;      // 綱の位置オフセット（+ = プレイヤー優勢, - = AI優勢）
  var playerPower;     // プレイヤーの現在パワー蓄積量
  var aiPower;         // AIの現在パワー値（毎フレーム計算）
  var aiBase;          // AIの基礎パワー（ラウンドごとに増加）
  var aiPhase;         // AI正弦波の位相
  var glowTimer;       // 次の光るまでのカウントダウン
  var glowActive;      // 光りゾーンがアクティブかどうか
  var glowElapsed;     // 光りゾーンのアクティブ経過時間
  var round;           // 現在のラウンド（1〜3）
  var playerWins;      // プレイヤーの勝利数
  var aiWins;          // AIの勝利数
  var gamePhase;       // 'pulling' | 'roundEnd' | 'done'
  var roundEndTimer;   // ラウンド終了後の待機タイマー
  var roundEndResult;  // 'player' | 'ai'
  var stumbleTimer;    // 連打ペナルティ時のよろけ演出
  var introTimer = 0;  // 開始時の顔ズーム（スケールポップ）演出タイマー

  function nextGlowWait() {
    return GLOW_MIN + Math.random() * (GLOW_MAX - GLOW_MIN);
  }

  /* ---------- 虫メッシュ生成ヘルパー ---------- */
  function makeKabuto(THREE) {
    // カブトムシ：球体ボディ＋前方に一本角
    var g = new THREE.Group();
    var bodyMat = Style.mat(0x1a0d00); // 黒褐色
    var hornMat = Style.mat(0x2a1500);
    var eyeMat  = Style.mat(0xff2200);

    // 胴体（球）
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), bodyMat);
    body.position.y = 0.55;
    g.add(body);

    // 前胸（扁平な球）
    var thorax = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), bodyMat);
    thorax.scale.y = 0.6;
    thorax.position.set(0.45, 0.55, 0);
    g.add(thorax);

    // ツノ（円錐）：前方上へ傾いて伸びる
    var horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 8), hornMat);
    horn.rotation.z = -Math.PI / 2.5;
    horn.position.set(0.75, 0.95, 0);
    g.add(horn);

    // 目（小球×2）
    var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), eyeMat);
    eye1.position.set(0.72, 0.7, 0.22);
    g.add(eye1);
    var eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), eyeMat);
    eye2.position.set(0.72, 0.7, -0.22);
    g.add(eye2);

    // 脚（小箱×3対）
    var legMat = Style.mat(0x0d0800);
    var legPositions = [
      [-0.1, 0, 0.55], [0.1, 0, 0.55], [0.3, 0, 0.55],
      [-0.1, 0, -0.55], [0.1, 0, -0.55], [0.3, 0, -0.55]
    ];
    for (var i = 0; i < legPositions.length; i++) {
      var leg = new THREE.Mesh(Style.roundedBox(0.08, 0.08, 0.5), legMat);
      leg.position.set(legPositions[i][0], legPositions[i][1], legPositions[i][2]);
      g.add(leg);
    }

    return g;
  }

  function makeKuwagata(THREE) {
    // クワガタムシ：球体ボディ＋2本の大顎（傾いた円錐×2）
    var g = new THREE.Group();
    var bodyMat = Style.mat(0x3d0000); // 暗赤黒
    var jawMat  = Style.mat(0x1a0000);
    var eyeMat  = Style.mat(0xff6600);

    // 胴体
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), bodyMat);
    body.position.y = 0.55;
    g.add(body);

    // 頭部
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), bodyMat);
    head.position.set(-0.5, 0.65, 0);
    g.add(head);

    // 大顎（上）：右斜め外向き
    var jawU = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.85, 6), jawMat);
    jawU.rotation.z = Math.PI / 2.2;
    jawU.position.set(-0.85, 0.88, 0.2);
    g.add(jawU);

    // 大顎（下）：左斜め外向き
    var jawD = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.85, 6), jawMat);
    jawD.rotation.z = Math.PI / 2.2;
    jawD.position.set(-0.85, 0.88, -0.2);
    g.add(jawD);

    // 目
    var eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), eyeMat);
    eye1.position.set(-0.68, 0.75, 0.22);
    g.add(eye1);
    var eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), eyeMat);
    eye2.position.set(-0.68, 0.75, -0.22);
    g.add(eye2);

    // 脚
    var legMat = Style.mat(0x1a0000);
    var legPositions = [
      [0.1, 0, 0.55], [-0.1, 0, 0.55], [-0.3, 0, 0.55],
      [0.1, 0, -0.55], [-0.1, 0, -0.55], [-0.3, 0, -0.55]
    ];
    for (var i = 0; i < legPositions.length; i++) {
      var leg = new THREE.Mesh(Style.roundedBox(0.08, 0.08, 0.5), legMat);
      leg.position.set(legPositions[i][0], legPositions[i][1], legPositions[i][2]);
      g.add(leg);
    }

    return g;
  }

  /* ---------- 蜜壺（宝物）メッシュ生成 ---------- */
  function makeHoneyPot(THREE) {
    // 綱の中央に吊るされた大きな蜜壺。これを自分側に引き込めたら勝ち、が一目で分かる目印。
    var g = new THREE.Group();
    var jarMat   = Style.mat(0xc9862f);            // 素焼きの壺
    var honeyMat = Style.mat(0xffb300, { emissive: 0x664400 }); // 光る蜜
    var strapMat = Style.mat(0x6b4a2a);

    // 吊りひも（綱から壺へ）
    var strap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), strapMat);
    strap.position.y = 0.25;
    g.add(strap);

    // 壺本体（膨らんだ球を少しつぶす）
    potJar = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), jarMat);
    potJar.scale.y = 0.85;
    potJar.position.y = -0.25;
    g.add(potJar);

    // 壺の口（リング）
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 16), jarMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.08;
    g.add(rim);

    // あふれる蜜（光る半球＋たれ）
    potHoney = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), honeyMat);
    potHoney.scale.y = 0.6;
    potHoney.position.y = 0.12;
    g.add(potHoney);
    var drip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), honeyMat);
    drip.position.set(0.2, -0.05, 0.12);
    g.add(drip);

    return g;
  }

  function makeTree(THREE, x, z) {
    // 木（幹+葉っぱ）
    var g = new THREE.Group();
    var trunkMat = Style.mat(0x6b3d1e);
    var leafMat  = Style.mat(0x2a5c1a);
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.5, 7), trunkMat);
    trunk.position.y = 0.75;
    g.add(trunk);
    var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.4, 7, 6), leafMat);
    leaf.position.y = 2.0;
    g.add(leaf);
    g.position.set(x, 0, z);
    return g;
  }

  /* ---------- DOM パワーバー生成 ---------- */
  function makePowerBar() {
    powerBarBg = document.createElement('div');
    powerBarBg.style.cssText = [
      'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);',
      'width:56vw;height:14px;background:rgba(0,0,0,.3);border-radius:7px;z-index:11;'
    ].join('');
    powerBar = document.createElement('div');
    powerBar.style.cssText = [
      'height:100%;width:0%;background:linear-gradient(90deg,#ff6600,#ffcc00);',
      'border-radius:7px;transition:width 0.05s;'
    ].join('');
    powerBarBg.appendChild(powerBar);
    document.body.appendChild(powerBarBg);
  }

  /* ---------- 自キャラ頭上の▼マーカー＋蜜壺ピップ（3Dで言語非依存） ---------- */
  var selfMarker;              // 自分の頭上でバウンドする青い▼
  var playerPips = [];         // 自分側の獲得ラウンド蜜壺ピップ（3個）
  var aiPips = [];             // 相手側の獲得ラウンド蜜壺ピップ（3個）
  var pipOnMatP, pipOnMatA, pipOffMat;
  var markerClock = 0;

  function makePotPip(THREE, mat) {
    // ミニ蜜壺型ピップ（獲得ラウンド＝手に入れた蜜壺、が伝わる）
    return new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.22, 8), mat);
  }

  function updatePips() {
    var i;
    for (i = 0; i < 3; i++) {
      playerPips[i].material = (i < playerWins) ? pipOnMatP : pipOffMat;
      aiPips[i].material = (i < aiWins) ? pipOnMatA : pipOffMat;
    }
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMBeetleTug',
    title: { en: 'Beetle Tug-of-War', ja: 'カブトつなひき', es: 'Tira y Afloja Escarabajo', 'pt-BR': 'Cabo de Guerra Besouro', fr: 'Tir à la Corde Scarabée', de: 'Käfer-Tauziehen', it: 'Tiro alla Fune Scarabeo', ko: '장수풍뎅이 줄다리기', 'zh-Hans': '甲虫拔河', tr: 'Böcek Halat Çekme' },
    howto: { en: 'Pull the honey pot 🍯 to your side!\nTap fast to pull — when the rope glows, tap for a HUGE pull!\nWin 2 of 3 rounds!', ja: 'みつつぼ🍯を ひっぱりこもう！\n連打で引っぱれ！綱が光った瞬間のタップは大チャンス！\n3本勝負で2勝しよう！', es: '¡Lleva el tarro de miel 🍯 a tu lado!\n¡Toca rápido para tirar — cuando la cuerda brille, tirón GIGANTE!\n¡Gana 2 de 3 rondas!', 'pt-BR': 'Puxe o pote de mel 🍯 para o seu lado!\nToque rápido — quando a corda brilhar, puxão GIGANTE!\nVença 2 de 3 rounds!', fr: 'Ramenez le pot de miel 🍯 de votre côté!\nTapotez vite — quand la corde brille, traction GÉANTE!\nGagnez 2 manches sur 3!', de: 'Zieh den Honigtopf 🍯 auf deine Seite!\nSchnell tippen — wenn das Seil leuchtet: RIESEN-Zug!\nGewinne 2 von 3 Runden!', it: 'Porta il vaso di miele 🍯 dalla tua parte!\nTocca veloce — quando la fune brilla, tiro GIGANTE!\nVinci 2 round su 3!', ko: '꿀단지🍯를 내 쪽으로 끌어오자!\n연타로 당겨라! 밧줄이 빛나는 순간 탭하면 대찬스!\n3판 중 2판 승리!', 'zh-Hans': '把蜜罐🍯拉到自己这边！\n快速点击拉绳！绳子发光时点击有超强拉力！\n三局两胜！', tr: 'Bal küpünü 🍯 kendi tarafına çek!\nHızlı dokun — ip parladığında DEV çekiş!\n3 turdan 2\'sini kazan!' },
    scoreLabel: { en: 'win', ja: '勝', es: 'victoria', 'pt-BR': 'vitória', fr: 'victoire', de: 'Sieg', it: 'vittoria', ko: '승', 'zh-Hans': '胜', tr: 'galibiyet' },
    bg: 0x4a7c3f,
    fogNear: 30,
    fogFar: 80,
    cameraFov: 55,
    cameraPos: [0, 2.9, 8.6],   // 低めの横視点でツノのシルエットを強調
    cameraLookAt: [0, 0.95, 0],
    fitWidth: 6.4,               // 縦持ちでも自分・相手・綱が中央に収まる

    /* ====== init: 全オブジェクトをここで生成 ====== */
    init: function (ctx) {
      var THREE = ctx.THREE;

      /* 地面（土俵: 茶色い円） */
      ground = new THREE.Mesh(
        new THREE.CylinderGeometry(5.5, 5.5, 0.15, 32),
        Style.mat(0xc8a46e)
      );
      ground.position.y = -0.075;
      ctx.scene.add(ground);

      /* 土俵縁（黒帯） */
      var edge = new THREE.Mesh(
        new THREE.TorusGeometry(5.5, 0.2, 8, 32),
        Style.mat(0x222222)
      );
      edge.rotation.x = Math.PI / 2;
      ctx.scene.add(edge);

      /* 土俵外の地面（緑） */
      var outerGround = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        Style.mat(0x3a5c28)
      );
      outerGround.rotation.x = -Math.PI / 2;
      outerGround.position.y = -0.16;
      ctx.scene.add(outerGround);

      /* 背景の木（雑木林） */
      var treePositions = [
        [-10, -8], [-12, -3], [-11, 4], [-9, 9],
        [10, -8],  [12, -3],  [11, 4],  [9, 9],
        [-6, -10], [0, -11],  [6, -10],
        [-6, 10],  [0, 11],   [6, 10]
      ];
      for (var ti = 0; ti < treePositions.length; ti++) {
        var tree = makeTree(THREE, treePositions[ti][0], treePositions[ti][1]);
        ctx.scene.add(tree);
        treeMeshes.push(tree);
      }

      /* 綱（横長の箱） — 中心からWIN_LIMITまで伸びる */
      ropeMat = new THREE.MeshLambertMaterial({
        color: 0xd4a84b,
        emissive: new THREE.Color(0x000000)
      });
      ropeMesh = new THREE.Mesh(
        Style.roundedBox(8.0, 0.22, 0.22),
        ropeMat
      );
      ropeMesh.position.set(0, 0.8, 0);
      ctx.scene.add(ropeMesh);

      /* 綱の中央に吊るした蜜壺（宝物）— これが取り合いの目印 */
      ropeMarker = makeHoneyPot(THREE);
      ropeMarker.position.set(0, 0.8, 0);
      ctx.scene.add(ropeMarker);

      /* 蜜しぶきパーティクルプール（先に確保して再利用） */
      var honeyDropMat = Style.mat(0xffb300, { emissive: 0x664400 });
      for (var hp = 0; hp < HONEY_POOL_SIZE; hp++) {
        var drop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), honeyDropMat);
        drop.visible = false;
        ctx.scene.add(drop);
        honeyPool.push({ mesh: drop, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      /* 勝利ライン（プレイヤー側=左: -2.9 が青、AI側=右: +2.9 が赤）
       * 綱引きの直感どおり「マーカーが自分側（左）に来たら勝ち」 */
      var winMatP = Style.mat(0x0066ff); // 青=プレイヤー
      var winMatA = Style.mat(0xff0000); // 赤=AI
      winLineL = new THREE.Mesh(
        Style.roundedBox(0.12, 0.5, 0.8),
        winMatP
      );
      winLineL.position.set(-2.9, 0.8, 0);
      ctx.scene.add(winLineL);

      winLineR = new THREE.Mesh(
        Style.roundedBox(0.12, 0.5, 0.8),
        winMatA
      );
      winLineR.position.set(2.9, 0.8, 0);
      ctx.scene.add(winLineR);

      /* カブトムシ（プレイヤー: 左側） */
      kabutoGroup = makeKabuto(THREE);
      kabutoGroup.position.set(-BUG_X, 0, 0);
      kabutoGroup.scale.setScalar(BUG_SCALE);
      // カブトは右向き（AIの方向）
      kabutoGroup.rotation.y = Math.PI / 2;
      ctx.scene.add(kabutoGroup);

      /* クワガタ（AI: 右側） */
      kuwagataGroup = makeKuwagata(THREE);
      kuwagataGroup.position.set(BUG_X, 0, 0);
      kuwagataGroup.scale.setScalar(BUG_SCALE);
      // クワガタは左向き（プレイヤーの方向）
      kuwagataGroup.rotation.y = -Math.PI / 2;
      ctx.scene.add(kuwagataGroup);

      /* パワーバーDOM生成 */
      makePowerBar();

      /* 自キャラ頭上の▼マーカー（青・バウンドで「これがじぶん」を示す） */
      selfMarker = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.55, 4),
        Style.mat(0x2288ff)
      );
      selfMarker.rotation.z = Math.PI; // 先端を下に
      selfMarker.position.set(-BUG_X, 2.6 * BUG_SCALE, 0);
      ctx.scene.add(selfMarker);

      /* 両者頭上の蜜壺ピップ（獲得ラウンド表示、3個ずつ） */
      pipOnMatP = Style.mat(0xffb300, { emissive: 0x553300 }); // 獲得=蜜色に光る
      pipOnMatA = Style.mat(0xff3322);  // 相手獲得=赤
      pipOffMat = Style.mat(0x555555);  // 未獲得=灰
      for (var pp = 0; pp < 3; pp++) {
        var pPip = makePotPip(THREE, pipOffMat);
        pPip.position.set(-BUG_X + (pp - 1) * 0.5, 2.05 * BUG_SCALE, 0);
        ctx.scene.add(pPip);
        playerPips.push(pPip);
        var aPip = makePotPip(THREE, pipOffMat);
        aPip.position.set(BUG_X + (pp - 1) * 0.5, 2.05 * BUG_SCALE, 0);
        ctx.scene.add(aPip);
        aiPips.push(aPip);
      }
    },

    /* ====== start: 状態を完全リセット ====== */
    start: function (ctx) {
      /* 状態変数のリセット */
      ropeOffset    = 0;
      playerPower   = 0;
      aiBase        = 0.8;
      aiPower       = aiBase;
      aiPhase       = 0;
      glowTimer     = nextGlowWait();
      glowActive    = false;
      glowElapsed   = 0;
      round         = 1;
      playerWins    = 0;
      aiWins        = 0;
      gamePhase     = 'pulling';
      roundEndTimer = 0;
      roundEndResult = null;
      stumbleTimer  = 0;

      /* オブジェクトの位置をリセット */
      ropeMarker.position.set(0, 0.8, 0);
      ropeMarker.rotation.set(0, 0, 0);
      ropeMarker.scale.setScalar(1);
      ropeMarker.visible = true;
      for (var hi = 0; hi < honeyPool.length; hi++) {
        honeyPool[hi].life = 0;
        honeyPool[hi].mesh.visible = false;
      }
      kabutoGroup.position.set(-BUG_X, 0, 0);
      kuwagataGroup.position.set(BUG_X, 0, 0);
      introTimer = 0.9;  // 開始時の顔ズーム（スケールポップ）演出
      markerClock = 0;
      selfMarker.position.set(-BUG_X, 2.6 * BUG_SCALE, 0);
      updatePips();

      /* マテリアルのリセット */
      ropeMat.emissive.setHex(0x000000);
      ropeMat.emissiveIntensity = 0;

      /* UIリセット */
      powerBar.style.width = '0%';
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Pull the 🍯 to your(🔵) side! Tap when it glows!', ja: 'みつつぼ🍯を じぶん（🔵）がわへ！ 光った瞬間をねらえ！', es: '¡Lleva el 🍯 a tu lado(🔵)! ¡Toca cuando brille!', 'pt-BR': 'Puxe o 🍯 para o seu lado(🔵)! Toque quando brilhar!', fr: 'Ramenez le 🍯 de votre côté(🔵)! Tapotez quand ça brille!', de: 'Zieh den 🍯 auf deine(🔵) Seite! Tippe wenn es leuchtet!', it: 'Porta il 🍯 dalla tua parte(🔵)! Tocca quando brilla!', ko: '🍯를 내(🔵) 쪽으로! 빛날 때 탭!', 'zh-Hans': '把🍯拉到自己(🔵)这边！发光时点击！', tr: '🍯 kendi(🔵) tarafına çek! Parladığında dokun!' }));
    },

    /* ====== onPointerDown: タップ処理 ====== */
    onPointerDown: function (ctx, p) {
      if (gamePhase !== 'pulling') return;

      if (glowActive) {
        /* ツノ返し！光りゾーン中のタップ */
        playerPower += TSUNO_POWER;
        glowActive   = false;
        glowElapsed  = 0;
        glowTimer    = nextGlowWait();
        ropeMat.emissive.setHex(0x000000);
        ropeMat.emissiveIntensity = 0;
        ropeMat.color.setHex(0xd4a84b);
        ropeMesh.scale.y = 1;
        ropeMesh.scale.z = 1;
        ctx.sfx.success();
        ctx.vibrate(30);
        ctx.setHint(ctx.t({ en: 'Horn Dash! Big pull!', ja: 'ツノ返し！大引き！', es: '¡Cornada! ¡Gran jalón!', 'pt-BR': 'Chifrada! Grande puxão!', fr: 'Coup de Corne! Grand tir!', de: 'Hornzug! Großer Zug!', it: 'Colpo di Corno! Grande tiro!', ko: '뿔 반격! 강력한 당기기!', 'zh-Hans': '角还击！大力拉！', tr: 'Boynuz hamlesi! Güçlü çekiş!' }));
      } else {
        /* 通常タップ = 基礎パワー（小）。連打だけではAIの漸増に届かない */
        playerPower += 0.5;
        ctx.sfx.tap();
      }
    },

    /* ====== update: 毎フレーム処理 ====== */
    update: function (ctx, dt) {
      if (gamePhase === 'done') return;

      /* ---- 自キャラ頭上の▼マーカー（バウンド）＋★ピップの回転 ---- */
      markerClock += dt;
      selfMarker.position.x = kabutoGroup.position.x;
      selfMarker.position.y = 2.6 * BUG_SCALE + Math.abs(Math.sin(markerClock * 4)) * 0.35;
      var pi2;
      for (pi2 = 0; pi2 < 3; pi2++) {
        playerPips[pi2].rotation.y += dt * 2;
        aiPips[pi2].rotation.y += dt * 2;
        playerPips[pi2].position.x = kabutoGroup.position.x + (pi2 - 1) * 0.5;
        aiPips[pi2].position.x = kuwagataGroup.position.x + (pi2 - 1) * 0.5;
      }

      /* ---- 開始時の顔ズーム（スケールポップ）演出 ---- */
      if (introTimer > 0) {
        introTimer = Math.max(0, introTimer - dt);
        var pop = BUG_SCALE * (1 + Math.sin(Math.min(1, (0.9 - introTimer) / 0.9) * Math.PI) * 0.22);
        kabutoGroup.scale.setScalar(pop);
        kuwagataGroup.scale.setScalar(pop);
        if (introTimer === 0) { kabutoGroup.scale.setScalar(BUG_SCALE); kuwagataGroup.scale.setScalar(BUG_SCALE); }
      }

      /* ---- 蜜しぶきパーティクル更新（プール） ---- */
      updateHoneyPool(dt);

      /* ---- ラウンド終了待機フェーズ ---- */
      if (gamePhase === 'roundEnd') {
        roundEndTimer -= dt;

        /* 蜜壺の行方演出: 勝ち=自分側に落ちてカブトが食べて喜ぶ / 負け=クワガタが持ち去る */
        var re = 1 - Math.max(0, roundEndTimer) / 1.2; // 0→1
        if (roundEndResult === 'player') {
          // 蜜壺がカブトの前に落ちてくる
          var tx = kabutoGroup.position.x + 0.9;
          ropeMarker.position.x += (tx - ropeMarker.position.x) * Math.min(1, dt * 8);
          ropeMarker.position.y = Math.max(0.45, 0.8 - re * 0.6) + Math.abs(Math.sin(re * Math.PI * 3)) * 0.12;
          ropeMarker.rotation.z = Math.sin(re * Math.PI * 2) * 0.25;
          // カブトが跳ねて喜ぶ（食べる演出）
          kabutoGroup.position.y = Math.abs(Math.sin(re * Math.PI * 4)) * 0.35;
          kabutoGroup.rotation.z = Math.sin(re * Math.PI * 4) * 0.15;
        } else if (roundEndResult === 'ai') {
          // クワガタが蜜壺をくわえて持ち去る
          ropeMarker.position.x += dt * 4.5;
          ropeMarker.position.y = 0.7 + Math.sin(re * Math.PI * 6) * 0.08;
          ropeMarker.rotation.z = -0.3;
          kuwagataGroup.position.x = ropeMarker.position.x + 0.9;
          kuwagataGroup.position.y = Math.abs(Math.sin(re * Math.PI * 5)) * 0.15;
        }

        if (roundEndTimer <= 0) {
          /* 次のラウンドへ、またはゲーム終了 */
          if (playerWins >= 2 || aiWins >= 2 || round >= 3) {
            /* ゲーム終了 */
            gamePhase = 'done';
            if (playerWins > aiWins) {
              ctx.endGame(playerWins);
            } else {
              ctx.gameOver(playerWins);
            }
            return;
          }
          /* 次のラウンド開始 */
          round++;
          aiBase      = 0.8 + (round - 1) * 0.4;
          ropeOffset  = 0;
          playerPower = 0;
          aiPhase     = 0;
          glowTimer   = nextGlowWait();
          glowActive  = false;
          glowElapsed = 0;
          ropeMat.emissive.setHex(0x000000);
          ropeMat.emissiveIntensity = 0;
          ropeMat.color.setHex(0xd4a84b);
          ropeMesh.scale.y = 1;
          ropeMesh.scale.z = 1;
          ropeMarker.position.set(0, 0.8, 0);
          ropeMarker.rotation.set(0, 0, 0);
          kabutoGroup.position.set(-BUG_X, 0, 0);
          kabutoGroup.rotation.set(0, Math.PI / 2, 0);
          kuwagataGroup.position.set(BUG_X, 0, 0);
          kuwagataGroup.rotation.set(0, -Math.PI / 2, 0);
          gamePhase = 'pulling';
          stumbleTimer = 0;
          ctx.setHint(ctx.t({ en: 'Round ', ja: 'ラウンド ', es: 'Ronda ', 'pt-BR': 'Round ', fr: 'Tour ', de: 'Runde ', it: 'Round ', ko: '라운드 ', 'zh-Hans': '第', tr: 'Tur ' }) + round + ctx.t({ en: '! Tap the glow!', ja: '！光をねらえ！', es: '! ¡Toca el brillo!', 'pt-BR': '! Toque o brilho!', fr: '! Visez l\'éclat!', de: '! Leuchten antippen!', it: '! Tocca il bagliore!', ko: '! 빛날 때 탭!', 'zh-Hans': '局！点击发光处！', tr: '! Işığa dokun!' }));
          ctx.setScore(playerWins);
        }
        return;
      }

      /* ---- pulling フェーズ ---- */

      /* AIパワー: 基礎値 + 正弦波で揺らぎ */
      aiPhase += dt * 1.2;
      aiPower = aiBase + Math.min(ctx.elapsed * 0.03, 1.2) + Math.sin(aiPhase) * 0.3;

      /* プレイヤーパワー減衰 */
      playerPower = Math.max(0, playerPower - POWER_DECAY * dt);

      /* 綱オフセット更新: プレイヤーが右（+）、AIが左（-） */
      ropeOffset += (playerPower - aiPower) * dt;

      /* 綱オフセットをクランプ */
      if (ropeOffset > ROPE_LIMIT) ropeOffset = ROPE_LIMIT;
      if (ropeOffset < -ROPE_LIMIT) ropeOffset = -ROPE_LIMIT;

      /* 勝利判定 */
      if (ropeOffset >= ROPE_LIMIT) {
        /* プレイヤー勝利 — 蜜壺ゲット！ */
        playerWins++;
        updatePips();
        ctx.setScore(playerWins);
        ctx.sfx.score();
        ctx.vibrate(40);
        spawnHoneyBurst(ropeMarker.position.x, 1.1, 0);
        roundEndResult = 'player';
        gamePhase = 'roundEnd';
        roundEndTimer = 1.2;
        ctx.setHint(ctx.t({ en: '🍯 Honey pot is yours!', ja: '🍯 みつつぼゲット！', es: '🍯 ¡El tarro es tuyo!', 'pt-BR': '🍯 O pote é seu!', fr: '🍯 Le pot est à vous!', de: '🍯 Der Honigtopf gehört dir!', it: '🍯 Il vaso è tuo!', ko: '🍯 꿀단지 획득!', 'zh-Hans': '🍯 蜜罐到手！', tr: '🍯 Bal küpü senin!' }));
        return;
      }
      if (ropeOffset <= -ROPE_LIMIT) {
        /* AI勝利 */
        aiWins++;
        updatePips();
        ctx.sfx.fail ? ctx.sfx.fail() : ctx.sfx.bounce();
        ctx.vibrate(60);
        roundEndResult = 'ai';
        gamePhase = 'roundEnd';
        roundEndTimer = 1.2;
        ctx.setHint(ctx.t({ en: '🍯 Honey pot taken away…', ja: '🍯 みつつぼを もっていかれた…', es: '🍯 Se llevó el tarro…', 'pt-BR': '🍯 Levaram o pote…', fr: '🍯 Le pot est emporté…', de: '🍯 Der Honigtopf ist weg…', it: '🍯 Il vaso è stato portato via…', ko: '🍯 꿀단지를 빼앗겼다…', 'zh-Hans': '🍯 蜜罐被抢走了…', tr: '🍯 Bal küpü kaçırıldı…' }));
        return;
      }

      /* 光りゾーンタイマー更新 */
      if (glowActive) {
        glowElapsed += dt;
        if (glowElapsed >= GLOW_DURATION) {
          /* 光り終わり */
          glowActive  = false;
          glowElapsed = 0;
          glowTimer   = nextGlowWait();
          ropeMat.emissive.setHex(0x000000);
          ropeMat.emissiveIntensity = 0;
          ropeMat.color.setHex(0xd4a84b);
          ropeMesh.scale.y = 1;
          ropeMesh.scale.z = 1;
        } else {
          /* 綱全体が黄→白に大きく点滅 */
          var pulse = 0.5 + 0.5 * Math.sin(glowElapsed * 42);
          ropeMat.color.setHex(pulse > 0.45 ? 0xffffff : 0xffee00);
          ropeMat.emissive.setHex(pulse > 0.45 ? 0xffffff : 0xffee00);
          ropeMat.emissiveIntensity = 0.9 + pulse * 0.8;
          ropeMesh.scale.y = 1.65 + pulse * 0.35;
          ropeMesh.scale.z = 1.65 + pulse * 0.35;
        }
      } else {
        glowTimer -= dt;
        if (glowTimer <= 0) {
          /* 光りゾーン発動 */
          glowActive  = true;
          glowElapsed = 0;
          ropeMat.emissive.setHex(0xffee00);
          ropeMat.emissiveIntensity = 1.0;
          ropeMat.color.setHex(0xffee00);
          ropeMesh.scale.y = 1.7;
          ropeMesh.scale.z = 1.7;
          ctx.setHint(ctx.t({ en: 'NOW!', ja: 'いま！', es: '¡AHORA!', 'pt-BR': 'AGORA!', fr: 'MAINTENANT!', de: 'JETZT!', it: 'ORA!', ko: '지금!', 'zh-Hans': '现在！', tr: 'ŞİMDİ!' }));
        } else if (glowTimer <= GLOW_WARN) {
          ropeMat.color.setHex(0xffd21c);
          ropeMat.emissive.setHex(0xaa6600);
          ropeMat.emissiveIntensity = 0.35 + (GLOW_WARN - glowTimer) * 1.2;
          ropeMesh.scale.y = 1.25;
          ropeMesh.scale.z = 1.25;
          ctx.setHint(ctx.t({ en: 'Get ready…', ja: 'くるぞ…', es: 'Prepárate…', 'pt-BR': 'Prepare-se…', fr: 'Préparez-vous…', de: 'Bereit machen…', it: 'Preparati…', ko: '준비해…', 'zh-Hans': '要来了…', tr: 'Hazırlan…' }));
        } else {
          ropeMat.color.setHex(0xd4a84b);
          ropeMat.emissive.setHex(0x000000);
          ropeMat.emissiveIntensity = 0;
          ropeMesh.scale.y = 1;
          ropeMesh.scale.z = 1;
        }
      }

      /* 蜜壺（センターマーカー）位置更新
       * 綱引きの直感どおり、プレイヤー優勢(+)で蜜壺は自分側（左）へ動く */
      ropeMarker.position.x = -ropeOffset;
      ropeMarker.position.y = 0.8;
      ropeMarker.rotation.z = Math.sin(markerClock * 3) * 0.1; // 吊られてゆらゆら

      /* 虫のX位置：綱に合わせて少し動く（マーカーと同方向） */
      kabutoGroup.position.x = -BUG_X - ropeOffset * 0.25;
      kuwagataGroup.position.x = BUG_X - ropeOffset * 0.25;

      /* 虫の揺れ（引っ張り負荷で揺れる） */
      var tension = Math.abs(playerPower - aiPower);
      if (stumbleTimer > 0) stumbleTimer = Math.max(0, stumbleTimer - dt);
      var stumble = stumbleTimer > 0 ? Math.sin(stumbleTimer * 80) * 0.22 : 0;
      var sway = Math.sin(aiPhase * 4) * tension * 0.02;
      kabutoGroup.rotation.z = sway * 0.3;
      kabutoGroup.rotation.x = stumble;
      kuwagataGroup.rotation.z = -sway * 0.3;

      /* パワーバー更新（playerPower を最大5.0 として表示） */
      var barPct = Math.min(playerPower / 5.0, 1.0) * 100;
      powerBar.style.width = barPct + '%';

      /* ラウンド表示 */
      if (!glowActive && glowTimer > GLOW_WARN && stumbleTimer <= 0) {
        ctx.setHint(ctx.t({ en: 'Round ', ja: 'ラウンド ', es: 'Ronda ', 'pt-BR': 'Round ', fr: 'Tour ', de: 'Runde ', it: 'Round ', ko: '라운드 ', 'zh-Hans': '第', tr: 'Tur ' }) + round + '  ' + playerWins + ' - ' + aiWins);
      }
    }
  });
})();
