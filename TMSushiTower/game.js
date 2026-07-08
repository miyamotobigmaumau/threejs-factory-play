/* =========================================================================
 * TMSushiTower — ハンバーガータワー（旧：かいてんずしタワー）
 * ルール: 流れてくる具材をタップで落として重ね、高いハンバーガーを作る。
 *   はみ出しは切り落とし。幅ゼロで終了。（重ねる＝バーガーで自然）
 * 操作: タップで具材を落下させる。
 * マッシュアップ肝:
 *   ① 下の土台がレーンで左右に動き続ける → 動く土台へのスタック。
 *   ② ピクルス（緑）の上に積むと次の1層が滑る（判定幅-30%）。
 * スコア: 重ねた層数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var BLOCK_W_INIT = 2.6;
  var BLOCK_H = 0.62;        // 高さを出して「にぎり寿司」らしいボリュームに
  var BLOCK_DEPTH = 1.5;
  var LANE_SPEED_BASE = 2.5;
  var LANE_RANGE = 2.9;   // 縦画面の視野内に収まる可動域
  var SUSHI_DROP_START = 9; // 落下開始Y（タワー頂上からの相対）
  var PERFECT_BONUS = 0.05;

  /* ---------- ハンバーガーの具材定義（重ねる） ---------- */
  var NETA = [
    { color: 0x7a4a2a, topColor: 0x8a5632 }, // パティ（肉）
    { color: 0xf4b400, topColor: 0xffcf3a }, // チーズ
    { color: 0x6fbf4a, topColor: 0x86d95f }, // レタス
    { color: 0xe0483c, topColor: 0xef5e50 }, // トマト
    { color: 0xf3e4c1, topColor: 0xfff0d2 }, // たまねぎ
    { color: 0x9a3f2a, topColor: 0xb0432f }  // ベーコン
  ];
  var WASABI_COLOR = 0x8fbf3f; // ピクルス（すべる具材）

  /* ---------- 状態 ---------- */
  var blocks;
  var fallingBlock;   // {x, width, y, speed, isWasabi, netaIdx}
  var laneX, laneDir, laneSpeed, lanePhase;
  var towerHeight, score;
  var wasabiActive, nextWasabiIn;
  var gameEnded;
  var cameraTargetY;
  var dropFast; // タップで加速フラグ

  /* ---------- Three.js オブジェクト（init で全生成） ---------- */
  var laneMesh;
  var railGroup;      // 上部の回転レール
  // 積みブロックプール（最大60段）
  var POOL_SIZE = 62;
  var stackPool = []; // {group, shariMesh, netaMesh, noriMesh}
  var fallingGroup;   // 落下中グループ（プールから借用）
  var stackActive = 0; // プールの使用数

  /* ---------- 有効幅ガイド（ピクルス滑り時、縮んだ判定幅を点線で表示） ---------- */
  var GUIDE_DOTS = 9;
  var guideGroup, guideDots = [], guideMat;

  /* ---------- 切り落とし破片プール ---------- */
  var DEBRIS_COUNT = 6;
  var debris = []; // {mesh, active, x, y, vx, vy, vr, life}

  /* ---------- パーフェクトリング（金色） ---------- */
  var perfectRing, perfectRingT;

  function spawnDebris(x, y, width, colorHex, dir) {
    for (var i = 0; i < DEBRIS_COUNT; i++) {
      if (debris[i].active) continue;
      var db = debris[i];
      db.active = true;
      db.x = x; db.y = y;
      db.vx = dir * (1.5 + Math.random());
      db.vy = 2.5;
      db.vr = dir * -(4 + Math.random() * 3);
      db.life = 0.7;
      db.mesh.scale.set(Math.max(0.05, width), 1, 1);
      db.mesh.material.color.setHex(colorHex);
      db.mesh.material.opacity = 1;
      db.mesh.position.set(x, y, 0);
      db.mesh.rotation.z = 0;
      db.mesh.visible = true;
      return;
    }
  }

  /* ---------- プールエントリ更新（幅・色を変えてvisible=true） ---------- */
  function configurePoolEntry(entry, width, isWasabi, netaIdx) {
    // 各ピース＝ハンバーガーの具材1層（重ねると自然にバーガーになる）
    var baseColor = isWasabi ? WASABI_COLOR : (netaIdx !== undefined ? NETA[netaIdx].color : 0xf3e4c1);
    entry.shari.scale.x = width / 1.0;
    entry.shari.material.color.setHex(baseColor);

    if (!isWasabi && netaIdx !== undefined) {
      // 上面の明るいハイライトで立体感
      entry.neta.scale.x = width * 0.98;
      entry.neta.material.color.setHex(NETA[netaIdx].topColor);
      entry.neta.visible = true;
    } else {
      entry.neta.visible = false;
    }
    entry.nori.visible = false;   // のりは使わない
    entry.group.visible = true;
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMSushiTower',
    title: { en: 'Burger Tower', ja: 'ハンバーガータワー', es: 'Torre de Hamburgesa', 'pt-BR': 'Torre de Hambúrguer', fr: 'Tour de Burger', de: 'Burger-Turm', it: 'Torre di Hamburger', ko: '버거 타워', 'zh-Hans': '汉堡塔', tr: 'Burger Kulesi' },
    howto: { en: 'Tap to drop the ingredient from the rail!\nStack it perfectly in the center to build a tall burger!\nWatch out: slippery on pickles (green)!', ja: 'レールを流れる具材を タップで落とす！\nまんなかに ぴったり重ねて 高いバーガーに！\nピクルス（緑）の上は すべるから ちゅうい！', es: '¡Toca para soltar el ingrediente del raíl!\n¡Apílalo en el centro para un burger gigante!\n¡Cuidado: resbala sobre los pepinillos (verde)!', 'pt-BR': 'Toque para soltar o ingrediente do trilho!\nEmpilhe no centro para um hambúrguer alto!\nCuidado: escorrega sobre os picles (verde)!', fr: 'Touchez pour lâcher l\'ingrédient du rail !\nEmpilez-le au centre pour un grand burger !\nAttention : glissant sur les cornichons (vert) !', de: 'Tippe zum Fallen des Zutaten vom Gleis!\nMitten stapeln für einen hohen Burger!\nVorsicht: Glatt auf Gurken (grün)!', it: 'Tocca per far cadere l\'ingrediente dal binario!\nImpilalo al centro per un burger alto!\nAttenzione: scivoloso sui cetriolini (verde)!', ko: '레일의 재료를 탭해서 떨어뜨려라!\n가운데에 딱 맞게 쌓아 높은 버거를!\n피클(초록) 위는 미끄러우니 조심!', 'zh-Hans': '点击让食材从轨道落下！\n叠放在正中央堆出高汉堡！\n注意：腌黄瓜（绿色）上会滑！', tr: 'Malzemeyi raydan düşürmek için dokun!\nYüksek burger için tam ortaya istifle!\nDikkat: turşular (yeşil) üzerinde kayar!' },
    scoreLabel: { en: 'layers', ja: 'そう', es: 'capas', 'pt-BR': 'camadas', fr: 'couches', de: 'Lagen', it: 'strati', ko: '층', 'zh-Hans': '层', tr: 'kat' },
    bg: 0xfff5e6,
    cameraFov: 55,
    cameraPos: [0, 6, 14],
    cameraLookAt: [0, 2, 0],
    fitWidth: 9,

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 床
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        Style.mat(0xc8a870)
      );
      floor.rotation.x = -Math.PI / 2;
      ctx.scene.add(floor);

      // カウンター台
      var counter = new THREE.Mesh(
        Style.roundedBox(10, 0.6, 2.2),
        Style.mat(0x8b5e3c)
      );
      counter.position.set(0, 0.3, 0);
      ctx.scene.add(counter);
      ctx.scene.position.set(0, 0, 0); // 旧バグでシーンが+0.3浮いていた保険リセット

      // レーンベルト
      var belt = new THREE.Mesh(
        Style.roundedBox(9.5, 0.08, 1.4),
        Style.mat(0x444444)
      );
      belt.position.set(0, 0.64, 0);
      ctx.scene.add(belt);

      // 壁
      var wall = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 8),
        Style.mat(0xf5e6d0)
      );
      wall.position.set(0, 4, -3);
      ctx.scene.add(wall);

      // 暖簾（CanvasTexture・文字なしのバーガーの絵）
      var cv = document.createElement('canvas');
      cv.width = 128; cv.height = 256;
      var c2 = cv.getContext('2d');
      c2.fillStyle = '#1a3399';
      c2.fillRect(0, 0, 128, 256);
      // 上バンズ
      c2.fillStyle = '#e8a33d';
      c2.beginPath(); c2.arc(64, 128, 34, Math.PI, 0); c2.closePath(); c2.fill();
      // ゴマ
      c2.fillStyle = '#fff3d6';
      [[50, 108], [64, 100], [78, 108]].forEach(function (s) {
        c2.beginPath(); c2.arc(s[0], s[1], 2.5, 0, Math.PI * 2); c2.fill();
      });
      // レタス・チーズ・パティ
      c2.fillStyle = '#6fbf4a'; c2.fillRect(28, 128, 72, 8);
      c2.fillStyle = '#f4b400'; c2.fillRect(30, 136, 68, 7);
      c2.fillStyle = '#7a4a2a'; c2.fillRect(28, 143, 72, 13);
      // 下バンズ
      c2.fillStyle = '#e8a33d';
      c2.beginPath();
      c2.moveTo(30, 156); c2.lineTo(98, 156);
      c2.quadraticCurveTo(98, 174, 82, 174); c2.lineTo(46, 174);
      c2.quadraticCurveTo(30, 174, 30, 156);
      c2.closePath(); c2.fill();
      var noren = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 1.6),
        new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.DoubleSide })
      );
      noren.position.set(0, 2.8, -2.9);
      ctx.scene.add(noren);

      // 上部の回転レール（寿司がこれに乗って左右に流れる。タワーと一緒に上昇）
      railGroup = new THREE.Group();
      var railBar = new THREE.Mesh(Style.roundedBox(LANE_RANGE * 2 + 1.6, 0.14, 0.9), Style.mat(0x3a3a3a));
      railGroup.add(railBar);
      var railTrim = new THREE.Mesh(Style.roundedBox(LANE_RANGE * 2 + 1.6, 0.05, 1.0),
        new THREE.MeshBasicMaterial({ color: 0xf4c400 }));
      railTrim.position.y = 0.09;
      railGroup.add(railTrim);
      // ローラーの頭(等間隔の丸)
      var rollGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.95, 8);
      for (var ri = 0; ri <= 6; ri++) {
        var roll = new THREE.Mesh(rollGeo, Style.mat(0x707070));
        roll.rotation.x = Math.PI / 2;
        roll.position.set(-LANE_RANGE + ri * (LANE_RANGE * 2 / 6), -0.1, 0);
        railGroup.add(roll);
      }
      ctx.scene.add(railGroup);

      // 壁のお品書き(2枚・絵＋数字のみ)
      function menuBoard(kind, price, x) {
        var mcv = document.createElement('canvas');
        mcv.width = 128; mcv.height = 160;
        var mc = mcv.getContext('2d');
        mc.fillStyle = '#2a2018'; mc.fillRect(0, 0, 128, 160);
        mc.fillStyle = '#f5ecd8'; mc.fillRect(6, 6, 116, 148);
        if (kind === 'burger') {
          // バーガーの絵
          mc.fillStyle = '#e8a33d';
          mc.beginPath(); mc.arc(64, 58, 30, Math.PI, 0); mc.closePath(); mc.fill();
          mc.fillStyle = '#6fbf4a'; mc.fillRect(32, 58, 64, 7);
          mc.fillStyle = '#7a4a2a'; mc.fillRect(30, 65, 68, 11);
          mc.fillStyle = '#e8a33d';
          mc.beginPath();
          mc.moveTo(32, 76); mc.lineTo(96, 76);
          mc.quadraticCurveTo(96, 92, 82, 92); mc.lineTo(46, 92);
          mc.quadraticCurveTo(32, 92, 32, 76);
          mc.closePath(); mc.fill();
        } else {
          // ポテトの絵
          mc.fillStyle = '#f4b400';
          for (var fx = 0; fx < 5; fx++) mc.fillRect(40 + fx * 10, 28, 6, 42);
          mc.fillStyle = '#d43d2a';
          mc.beginPath();
          mc.moveTo(34, 56); mc.lineTo(94, 56); mc.lineTo(88, 94); mc.lineTo(40, 94);
          mc.closePath(); mc.fill();
        }
        mc.fillStyle = '#333';
        mc.font = 'bold 28px sans-serif'; mc.textAlign = 'center';
        mc.fillText(price, 64, 130);
        var bm = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25),
          new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(mcv) }));
        bm.position.set(x, 3.1, -2.88);
        return bm;
      }
      ctx.scene.add(menuBoard('burger', '390', -2.2));
      ctx.scene.add(menuBoard('fries', '250', 2.2));

      // カウンター上の小道具: 湯のみとしょうゆ差し
      var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 10), Style.mat(0x4a7a52));
      cup.position.set(-3.6, 0.78, 0.6);
      ctx.scene.add(cup);
      var soy = new THREE.Group();
      var soyBody = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.34, 10),
        new THREE.MeshPhongMaterial({ color: 0x7a1f10, shininess: 60 }));
      soyBody.position.y = 0.17;
      var soyCap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 8), Style.mat(0xcc3322));
      soyCap.position.y = 0.4;
      soy.add(soyBody, soyCap);
      soy.position.set(3.6, 0.62, 0.6);
      ctx.scene.add(soy);

      // タワーの土台皿（静止・中央）
      laneMesh = new THREE.Group();
      var plateMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.82, 0.82, 0.08, 16),
        Style.mat(0xffffff)
      );
      laneMesh.add(plateMesh);
      ctx.scene.add(laneMesh);

      // スタックプール（最大62エントリ）
      // シャリ（俵型の白いご飯）＝下2/3を占める丸みのある塊。ネタは上に乗り、少し前後にはみ出す。
      var shariBaseGeo  = Style.roundedBox(1.0, BLOCK_H * 0.62, BLOCK_DEPTH * 0.86, 0.18);
      var netaBaseGeo   = Style.roundedBox(1.0, BLOCK_H * 0.34, BLOCK_DEPTH * 1.02, 0.14);
      var noriBaseGeo   = Style.roundedBox(1.0, BLOCK_H * 0.14, BLOCK_DEPTH * 0.9);
      var shariMat = Style.mat(0xfffaf0);
      var noriMat  = Style.mat(0x1a1a1a);

      for (var pi = 0; pi < POOL_SIZE; pi++) {
        var g = new THREE.Group();

        var shari = new THREE.Mesh(shariBaseGeo, shariMat.clone());
        shari.position.y = -BLOCK_H * 0.06;   // ご飯は下側
        g.add(shari);

        var netaMesh = new THREE.Mesh(netaBaseGeo, Style.mat(NETA[0].topColor));
        netaMesh.position.y = BLOCK_H * 0.30;  // ネタはご飯の上に乗る
        g.add(netaMesh);

        var noriMesh = new THREE.Mesh(noriBaseGeo, noriMat.clone());
        noriMesh.position.y = BLOCK_H * 0.10;  // 軍艦の帯（のり）
        g.add(noriMesh);

        g.visible = false;
        ctx.scene.add(g);
        stackPool.push({ group: g, shari: shari, neta: netaMesh, nori: noriMesh });
      }

      // 有効幅ガイド（小箱の列＝点線。ピクルスの上に縮んだ判定幅を示す）
      guideGroup = new THREE.Group();
      var dotGeo = Style.roundedBox(0.14, 0.05, 0.2);
      guideMat = new THREE.MeshBasicMaterial({ color: 0xff8f2a, transparent: true, opacity: 0.8, depthWrite: false });
      for (var gd = 0; gd < GUIDE_DOTS; gd++) {
        var dot = new THREE.Mesh(dotGeo, guideMat);
        guideDots.push(dot);
        guideGroup.add(dot);
      }
      guideGroup.visible = false;
      ctx.scene.add(guideGroup);

      // 切り落とし破片プール（フェード用に個別マテリアル）
      var debrisGeo = Style.roundedBox(1.0, BLOCK_H * 0.62, BLOCK_DEPTH * 0.86, 0.18);
      for (var di = 0; di < DEBRIS_COUNT; di++) {
        var dMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
        var dm = new THREE.Mesh(debrisGeo, dMat);
        dm.visible = false;
        ctx.scene.add(dm);
        debris.push({ mesh: dm, active: false, x: 0, y: 0, vx: 0, vy: 0, vr: 0, life: 0 });
      }

      // パーフェクトリング（金色・広がって消える）
      perfectRing = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.0, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0, side: 2, depthWrite: false })
      );
      perfectRing.rotation.x = -Math.PI / 2;
      perfectRing.visible = false;
      ctx.scene.add(perfectRing);
      perfectRingT = 0;
    },

    start: function (ctx) {
      // プール全非表示
      for (var pi = 0; pi < stackPool.length; pi++) stackPool[pi].group.visible = false;
      stackActive = 0;
      guideGroup.visible = false;
      for (var dj = 0; dj < DEBRIS_COUNT; dj++) {
        debris[dj].active = false;
        debris[dj].mesh.visible = false;
      }
      perfectRing.visible = false;
      perfectRingT = 0;
      blocks = [];
      fallingBlock = null;
      fallingGroup = null;

      laneX = 0; laneDir = 1; laneSpeed = LANE_SPEED_BASE; lanePhase = 0;
      towerHeight = 0; score = 0;
      wasabiActive = false;
      nextWasabiIn = 4 + Math.floor(Math.random() * 4);
      gameEnded = false;
      cameraTargetY = 2;
      dropFast = false;

      // 土台ブロック
      var entry = stackPool[stackActive++];
      configurePoolEntry(entry, BLOCK_W_INIT, false, 0);
      entry.group.position.set(0, 0.68, 0);
      blocks.push({ poolIdx: stackActive - 1, x: 0, width: BLOCK_W_INIT });

      laneMesh.position.set(0, 0.68, 0); // 皿は中央に固定（タワーの土台）
      railGroup.position.set(0, 0.68 + SUSHI_DROP_START * 0.42, 0);

      spawnFalling(ctx);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Tap to drop!', ja: 'タップで落とす！', es: '¡Toca para soltar!', 'pt-BR': 'Toque para soltar!', fr: 'Touchez pour lâcher !', de: 'Tippe zum Fallen!', it: 'Tocca per far cadere!', ko: '탭해서 떨어뜨려라!', 'zh-Hans': '点击落下！', tr: 'Düşürmek için dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (!fallingBlock || gameEnded || fallingBlock.dropping) return;
      // タップの瞬間の位置から真下へ落とす（ここが腕の見せどころ）
      fallingBlock.dropping = true;
      fallingBlock.x = laneX;
      ctx.sfx.tap();
    },

    update: function (ctx, dt) {
      if (gameEnded) return;

      /* --- レーン上の寿司の左右移動（ホバー中のみ） --- */
      lanePhase += laneDir * laneSpeed * dt / (LANE_RANGE * 2);
      if (lanePhase >= 1.0) { lanePhase = 1.0; laneDir = -1; }
      if (lanePhase <= 0.0) { lanePhase = 0.0; laneDir = 1; }
      laneX = (lanePhase * 2 - 1) * LANE_RANGE;
      var towerTopY = 0.68 + towerHeight * BLOCK_H;
      // 上部レールはタワーに合わせて上昇
      var railY = towerTopY + SUSHI_DROP_START * 0.42;
      railGroup.position.y += (railY - railGroup.position.y) * Math.min(1, dt * 4);

      /* --- 寿司: ホバー(レール追従) or 落下(真下) --- */
      if (fallingBlock && fallingGroup) {
        if (!fallingBlock.dropping) {
          // レールに乗って左右に流れる（ぷるぷる待機）
          fallingBlock.y = railGroup.position.y + 0.28;
          fallingGroup.position.set(laneX, fallingBlock.y, 0);
          fallingGroup.rotation.z = Math.sin(performance.now() * 0.004) * 0.05;
        } else {
          fallingGroup.rotation.z = 0;
          fallingBlock.y -= 22.0 * dt;
          var targetY = towerTopY + BLOCK_H;
          if (fallingBlock.y <= targetY) {
            fallingBlock.y = targetY;
            landBlock(ctx);
          } else {
            fallingGroup.position.set(fallingBlock.x, fallingBlock.y, 0); // 真下に落ちる
          }
        }
      }

      /* --- カメラ上昇 --- */
      var wantY = 2 + towerHeight * BLOCK_H * 0.8;
      cameraTargetY += (wantY - cameraTargetY) * dt * 2;
      ctx.camera.position.y = cameraTargetY + 5;
      ctx.camera.lookAt(0, cameraTargetY, 0);

      /* --- ピクルスガイド（縮んだ有効幅を点線で表示） --- */
      if (wasabiActive && blocks.length) {
        var gTop = blocks[blocks.length - 1];
        var gw = gTop.width * 0.7;
        guideGroup.visible = true;
        guideGroup.position.set(gTop.x, towerTopY + BLOCK_H * 0.75, 0.9);
        for (var gd = 0; gd < GUIDE_DOTS; gd++) {
          guideDots[gd].position.x = -gw / 2 + gw * gd / (GUIDE_DOTS - 1);
        }
        guideMat.opacity = 0.55 + Math.sin(performance.now() * 0.008) * 0.35;
      } else {
        guideGroup.visible = false;
      }

      /* --- 切り落とし破片（落下＋回転＋フェード） --- */
      for (var di = 0; di < DEBRIS_COUNT; di++) {
        var db = debris[di];
        if (!db.active) continue;
        db.life -= dt;
        db.vy -= 30 * dt;
        db.x += db.vx * dt;
        db.y += db.vy * dt;
        db.mesh.position.set(db.x, db.y, 0);
        db.mesh.rotation.z += db.vr * dt;
        db.mesh.material.opacity = Math.max(0, Math.min(1, db.life / 0.5));
        if (db.life <= 0 || db.y < -2) {
          db.active = false;
          db.mesh.visible = false;
        }
      }

      /* --- パーフェクトリング（広がりながらフェード） --- */
      if (perfectRingT > 0) {
        perfectRingT -= dt;
        var prT = 1 - Math.max(0, perfectRingT) / 0.6;
        perfectRing.scale.setScalar(1 + prT * 1.6);
        perfectRing.material.opacity = Math.max(0, 1 - prT);
        if (perfectRingT <= 0) perfectRing.visible = false;
      }
    }
  });

  /* ---------- 落下ブロック生成 ---------- */
  function spawnFalling(ctx) {
    var top = blocks[blocks.length - 1];
    var isWasabi = (blocks.length >= nextWasabiIn);
    var netaIdx = Math.floor(Math.random() * NETA.length);

    if (stackActive >= POOL_SIZE) return; // プール枯渇（60段到達 = 実質クリア）

    var entry = stackPool[stackActive++];
    configurePoolEntry(entry, top.width, isWasabi, isWasabi ? undefined : netaIdx);
    var hoverY = 0.68 + towerHeight * BLOCK_H + SUSHI_DROP_START * 0.42 + 0.28;
    entry.group.position.set(laneX, hoverY, 0);

    fallingGroup = entry.group;
    fallingBlock = {
      poolIdx: stackActive - 1,
      width: top.width,
      x: laneX,
      y: hoverY,
      dropping: false,
      isWasabi: isWasabi,
      netaIdx: netaIdx
    };
  }

  /* ---------- 着地処理 ---------- */
  function landBlock(ctx) {
    var top = blocks[blocks.length - 1];

    // ワサビ効果: 実効的な下段幅を30%狭く計算
    var effectiveTopW = wasabiActive ? top.width * 0.7 : top.width;

    var newX = fallingBlock.x; // タップで固定した落下位置
    var oL = Math.max(newX - fallingBlock.width / 2, top.x - effectiveTopW / 2);
    var oR = Math.min(newX + fallingBlock.width / 2, top.x + effectiveTopW / 2);
    var overlapW = oR - oL;

    if (overlapW <= 0.05) {
      // 場外 → ゲームオーバー
      fallingGroup.position.y = 0.68 + towerHeight * BLOCK_H + BLOCK_H;
      guideGroup.visible = false;
      ctx.sfx.fail();
      ctx.vibrate(80);
      gameEnded = true;
      setTimeout(function () { ctx.gameOver(score); }, 600);
      return;
    }

    var newWidth = overlapW;
    var newCenterX = (oL + oR) / 2;
    var landY = 0.68 + towerHeight * BLOCK_H + BLOCK_H;

    // ピタリ判定
    var perfect = Math.abs(newWidth - effectiveTopW) / effectiveTopW < 0.05;
    if (perfect) {
      newWidth = Math.min(top.width + PERFECT_BONUS, BLOCK_W_INIT);
      newCenterX = top.x;
      ctx.sfx.success();
      ctx.setHint(ctx.t({ en: 'Perfect! ✨', ja: 'へい、らっしゃい！', es: '¡Perfecto! ✨', 'pt-BR': 'Perfeito! ✨', fr: 'Parfait ! ✨', de: 'Perfekt! ✨', it: 'Perfetto! ✨', ko: '완벽! ✨', 'zh-Hans': '完美！✨', tr: 'Mükemmel! ✨' }));
      // 金色リング
      perfectRing.visible = true;
      perfectRing.material.opacity = 1;
      perfectRing.scale.setScalar(1);
      perfectRing.position.set(newCenterX, landY + 0.1, 0);
      perfectRingT = 0.6;
    } else {
      ctx.sfx.score();
      ctx.setHint('');
      // はみ出した分を破片として切り落とす（落下＋フェード）
      var wHalf = fallingBlock.width / 2;
      var debrisColor = fallingBlock.isWasabi ? WASABI_COLOR : NETA[fallingBlock.netaIdx].color;
      var overL = oL - (newX - wHalf);
      if (overL > 0.04) spawnDebris(newX - wHalf + overL / 2, landY, overL, debrisColor, -1);
      var overR = (newX + wHalf) - oR;
      if (overR > 0.04) spawnDebris(oR + overR / 2, landY, overR, debrisColor, 1);
    }
    ctx.vibrate(15);

    // 確定位置にメッシュを移動（幅スケール更新）
    var entry = stackPool[fallingBlock.poolIdx];
    configurePoolEntry(entry, newWidth, fallingBlock.isWasabi, fallingBlock.isWasabi ? undefined : fallingBlock.netaIdx);
    entry.group.position.set(newCenterX, 0.68 + towerHeight * BLOCK_H + BLOCK_H, 0);

    blocks.push({ poolIdx: fallingBlock.poolIdx, x: newCenterX, width: newWidth });
    towerHeight++;
    score++;
    ctx.setScore(score);

    // ワサビ状態の更新
    if (fallingBlock.isWasabi) {
      wasabiActive = true;
      nextWasabiIn = blocks.length + 4 + Math.floor(Math.random() * 5);
    } else if (wasabiActive) {
      wasabiActive = false;
    }

    // 難易度上昇
    laneSpeed = LANE_SPEED_BASE + score * 0.12;

    fallingBlock = null;
    fallingGroup = null;

    // 幅ゼロに近い → クリア
    if (newWidth < 0.2) {
      guideGroup.visible = false;
      gameEnded = true;
      setTimeout(function () { ctx.endGame(score); }, 400);
      return;
    }

    spawnFalling(ctx);
  }
})();
