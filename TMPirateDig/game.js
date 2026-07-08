/* =========================================================================
 * TMPirateDig — かいぞくトレジャー
 * ルール: 5×5の砂浜グリッドに宝箱1個+小判3枚が埋まっている。
 *         タップで発掘（シャベル3本）、長押しでソナー（2回まで、距離を波紋色で表示）。
 * 操作: タップ（発掘）、長押し（ソナー）
 * スコア: 合計点（宝箱=100点、小判=30点）
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- シーンオブジェクト（init で生成、以降は再利用） ---- */
  var cellMeshes = [];      // [row][col] の2次元配列
  var cellMeshArray = [];   // ラフキャスト用フラット配列（25個）
  var chestMesh = null;     // 宝箱メッシュ（最初は非表示）
  var chestLidMesh = null;  // 宝箱ふたメッシュ
  var coinMeshes = [];      // 小判メッシュ × 3（最初は非表示）
  var sonarRingMeshes = []; // ソナー波紋リング × 2（プール）
  var raycaster = null;     // 一度だけ生成、使い回す

  /* ---- セル共有マテリアル ---- */
  var matSand = null;       // 砂（未発掘）
  var matDug = null;        // 発掘済み（暗褐色）
  var matSonarColors = [];  // ソナー距離別マテリアル [赤, オレンジ, 黄, 青]

  /* ---- 状態変数（start() でリセット） ---- */
  var grid = [];            // grid[row][col] = {type, dug, sonarUsed}
  var chestRow = 0;
  var chestCol = 0;
  var shovels = 5;
  var sonarUses = 2;
  var totalScore = 0;
  var longPressTimer = 0;
  var longPressCell = null; // {row, col} | null
  var pointerHeld = false;
  var gamePhase = 'playing'; // 'playing' | 'done'

  /* ---- ソナーアニメ状態 ---- */
  var sonarAnims = [];      // {ringIdx, timer, duration, cellX, cellZ, color} の配列（最大2）

  /* ---- グリッド定数 ---- */
  var GRID_SIZE = 5;
  var CELL_SPACING = 1.2;  // セル間隔
  var GRID_OFFSET = -((GRID_SIZE - 1) / 2) * CELL_SPACING; // センタリングオフセット

  /* ---- グリッド座標→ワールド座標 ---- */
  function cellWorldX(col) {
    return GRID_OFFSET + col * CELL_SPACING;
  }
  function cellWorldZ(row) {
    return GRID_OFFSET + row * CELL_SPACING;
  }

  /* ---- ソナー距離→マテリアルインデックス ---- */
  function sonarColorIdx(dist) {
    if (dist <= 1) return 0; // 赤（すごくちかい）
    if (dist <= 3) return 1; // オレンジ
    if (dist <= 5) return 2; // 黄色
    return 3;                // 青（とおい）
  }

  /* ---- DOM UI（init で一度だけ生成） ---- */
  var invBar = null;        // シャベル・ソナー残数アイコン列
  var sonarBtn = null;      // ソナーボタン（タップ式）
  var sonarArmed = false;   // ソナーモード（ボタンで武装→次のセルタップで発射）
  var maxShovels = 5;       // 表示用の最大シャベル数（宝箱ボーナスで増える）

  /* ---- 宝箱ふた開きアニメ＆コイン噴出パーティクル（プール） ---- */
  var chestOpenTimer = -1;  // -1 = 非アクティブ
  var burstCoins = [];      // {mesh, vx, vy, vz, life} プール

  /* ---- 宝方向矢印（ソナー発射時に宝の方へスライドして消える） ---- */
  var arrowGroup = null;
  var arrowMat = null;
  var arrowAnim = null;     // {timer, duration, x, z, dx, dz} | null

  /* ---- 初回操作デモ（非言語・指ゴースト👆） ---- */
  var fingerDiv = null;
  var demoActive = false;
  var demoPlayed = false;   // ページロード中に1回だけ再生
  var demoTimer = 0;
  var demoStep = 0;
  var _projVec = null;      // 3D→画面座標変換用（init で生成）
  var DEMO_CELL_A = { row: 2, col: 2 };  // デモで「掘る」マス
  var DEMO_CELL_B = { row: 3, col: 1 };  // デモで「ソナー」を撃つマス

  /* ---- 3D座標→画面ピクセル座標 ---- */
  function worldToScreen(ctx, x, y, z) {
    _projVec.set(x, y, z);
    _projVec.project(ctx.camera);
    return {
      x: (_projVec.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_projVec.y * 0.5 + 0.5) * window.innerHeight
    };
  }

  /* ---- 指ゴーストの移動（CSS transition でスライド） ---- */
  function moveFinger(px, py) {
    fingerDiv.style.left = (px - 22) + 'px';
    fingerDiv.style.top = (py - 8) + 'px';
  }
  function fingerTap(down) {
    fingerDiv.style.transform = down ? 'scale(0.7)' : 'scale(1)';
  }

  /* ---- ソナー波紋＋方向矢印の発射（実プレイ・デモ共用） ----
   * dx, dz: セル→ターゲットのワールド差分。波紋の長軸と矢印をその方向へ向ける */
  function fireSonarVisual(row, col, dx, dz, colorIdx) {
    var worldDist = Math.sqrt(dx * dx + dz * dz);
    var ringIdx = sonarAnims.length % 2;
    var ring = sonarRingMeshes[ringIdx];
    ring.position.set(cellWorldX(col), 0.12, cellWorldZ(row));
    ring.material = matSonarColors[colorIdx].clone();
    /* 楕円の長軸を宝の方向へ向ける（リング面内回転） */
    ring.rotation.z = -Math.atan2(dz, dx);
    ring.scale.set(1, 1, 1);
    ring.visible = true;

    /* 波紋の最終半径 ≒ 宝までの距離に比例して拡がる */
    sonarAnims.push({
      ringIdx: ringIdx,
      timer: 0,
      duration: 1.4,
      maxScale: Math.max(0.9, worldDist) / 0.3
    });

    /* 方向矢印: セルから宝の方向へスライドしながらフェード */
    if (worldDist > 0.1) {
      arrowGroup.position.set(cellWorldX(col), 0.3, cellWorldZ(row));
      arrowGroup.rotation.y = Math.atan2(dx, dz);
      arrowGroup.visible = true;
      arrowAnim = {
        timer: 0, duration: 1.2,
        x: cellWorldX(col), z: cellWorldZ(row),
        dx: dx / worldDist, dz: dz / worldDist
      };
    }
  }

  /* ---- デモの後片付け（スキップ時も呼ばれる） ---- */
  function endDemo(ctx) {
    if (!demoActive) return;
    demoActive = false;
    gamePhase = 'playing';
    fingerDiv.style.display = 'none';
    /* デモで掘ったフリをしたマスを元に戻す（grid 状態は触っていない） */
    var m = cellMeshes[DEMO_CELL_A.row][DEMO_CELL_A.col];
    m.material.color.setHex(0xf4d47c);
    m.position.y = 0;
    /* デモ用の波紋・矢印を消す */
    var i;
    for (i = 0; i < sonarRingMeshes.length; i++) sonarRingMeshes[i].visible = false;
    sonarAnims = [];
    arrowGroup.visible = false;
    arrowAnim = null;
    renderSonarBtn(); /* 武装風スタイルを解除 */
    ctx.setHint(ctx.t({ en: 'Tap to dig! Hold for sonar!', ja: 'タップで発掘！ 長押しでソナー！', es: '¡Toca para excavar! ¡Mantén sonar!', 'pt-BR': 'Toque para cavar! Segure sonar!', fr: 'Touchez pour creuser ! Maintenez sonar !', de: 'Tippen = Graben! Halten = Sonar!', it: 'Tocca per scavare! Tieni sonar!', ko: '탭해서 파라! 길게 눌러 소나!', 'zh-Hans': '点击挖掘！长按声纳！', tr: 'Kazmak için dokun! Sonar için basılı tut!' }));
  }

  /* ---- デモのイベント列（t 秒に達したら a(ctx) を実行） ---- */
  var DEMO_EVENTS = [
    { t: 0.2, a: function (ctx) {
      /* 指ゴースト登場 → マスAの上へ */
      var p = worldToScreen(ctx, cellWorldX(DEMO_CELL_A.col), 0.1, cellWorldZ(DEMO_CELL_A.row));
      fingerDiv.style.transition = 'none';
      moveFinger(p.x, p.y + 90);
      fingerDiv.style.display = '';
      fingerDiv.style.opacity = '0';
      /* 次フレームで transition を戻してスライドイン */
    } },
    { t: 0.35, a: function (ctx) {
      var p = worldToScreen(ctx, cellWorldX(DEMO_CELL_A.col), 0.1, cellWorldZ(DEMO_CELL_A.row));
      fingerDiv.style.transition = 'left 0.55s ease, top 0.55s ease, transform 0.14s ease, opacity 0.3s ease';
      fingerDiv.style.opacity = '1';
      moveFinger(p.x, p.y);
    } },
    { t: 1.1, a: function (ctx) { fingerTap(true); } },
    { t: 1.25, a: function (ctx) {
      /* タップ → 砂が掘れる（見た目だけ） */
      var m = cellMeshes[DEMO_CELL_A.row][DEMO_CELL_A.col];
      m.material.color.setHex(0x5c3a1e);
      m.position.y = -0.05;
      ctx.sfx.tap();
      fingerTap(false);
    } },
    { t: 2.0, a: function (ctx) {
      /* ソナーボタンへ移動 */
      var r = sonarBtn.getBoundingClientRect();
      moveFinger(r.left + r.width / 2, r.top + r.height / 2);
    } },
    { t: 2.8, a: function (ctx) { fingerTap(true); } },
    { t: 2.95, a: function (ctx) {
      /* ソナーボタンを押す（武装風の見た目だけ） */
      sonarBtn.style.boxShadow = '0 0 0 4px #44ddff, 0 4px 12px rgba(0,0,0,0.4)';
      sonarBtn.style.background = '#1a6a9a';
      ctx.sfx.tap();
      fingerTap(false);
    } },
    { t: 3.6, a: function (ctx) {
      /* マスBへ移動 */
      var p = worldToScreen(ctx, cellWorldX(DEMO_CELL_B.col), 0.1, cellWorldZ(DEMO_CELL_B.row));
      moveFinger(p.x, p.y);
    } },
    { t: 4.4, a: function (ctx) { fingerTap(true); } },
    { t: 4.55, a: function (ctx) {
      /* タップ → 波紋＋方向矢印（方向はダミー: 盤面中央向き） */
      var dx = cellWorldX(2) - cellWorldX(DEMO_CELL_B.col);
      var dz = cellWorldZ(2) - cellWorldZ(DEMO_CELL_B.row);
      fireSonarVisual(DEMO_CELL_B.row, DEMO_CELL_B.col, dx, dz, 2);
      ctx.sfx.bounce();
      renderSonarBtn(); /* 武装風スタイルを解除 */
      fingerTap(false);
    } },
    { t: 6.0, a: function (ctx) { endDemo(ctx); } }
  ];

  /* ---- 残数アイコンの再描画（消費分はグレーアウト） ---- */
  function renderInventory() {
    if (!invBar) return;
    var html = '';
    var i;
    for (i = 0; i < maxShovels; i++) {
      html += '<span style="opacity:' + (i < shovels ? 1 : 0.22) + ';margin:0 2px">⛏</span>';
    }
    html += '<span style="display:inline-block;width:14px"></span>';
    for (i = 0; i < 2; i++) {
      html += '<span style="opacity:' + (i < sonarUses ? 1 : 0.22) + ';margin:0 2px">🌊</span>';
    }
    invBar.innerHTML = html;
  }

  /* ---- ソナーボタンの見た目更新 ---- */
  function renderSonarBtn() {
    if (!sonarBtn) return;
    sonarBtn.style.opacity = sonarUses > 0 ? '1' : '0.3';
    sonarBtn.style.boxShadow = sonarArmed
      ? '0 0 0 4px #44ddff, 0 4px 12px rgba(0,0,0,0.4)'
      : '0 4px 12px rgba(0,0,0,0.4)';
    sonarBtn.style.background = sonarArmed ? '#1a6a9a' : '#2f8ecb';
  }

  /* ---- ヤシの木を1本作る ---- */
  function makePalmTree(THREE, x, z) {
    var group = new THREE.Group();

    /* 幹 */
    var trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 2.2, 6);
    var trunkMat = Style.mat(0x8b6914);
    var trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(0, 1.1, 0);
    group.add(trunk);

    /* 葉っぱ（球で表現） */
    var leafGeo = new THREE.SphereGeometry(0.55, 6, 5);
    var leafMat = Style.mat(0x2d7a2d);
    var leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(0, 2.5, 0);
    group.add(leaf);

    /* 小さな葉のクラスター */
    var offsets = [
      [0.4, 0.1, 0], [-0.4, 0.1, 0],
      [0, 0.1, 0.4], [0, 0.1, -0.4]
    ];
    var leafSmallGeo = new THREE.SphereGeometry(0.32, 5, 4);
    for (var i = 0; i < offsets.length; i++) {
      var sl = new THREE.Mesh(leafSmallGeo, leafMat);
      sl.position.set(offsets[i][0], 2.3 + offsets[i][1], offsets[i][2]);
      group.add(sl);
    }

    group.position.set(x, 0, z);
    return group;
  }

  Shell.registerGame({
    id: 'TMPirateDig',
    title: { en: 'Pirate Treasure', ja: 'かいぞくトレジャー', es: 'Tesoro Pirata', 'pt-BR': 'Tesouro Pirata', fr: 'Trésor Pirate', de: 'Piraten-Schatz', it: 'Tesoro Pirata', ko: '해적 보물', 'zh-Hans': '海盗宝藏', tr: 'Korsan Hazinesi' },
    howto: { en: 'Tap to dig! (5 shovels)\nHold for sonar to find treasure!\nFind the chest = +2 shovels!', ja: 'タップで ほりだせ！（シャベル5本）\n長おしのソナーで たからの ばしょを さぐれ！\n宝箱を みつけると シャベル+2本！', es: '¡Toca para excavar! (5 palas)\n¡Mantén para sonar y buscar!\n¡Cofre = +2 palas!', 'pt-BR': 'Toque para cavar! (5 pás)\nSegure o sonar para buscar!\nBaú = +2 pás!', fr: 'Touchez pour creuser ! (5 pelles)\nMaintenez pour le sonar !\nCoffre = +2 pelles !', de: 'Tippe zum Graben! (5 Schaufeln)\nHalten für Sonar!\nTruhe = +2 Schaufeln!', it: 'Tocca per scavare! (5 pale)\nTieni premuto per il sonar!\nCofano = +2 pale!', ko: '탭해서 파라! (삽 5개)\n길게 눌러 소나로 탐색!\n보물상자 = 삽+2!', 'zh-Hans': '点击挖掘！（5把铲）\n长按声纳探测位置！\n找到宝箱 = 铲+2！', tr: 'Kazmak için dokun! (5 kürek)\nSonar için basılı tut!\nSandık = +2 kürek!' },
    scoreLabel: { en: 'pts', ja: 'てん', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pti', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0x87ceeb,
    cameraFov: 55,
    cameraPos: [0, 8.6, 8.4],
    cameraLookAt: [0, 0, -1.2],
    fitWidth: 8.5,

    /* ================================================================
     * init — Three.js オブジェクトをここで一度だけ生成
     * ================================================================ */
    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;

      /* ---- レイキャスター（一度だけ生成） ---- */
      raycaster = new THREE.Raycaster();

      /* ---- 共有マテリアル ---- */
      matSand = Style.mat(0xf4d47c);
      matDug  = Style.mat(0x5c3a1e);

      /* ソナー距離別マテリアル */
      matSonarColors = [
        new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), // 赤
        new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), // オレンジ
        new THREE.MeshBasicMaterial({ color: 0xffee00, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), // 黄
        new THREE.MeshBasicMaterial({ color: 0x4444ff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })  // 青
      ];

      /* ---- 砂浜（斑点入りの砂テクスチャ） ---- */
      var scv = document.createElement('canvas');
      scv.width = scv.height = 128;
      var sc2 = scv.getContext('2d');
      sc2.fillStyle = '#f4d47c'; sc2.fillRect(0, 0, 128, 128);
      for (var sp = 0; sp < 260; sp++) {
        sc2.fillStyle = sp % 3 ? 'rgba(255,255,255,0.35)' : 'rgba(180,140,60,0.3)';
        sc2.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
      }
      var sandTex = new THREE.CanvasTexture(scv);
      sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
      sandTex.repeat.set(5, 5);
      var beach = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 18),
        new THREE.MeshLambertMaterial({ map: sandTex }));
      beach.rotation.x = -Math.PI / 2;
      beach.position.y = -0.05;
      scene.add(beach);

      /* ---- 遠景: 海（横帯）＋波打ち際＋海賊船シルエット ---- */
      var sea = new THREE.Mesh(new THREE.PlaneGeometry(34, 9),
        Style.mat(0x2f8ecb));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(0, -0.04, -9.5);
      scene.add(sea);
      var foam = new THREE.Mesh(new THREE.PlaneGeometry(34, 0.5),
        new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.85 }));
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(0, -0.03, -5.2);
      scene.add(foam);
      // 海賊船（船体＋マスト＋帆＋ドクロ旗）
      var ship = new THREE.Group();
      var hull = new THREE.Mesh(Style.roundedBox(2.6, 0.7, 0.8), Style.mat(0x5a3a22));
      hull.position.y = 0.35; ship.add(hull);
      var bow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 6), Style.mat(0x5a3a22));
      bow.rotation.z = -Math.PI / 2; bow.position.set(1.6, 0.45, 0); ship.add(bow);
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 8), Style.mat(0x3e2a18));
      mast.position.y = 1.7; ship.add(mast);
      var sail = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1),
        new THREE.MeshLambertMaterial({ color: 0xf5efe0, side: THREE.DoubleSide }));
      sail.position.set(0, 1.8, 0.02); ship.add(sail);
      var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32),
        new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide }));
      flag.position.set(0.28, 2.85, 0); ship.add(flag);
      ship.position.set(2.2, 0, -8.6);
      scene.add(ship);
      ctx.scene.userData = ctx.scene.userData || {};
      ctx.scene.userData.pirateShip = ship;

      /* ---- ヤシの木（縦画面でも見える近さに） ---- */
      scene.add(makePalmTree(THREE, -3.9, -3.4));
      scene.add(makePalmTree(THREE,  3.9, -3.8));
      /* ---- 小道具: たる＋ヒトデ ---- */
      var barrel = new THREE.Group();
      var bBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.8, 12), Style.mat(0x8a5a30));
      bBody.position.y = 0.4; barrel.add(bBody);
      var bBand1 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 14), Style.mat(0x4a4a4a));
      bBand1.rotation.x = Math.PI / 2; bBand1.position.y = 0.6; barrel.add(bBand1);
      var bBand2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 14), Style.mat(0x4a4a4a));
      bBand2.rotation.x = Math.PI / 2; bBand2.position.y = 0.2; barrel.add(bBand2);
      barrel.position.set(3.7, 0, 2.6);
      scene.add(barrel);
      var starfish = new THREE.Group();
      for (var sf = 0; sf < 5; sf++) {
        var arm = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 5), Style.mat(0xf08a5a));
        arm.rotation.z = Math.PI / 2;
        arm.rotation.y = sf * (Math.PI * 2 / 5);
        arm.position.set(Math.cos(sf * Math.PI * 2 / 5) * 0.12, 0, Math.sin(sf * Math.PI * 2 / 5) * 0.12);
        starfish.add(arm);
      }
      starfish.position.set(-3.6, 0.05, 3.0);
      scene.add(starfish);

      /* ---- 5×5 セルメッシュ ---- */
      var cellGeo = Style.roundedBox(1.0, 0.1, 1.0);
      cellMeshes = [];
      cellMeshArray = [];

      for (var row = 0; row < GRID_SIZE; row++) {
        cellMeshes[row] = [];
        for (var col = 0; col < GRID_SIZE; col++) {
          /* matSand を clone してセルごとに独立マテリアルを持たせる
           * （個別に色変更できるよう） */
          var mat = matSand.clone();
          var mesh = new THREE.Mesh(cellGeo, mat);
          mesh.position.set(cellWorldX(col), 0, cellWorldZ(row));
          mesh.userData.row = row;
          mesh.userData.col = col;
          scene.add(mesh);
          cellMeshes[row][col] = mesh;
          cellMeshArray.push(mesh);
        }
      }

      /* ---- グリッド区切り線（細い平板） ---- */
      var lineMat = Style.mat(0xc8a84b);

      /* 横方向の線（行区切り） */
      for (var r = 0; r <= GRID_SIZE; r++) {
        var lz = GRID_OFFSET - CELL_SPACING / 2 + r * CELL_SPACING;
        var hLineGeo = Style.roundedBox(GRID_SIZE * CELL_SPACING + 0.05, 0.04, 0.05);
        var hLine = new THREE.Mesh(hLineGeo, lineMat);
        hLine.position.set(0, 0.05, lz);
        scene.add(hLine);
      }
      /* 縦方向の線（列区切り） */
      for (var c = 0; c <= GRID_SIZE; c++) {
        var lx = GRID_OFFSET - CELL_SPACING / 2 + c * CELL_SPACING;
        var vLineGeo = Style.roundedBox(0.05, 0.04, GRID_SIZE * CELL_SPACING + 0.05);
        var vLine = new THREE.Mesh(vLineGeo, lineMat);
        vLine.position.set(lx, 0.05, 0);
        scene.add(vLine);
      }

      /* ---- 宝箱メッシュ（最初は非表示） ---- */
      var chestBodyGeo = Style.roundedBox(0.6, 0.28, 0.4);
      var chestMat = Style.mat(0x8b6914);
      chestMesh = new THREE.Mesh(chestBodyGeo, chestMat);
      chestMesh.visible = false;
      scene.add(chestMesh);

      /* 宝箱のふた */
      var chestLidGeo = Style.roundedBox(0.6, 0.14, 0.4);
      var chestLidMat = Style.mat(0xb8860b);
      chestLidMesh = new THREE.Mesh(chestLidGeo, chestLidMat);
      chestLidMesh.visible = false;
      scene.add(chestLidMesh);

      /* 宝箱の金具（装飾） */
      var claspGeo = Style.roundedBox(0.1, 0.1, 0.05);
      var claspMat = Style.mat(0xffd700);
      var clasp = new THREE.Mesh(claspGeo, claspMat);
      /* 宝箱の子として追加 — 宝箱の前面中央 */
      clasp.position.set(0, 0, 0.23);
      chestMesh.add(clasp);

      /* ---- 小判メッシュ × 3（最初は非表示） ---- */
      var coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10);
      var coinMat = Style.mat(0xffd700);
      coinMeshes = [];
      for (var ci = 0; ci < 3; ci++) {
        var coin = new THREE.Mesh(coinGeo, coinMat);
        coin.visible = false;
        scene.add(coin);
        coinMeshes.push(coin);
      }

      /* ---- ソナー波紋リング × 2（プール）---- */
      var ringGeo = new THREE.RingGeometry(0.24, 0.3, 32);
      sonarRingMeshes = [];
      for (var ri = 0; ri < 2; ri++) {
        /* マテリアルは後でアニメ時に差し替えるが、初期化には色0を使う */
        var ringMesh = new THREE.Mesh(ringGeo, matSonarColors[0].clone());
        ringMesh.rotation.x = -Math.PI / 2; // 水平に寝かせる
        ringMesh.position.y = 0.12;
        ringMesh.visible = false;
        ringMesh.scale.set(1, 1, 1);
        scene.add(ringMesh);
        sonarRingMeshes.push(ringMesh);
      }

      /* ---- 宝方向矢印（ソナー発射時に表示・1本を使い回し） ---- */
      _projVec = new THREE.Vector3();
      arrowMat = new THREE.MeshBasicMaterial({ color: 0xffee00, transparent: true, opacity: 0.95, depthWrite: false });
      arrowGroup = new THREE.Group();
      var arrowShaft = new THREE.Mesh(Style.roundedBox(0.12, 0.05, 0.5), arrowMat);
      arrowShaft.position.set(0, 0, 0.25);
      arrowGroup.add(arrowShaft);
      var arrowTip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.36, 8), arrowMat);
      arrowTip.rotation.x = Math.PI / 2;
      arrowTip.position.set(0, 0, 0.66);
      arrowGroup.add(arrowTip);
      arrowGroup.visible = false;
      scene.add(arrowGroup);

      /* ---- コイン噴出パーティクル × 12（プール） ---- */
      var burstGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.03, 8);
      var burstMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
      burstCoins = [];
      for (var bi = 0; bi < 12; bi++) {
        var bMesh = new THREE.Mesh(burstGeo, burstMat);
        bMesh.visible = false;
        scene.add(bMesh);
        burstCoins.push({ mesh: bMesh, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      /* ---- DOM: シャベル・ソナー残数アイコン列（画面下） ---- */
      invBar = document.createElement('div');
      invBar.style.cssText = [
        'position:fixed',
        'bottom:16px',
        'left:50%',
        'transform:translateX(-50%)',
        'font-size:26px',
        'line-height:1',
        'padding:6px 14px',
        'background:rgba(0,0,0,0.28)',
        'border-radius:24px',
        'z-index:100',
        'pointer-events:none',
        'white-space:nowrap'
      ].join(';');
      document.body.appendChild(invBar);

      /* ---- DOM: ソナーボタン（画面右下・タップ式） ---- */
      sonarBtn = document.createElement('button');
      sonarBtn.textContent = '🌊';
      sonarBtn.style.cssText = [
        'position:fixed',
        'bottom:64px',
        'right:16px',
        'width:64px',
        'height:64px',
        'font-size:30px',
        'background:#2f8ecb',
        'border:none',
        'border-radius:50%',
        'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
        'cursor:pointer',
        'z-index:100',
        'touch-action:manipulation'
      ].join(';');
      document.body.appendChild(sonarBtn);

      function toggleSonar(e) {
        if (e) e.preventDefault();
        if (gamePhase !== 'playing' || sonarUses <= 0) return;
        sonarArmed = !sonarArmed;
        renderSonarBtn();
        ctx.sfx.tap();
      }
      sonarBtn.addEventListener('click', toggleSonar);
      sonarBtn.addEventListener('touchend', toggleSonar, { passive: false });

      /* ---- DOM: 指ゴースト（初回操作デモ用・👆） ---- */
      fingerDiv = document.createElement('div');
      fingerDiv.textContent = '👆';
      fingerDiv.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        'font-size:46px',
        'line-height:1',
        'z-index:102',
        'pointer-events:none',
        'display:none',
        'filter:drop-shadow(0 3px 6px rgba(0,0,0,0.45))',
        'transition:left 0.55s ease, top 0.55s ease, transform 0.14s ease, opacity 0.3s ease'
      ].join(';');
      document.body.appendChild(fingerDiv);
    },

    /* ================================================================
     * start — ゲーム状態をリセット（オブジェクトは再利用）
     * ================================================================ */
    start: function (ctx) {
      var i, r, c;

      /* ---- グリッド初期化 ---- */
      grid = [];
      for (r = 0; r < GRID_SIZE; r++) {
        grid[r] = [];
        for (c = 0; c < GRID_SIZE; c++) {
          grid[r][c] = { type: 'empty', dug: false, sonarUsed: false };
        }
      }

      /* ---- ランダム配置: 宝箱1個 ---- */
      chestRow = Math.floor(ctx.random() * GRID_SIZE);
      chestCol = Math.floor(ctx.random() * GRID_SIZE);
      grid[chestRow][chestCol].type = 'chest';

      /* ---- ランダム配置: 小判3枚（宝箱と重ならない位置） ---- */
      var coinCount = 0;
      while (coinCount < 3) {
        var pr = Math.floor(ctx.random() * GRID_SIZE);
        var pc = Math.floor(ctx.random() * GRID_SIZE);
        if (grid[pr][pc].type === 'empty') {
          grid[pr][pc].type = 'coin';
          coinCount++;
        }
      }

      /* ---- 状態リセット ---- */
      shovels = 5;
      maxShovels = 5;
      sonarUses = 2;
      sonarArmed = false;
      totalScore = 0;
      longPressTimer = 0;
      longPressCell = null;
      pointerHeld = false;
      gamePhase = 'playing';
      sonarAnims = [];
      chestOpenTimer = -1;

      /* コイン噴出パーティクル非表示 */
      for (i = 0; i < burstCoins.length; i++) {
        burstCoins[i].mesh.visible = false;
        burstCoins[i].life = 0;
      }

      /* ---- セルメッシュ見た目リセット ---- */
      for (r = 0; r < GRID_SIZE; r++) {
        for (c = 0; c < GRID_SIZE; c++) {
          var mesh = cellMeshes[r][c];
          mesh.material.color.setHex(0xf4d47c); // 砂色に戻す
          mesh.position.y = 0; // 沈み込みリセット
        }
      }

      /* ---- 宝箱・小判 メッシュ位置をセットし非表示 ---- */
      chestMesh.position.set(
        cellWorldX(chestCol), 0.24, cellWorldZ(chestRow)
      );
      chestLidMesh.position.set(
        cellWorldX(chestCol), 0.38, cellWorldZ(chestRow)
      );
      chestMesh.visible = false;
      chestLidMesh.visible = false;
      chestLidMesh.rotation.x = 0;

      /* 小判を対応するコインマスに配置 */
      var coinIdx = 0;
      for (r = 0; r < GRID_SIZE; r++) {
        for (c = 0; c < GRID_SIZE; c++) {
          if (grid[r][c].type === 'coin') {
            coinMeshes[coinIdx].position.set(
              cellWorldX(c), 0.18, cellWorldZ(r)
            );
            coinMeshes[coinIdx].visible = false;
            coinIdx++;
          }
        }
      }

      /* ---- ソナーリングリセット ---- */
      for (i = 0; i < sonarRingMeshes.length; i++) {
        sonarRingMeshes[i].visible = false;
        sonarRingMeshes[i].scale.set(1, 1, 1);
      }

      /* ---- 宝方向矢印リセット ---- */
      arrowGroup.visible = false;
      arrowAnim = null;

      /* ---- UI ---- */
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Tap to dig! Hold for sonar!', ja: 'タップで発掘！ 長押しでソナー！', es: '¡Toca para excavar! ¡Mantén sonar!', 'pt-BR': 'Toque para cavar! Segure sonar!', fr: 'Touchez pour creuser ! Maintenez sonar !', de: 'Tippen = Graben! Halten = Sonar!', it: 'Tocca per scavare! Tieni sonar!', ko: '탭해서 파라! 길게 눌러 소나!', 'zh-Hans': '点击挖掘！长按声纳！', tr: 'Kazmak için dokun! Sonar için basılı tut!' }));
      renderInventory();
      renderSonarBtn();

      /* ---- 初回のみ: 非言語の操作デモを再生（タップでスキップ可） ---- */
      if (!demoPlayed) {
        demoPlayed = true;
        demoActive = true;
        demoTimer = 0;
        demoStep = 0;
        gamePhase = 'demo';
        fingerDiv.style.display = 'none';
        fingerDiv.style.transform = 'scale(1)';
        ctx.setHint('');
      }
    },

    /* ================================================================
     * onPointerDown — タップ開始時にロングプレスタイマー開始＆セル判定
     * ================================================================ */
    onPointerDown: function (ctx, p) {
      /* デモ中のタップはスキップ扱い（そのタップでは掘らない） */
      if (demoActive) {
        endDemo(ctx);
        return;
      }
      if (gamePhase !== 'playing') return;

      /* レイキャストでセルを特定（raycaster は init で生成済み） */
      raycaster.setFromCamera({ x: p.nx, y: p.ny }, ctx.camera);
      var hits = raycaster.intersectObjects(cellMeshArray);
      if (hits.length > 0) {
        var idx = cellMeshArray.indexOf(hits[0].object);
        var row = Math.floor(idx / GRID_SIZE);
        var col = idx % GRID_SIZE;
        longPressCell = { row: row, col: col };
      } else {
        longPressCell = null;
      }

      pointerHeld = true;
      longPressTimer = 0;
    },

    /* ================================================================
     * onPointerUp — 短押し→発掘 / 長押し→ソナー
     * ================================================================ */
    onPointerUp: function (ctx, p) {
      if (!pointerHeld) return;
      pointerHeld = false;

      if (gamePhase !== 'playing') return;
      if (!longPressCell) return;

      var row = longPressCell.row;
      var col = longPressCell.col;
      var cell = grid[row][col];

      if (cell.dug) {
        /* 発掘済みのセルは無視 */
        ctx.setHint(ctx.t({ en: 'Already dug here!', ja: 'もう発掘済みだよ！', es: '¡Ya excavado!', 'pt-BR': 'Já escavado!', fr: 'Déjà creusé !', de: 'Schon gegraben!', it: 'Già scavato!', ko: '이미 팠어!', 'zh-Hans': '已经挖过了！', tr: 'Zaten kazıldı!' }));
        return;
      }

      var dtHeld = longPressTimer;

      if (sonarArmed || dtHeld >= 0.5) {
        /* ---- ソナー（ボタン武装タップ or 長押し） ---- */
        sonarArmed = false;
        if (sonarUses <= 0) {
          renderSonarBtn();
          return;
        }
        sonarUses--;
        renderInventory();
        renderSonarBtn();

        /* マンハッタン距離（色分け用）とワールド距離・方向（波紋＋矢印表現用） */
        var dist = Math.abs(row - chestRow) + Math.abs(col - chestCol);
        var colorIdx = sonarColorIdx(dist);
        var dx = cellWorldX(chestCol) - cellWorldX(col);
        var dz = cellWorldZ(chestRow) - cellWorldZ(row);

        /* 波紋（宝方向へ歪む楕円）＋宝方向矢印を発射 */
        fireSonarVisual(row, col, dx, dz, colorIdx);

        ctx.vibrate(40);
        ctx.sfx.bounce();
        ctx.setHint('');

      } else {
        /* ---- 発掘 ---- */
        if (shovels <= 0) {
          ctx.setHint(ctx.t({ en: 'No shovels left!', ja: 'シャベルがない！', es: '¡Sin palas!', 'pt-BR': 'Sem pás!', fr: 'Plus de pelles !', de: 'Keine Schaufeln!', it: 'Nessuna pala!', ko: '삽이 없어!', 'zh-Hans': '铲子用完了！', tr: 'Kürek kalmadı!' }));
          return;
        }
        shovels--;
        cell.dug = true;

        /* セルを暗褐色に、少し沈み込ませる */
        cellMeshes[row][col].material.color.setHex(0x5c3a1e);
        cellMeshes[row][col].position.y = -0.05;

        var foundChest = false;
        var foundCoin = false;

        if (cell.type === 'chest') {
          /* 宝箱発見！ */
          totalScore += 100;
          chestMesh.visible = true;
          chestLidMesh.visible = true;
          ctx.sfx.success();
          ctx.vibrate(50);
          foundChest = true;
        } else if (cell.type === 'coin') {
          /* 小判発見！ */
          totalScore += 30;
          /* 対応する小判メッシュを表示 */
          var coinIdx2 = 0;
          for (var r2 = 0; r2 < GRID_SIZE; r2++) {
            for (var c2 = 0; c2 < GRID_SIZE; c2++) {
              if (grid[r2][c2].type === 'coin') {
                if (r2 === row && c2 === col) {
                  coinMeshes[coinIdx2].visible = true;
                }
                coinIdx2++;
              }
            }
          }
          ctx.sfx.score();
          ctx.vibrate(20);
          foundCoin = true;
        } else {
          /* 空振り */
          ctx.sfx.tap();
        }

        ctx.setScore(totalScore);

        if (foundChest) {
          /* ボーナスステージ！宝箱を見つけたらボーナス +50 */
          totalScore += 50;
          ctx.setScore(totalScore);
          shovels += 2; // 宝箱発見ボーナス: シャベル+2でもっと掘れる
          ctx.setHint(ctx.t({ en: 'Treasure chest! +150 pts! +2 shovels!', ja: '宝箱ゲット！+150点！ シャベル+2本！', es: '¡Cofre! +150 pts! ¡+2 palas!', 'pt-BR': 'Baú! +150 pts! +2 pás!', fr: 'Coffre ! +150 pts ! +2 pelles !', de: 'Truhe! +150 Pkt! +2 Schaufeln!', it: 'Cofano! +150 pti! +2 pale!', ko: '보물상자 득템! +150점! 삽+2!', 'zh-Hans': '宝箱！+150分！铲+2！', tr: 'Sandık! +150 puan! +2 kürek!' }));
        } else if (foundCoin) {
          ctx.setHint(ctx.t({ en: 'Coin! +30 pts! Shovels left: ', ja: '小判ゲット！+30点！シャベル残り: ', es: '¡Moneda! +30 pts! Palas: ', 'pt-BR': 'Moeda! +30 pts! Pás: ', fr: 'Pièce ! +30 pts ! Pelles: ', de: 'Münze! +30 Pkt! Schaufeln: ', it: 'Moneta! +30 pti! Pale: ', ko: '동전 획득! +30점! 남은 삽: ', 'zh-Hans': '金币！+30分！铲子剩余: ', tr: 'Madeni para! +30 puan! Kürek: ' }) + shovels);
        } else {
          ctx.setHint(ctx.t({ en: 'Empty... Shovels left: ', ja: 'はずれ… シャベル残り: ', es: 'Vacío... Palas: ', 'pt-BR': 'Vazio... Pás: ', fr: 'Vide... Pelles: ', de: 'Leer... Schaufeln: ', it: 'Vuoto... Pale: ', ko: '빗나갔어... 남은 삽: ', 'zh-Hans': '空的…铲子剩余: ', tr: 'Boş... Kürek: ' }) + shovels);
        }

        /* すべての宝箱と小判を掘り当てたか確認 */
        var allFound = true;
        if (grid[chestRow][chestCol].dug === false) allFound = false;
        if (allFound) {
          for (var r3 = 0; r3 < GRID_SIZE; r3++) {
            for (var c3 = 0; c3 < GRID_SIZE; c3++) {
              if (grid[r3][c3].type === 'coin' && !grid[r3][c3].dug) {
                allFound = false;
              }
            }
          }
        }

        /* シャベル切れ or 全取得でゲーム終了 */
        if (shovels <= 0 || allFound) {
          gamePhase = 'done';
          ctx.endGame(totalScore);
        }
      }
    },

    /* ================================================================
     * update — ロングプレスタイマー更新 & ソナーアニメ
     * ================================================================ */
    update: function (ctx, dt) {
      /* ---- 初回操作デモの進行 ---- */
      if (demoActive) {
        demoTimer += dt;
        while (demoActive && demoStep < DEMO_EVENTS.length && demoTimer >= DEMO_EVENTS[demoStep].t) {
          DEMO_EVENTS[demoStep].a(ctx);
          demoStep++;
        }
      }

      /* ---- 宝方向矢印アニメ（スライドしながらフェード） ---- */
      if (arrowAnim) {
        arrowAnim.timer += dt;
        var at = arrowAnim.timer / arrowAnim.duration;
        if (at >= 1) {
          arrowGroup.visible = false;
          arrowAnim = null;
        } else {
          var slide = 0.25 + at * 1.0;
          arrowGroup.position.set(
            arrowAnim.x + arrowAnim.dx * slide,
            0.3 + Math.sin(at * Math.PI) * 0.12,
            arrowAnim.z + arrowAnim.dz * slide
          );
          arrowMat.opacity = 0.95 * (1 - at * at);
        }
      }

      /* ロングプレス中: タイマー加算 & ヒント */
      if (pointerHeld && gamePhase === 'playing') {
        longPressTimer += dt;
        if (longPressTimer > 0.3 && sonarUses > 0 && longPressCell) {
          var cell = grid[longPressCell.row][longPressCell.col];
          if (!cell.dug) {
            ctx.setHint(ctx.t({ en: 'Sonar charging... Release to fire! (', ja: 'ソナー発動中... 離すと発射！（残り', es: 'Sonar cargando... ¡Suelta! (', 'pt-BR': 'Sonar carregando... Solte! (', fr: 'Sonar en charge... Relâchez ! (', de: 'Sonar lädt... Loslassen! (', it: 'Sonar in carica... Rilascia! (', ko: '소나 충전중... 손 떼면 발사! (', 'zh-Hans': '声纳充能中…松开发射！（', tr: 'Sonar yükleniyor... Bırak! (' }) + sonarUses + ctx.t({ en: ' left)', ja: '回）', es: ' restantes)', 'pt-BR': ' restantes)', fr: ' restantes)', de: ' übrig)', it: ' rimasti)', ko: '회 남음)', 'zh-Hans': '次）', tr: ' kaldı)' }));
          }
        }
      }

      /* ソナーリングアニメ（スケールを拡大、フェードアウト） */
      var alive = [];
      for (var i = 0; i < sonarAnims.length; i++) {
        var anim = sonarAnims[i];
        anim.timer += dt;
        var t = anim.timer / anim.duration;
        if (t < 1.0) {
          /* 最終半径 ≒ 宝までの距離（maxScale）まで拡大、透明度 1→0。
           * 長軸（local X = 宝の方向）を伸ばした楕円で方向も示す */
          var s = 1 + t * Math.max(1, anim.maxScale - 1);
          sonarRingMeshes[anim.ringIdx].scale.set(s * 1.3, s * 0.72, 1);
          sonarRingMeshes[anim.ringIdx].material.opacity = 0.85 * (1 - t);
          alive.push(anim);
        } else {
          /* アニメ終了: リングを非表示に戻す */
          sonarRingMeshes[anim.ringIdx].visible = false;
        }
      }
      sonarAnims = alive;
    }
  });

})();
