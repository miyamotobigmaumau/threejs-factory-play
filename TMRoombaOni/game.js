/* =========================================================================
 * TMRoombaOni — そうじきオニごっこ
 * ルール: 2種類のAIお掃除ロボから逃げ続けろ！家具の隙間で巻け
 * 操作: ドラッグで子どもを移動
 * スコア: 生存秒数（びょう）
 * ========================================================================= */
(function () {
  'use strict';

  /* =========================================================================
   * 定数
   * ========================================================================= */
  var ROOM_W = 20;          // 部屋の幅（X方向）
  var ROOM_D = 14;          // 部屋の奥行き（Z方向）
  var HALF_W = ROOM_W / 2; // 10
  var HALF_D = ROOM_D / 2; // 7

  var PLAYER_SPEED = 8;     // プレイヤー移動速度(units/s)
  var PLAYER_RADIUS = 0.4;  // プレイヤー衝突半径
  var ROOMBA_RADIUS = 0.7;  // ルンバ衝突半径
  var HIT_DIST = 1.0;       // 衝突判定距離（プレイヤー＋ルンバ）

  var BOUNCER_SPEED = 4.0;  // 直進型の速度
  var CHASER_SPEED_BASE = 3.5; // 学習型の基本速度
  var CHASER_TURN_SPEED = Math.PI / 2; // 90deg/s

  var SPAWN_INTERVAL = 15;  // 15秒ごとに1体追加
  var POOL_SIZE = 6;        // ルンバの事前確保数

  /* =========================================================================
   * 家具の AABB 定義（衝突判定用）
   * [cx, cz, hw, hd]  ← center X/Z, half-width X, half-depth Z
   * ========================================================================= */
  var FURNITURE_BOXES = [
    [-5, -4, 3.0, 1.0],  // ソファ (6x2)
    [ 4,  2, 1.5, 1.0],  // テーブル (3x2)
    [-7,  3, 0.6, 0.6],  // 植木鉢（円形だがAABBで近似）
  ];
  var FURN_TOPS = [0.5, 0.5, 1.5]; // 家具の天面高さ（プレイヤーが乗った時のY）
  var FURN_SHAKE_T = 2.5;  // 乗りっぱなし警告（ガタガタ）開始秒
  var FURN_EJECT_T = 4.0;  // 強制滑り落とし秒

  /* =========================================================================
   * 状態変数
   * ========================================================================= */
  // プレイヤー
  var playerMesh;
  var playerX = 0, playerZ = 0;
  var targetX = 0, targetZ = 0;
  var pointerActive = false;
  var playerRing;          // 足元の常時リングマーカー（視認性UP）

  // 家具乗りっぱなし対策
  var furnitureGroups = []; // FURNITURE_BOXES と同順の家具グループ（揺れ演出用）
  var furnBasePos = [];     // 各家具グループの基準位置 {x,z}
  var furnIdx = -1;         // 現在乗っている家具 index（-1=床）
  var furnTimer = 0;        // 同じ家具に乗り続けた秒数
  var furnWarned = false;   // 揺れ開始の振動を一度だけ

  // ルンバプール
  var roombas = []; // { mesh, brushMesh, type:'bouncer'|'chaser', active, x, z, angle, speed }

  // タイマー・スポーン
  var nextSpawnTime = 0;  // 次スポーンの elapsed 秒
  var chaserSpeedBoost = 0; // 学習型加速度累積

  // 一時計算用 Vector（フレームごとに new しない）
  var _tmpVec = null; // Three.Vector3 — init 後に生成

  /* =========================================================================
   * ルンバメッシュ生成（init で scene.add のみ）
   * ========================================================================= */
  function makeRoomba(THREE, type) {
    var g = new THREE.Group();

    // 本体ディスク（activateRoomba でタイプに応じて色を変えるため clone）
    var bodyColor = (type === 'bouncer') ? 0x888888 : 0xcc4444;
    var bodyGeo = new THREE.CylinderGeometry(ROOMBA_RADIUS, ROOMBA_RADIUS, 0.3, 16);
    var bodyMat = Style.mat(bodyColor).clone();
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.15;
    g.add(body);

    // 上部ブラシ（回転アニメ用）
    var brushGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 8);
    var brushMat = Style.mat(0x222222);
    var brush = new THREE.Mesh(brushGeo, brushMat);
    brush.position.y = 0.36;
    g.add(brush);

    // 赤いインジケーターライト（追跡型のみ表示・visible切替）
    var lightGeo = new THREE.SphereGeometry(0.12, 6, 4);
    var lightMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    var indicator = new THREE.Mesh(lightGeo, lightMat);
    indicator.position.set(0, 0.38, 0.35);
    g.add(indicator);

    // 追跡型の「目」（前方の2つの光点 = 狙っている感）
    var eyes = new THREE.Group();
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0xffee44 });
    var eyeGeo = new THREE.SphereGeometry(0.09, 6, 4);
    [-0.2, 0.2].forEach(function (ex) {
      var eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ex, 0.28, 0.58);
      eyes.add(eye);
    });
    g.add(eyes);

    // 追跡型の前方扇ビーム（進行方向の危険を可視化。local+Z=前方）
    var beamGeo = new THREE.CircleGeometry(2.4, 12, Math.PI / 2 - 0.35, 0.7);
    var beamMat = new THREE.MeshBasicMaterial({
      color: 0xff3322, transparent: true, opacity: 0.28, side: 2, depthWrite: false
    });
    var beam = new THREE.Mesh(beamGeo, beamMat);
    beam.rotation.x = Math.PI / 2;
    beam.position.y = 0.05;
    g.add(beam);

    // 接近警告の発光リング（HIT_DIST*1.5 圏内で表示）
    var glowGeo = new THREE.RingGeometry(ROOMBA_RADIUS * 1.05, ROOMBA_RADIUS * 1.45, 20);
    var glowMat = new THREE.MeshBasicMaterial({
      color: 0xff4422, transparent: true, opacity: 0.7, side: 2, depthWrite: false
    });
    var glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    glow.visible = false;
    g.add(glow);

    return { group: g, brush: brush, body: body, indicator: indicator, eyes: eyes, beam: beam, glow: glow };
  }

  /* =========================================================================
   * プレイヤーメッシュ生成（子どもの円柱シルエット）
   * ========================================================================= */
  function makePlayer(THREE) {
    var g = new THREE.Group();

    // 胴体（青シャツ）
    var bodyMat = Style.mat(0x3399ff);
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 10), bodyMat);
    body.position.y = 0.65;
    g.add(body);

    // 頭（肌色）
    var headMat = Style.mat(0xf4c07a);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), headMat);
    head.position.y = 1.2;
    g.add(head);

    // 脚（左右）
    var legMat = Style.mat(0x224499);
    [-0.15, 0.15].forEach(function (lx) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), legMat);
      leg.position.set(lx, 0.25, 0);
      g.add(leg);
    });

    return g;
  }

  /* =========================================================================
   * 家具メッシュ生成
   * ========================================================================= */
  function makeFurniture(THREE, scene) {
    // FURNITURE_BOXES と同順のグループにまとめる（乗りっぱなし警告の揺れ演出用）
    furnitureGroups = [];
    furnBasePos = [];

    // [0] ソファ（幅6、高さ0.5、奥行き2、灰青）＋背もたれ
    var sofaG = new THREE.Group();
    var sofaMat = Style.mat(0x7b9ec5);
    var sofa = new THREE.Mesh(Style.roundedBox(6, 0.5, 2), sofaMat);
    sofa.position.set(0, 0.25, 0);
    sofaG.add(sofa);
    var backMat = Style.mat(0x5a7ea0);
    var sofaBack = new THREE.Mesh(Style.roundedBox(6, 0.7, 0.25), backMat);
    sofaBack.position.set(0, 0.75, -1);
    sofaG.add(sofaBack);
    sofaG.position.set(-5, 0, -4);
    scene.add(sofaG);
    furnitureGroups.push(sofaG);
    furnBasePos.push({ x: -5, z: -4 });

    // [1] テーブル（木目茶）＋脚
    var tableG = new THREE.Group();
    var tableMat = Style.mat(0xa07848);
    var table = new THREE.Mesh(Style.roundedBox(3, 0.5, 2), tableMat);
    table.position.set(0, 0.25, 0);
    tableG.add(table);
    var legMat = Style.mat(0x7a5c30);
    [[-1, -0.7], [1, -0.7], [-1, 0.7], [1, 0.7]].forEach(function (o) {
      var tleg = new THREE.Mesh(Style.roundedBox(0.1, 0.5, 0.1), legMat);
      tleg.position.set(o[0], 0, o[1]);
      tableG.add(tleg);
    });
    tableG.position.set(4, 0, 2);
    scene.add(tableG);
    furnitureGroups.push(tableG);
    furnBasePos.push({ x: 4, z: 2 });

    // [2] 植木鉢（緑）＋葉っぱ
    var plantG = new THREE.Group();
    var plantMat = Style.mat(0x228844);
    var plant = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 1.5, 12), plantMat);
    plant.position.set(0, 0.75, 0);
    plantG.add(plant);
    var leafMat = Style.mat(0x33bb55);
    var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), leafMat);
    leaf.position.set(0, 1.8, 0);
    plantG.add(leaf);
    plantG.position.set(-7, 0, 3);
    scene.add(plantG);
    furnitureGroups.push(plantG);
    furnBasePos.push({ x: -7, z: 3 });
  }

  /* =========================================================================
   * プレイヤーが乗っている家具の index を返す（-1 = 床）
   * ========================================================================= */
  function playerFurnitureIndex(x, z) {
    for (var i = 0; i < FURNITURE_BOXES.length; i++) {
      var fb = FURNITURE_BOXES[i];
      if (x > fb[0] - fb[2] && x < fb[0] + fb[2] &&
          z > fb[1] - fb[3] && z < fb[1] + fb[3]) {
        return i;
      }
    }
    return -1;
  }

  /* =========================================================================
   * 家具グループの揺れをリセット
   * ========================================================================= */
  function resetFurnitureShake(idx) {
    if (idx < 0 || idx >= furnitureGroups.length) return;
    var g = furnitureGroups[idx];
    g.position.x = furnBasePos[idx].x;
    g.position.z = furnBasePos[idx].z;
    g.rotation.z = 0;
  }

  /* =========================================================================
   * 部屋（床・壁）生成
   * ========================================================================= */
  function makeRoom(THREE, scene) {
    // 床（彩度を落とした明るいグレージュ＝濃色プレイヤーとのコントラスト確保）
    var floorMat = Style.mat(0xdedad0);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    scene.add(floor);

    // 床のタイル模様（薄い線・低彩度）
    var lineMat = new THREE.MeshBasicMaterial({ color: 0xccc8be });
    for (var ix = -4; ix <= 4; ix++) {
      var hLine = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, 0.04), lineMat);
      hLine.rotation.x = -Math.PI / 2;
      hLine.position.set(0, 0.01, ix * (ROOM_D / 8));
      scene.add(hLine);
    }

    // まんなかのラグ（見た目のみ・判定なし）
    var rug = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xa8cbe8 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.02, 0);
    scene.add(rug);
    var rugRim = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x7ba8cc }));
    rugRim.rotation.x = -Math.PI / 2;
    rugRim.position.set(0, 0.025, 0);
    scene.add(rugRim);

    // ===== 壁ぎわの家具（プレイ領域の外・見た目のみ） =====
    // ソファ（奥の壁）
    var sofa = new THREE.Group();
    var sofaBase = new THREE.Mesh(Style.roundedBox(3.4, 0.7, 1.1), Style.mat(0xe8946a));
    sofaBase.position.y = 0.35; sofa.add(sofaBase);
    var sofaBack = new THREE.Mesh(Style.roundedBox(3.4, 0.9, 0.3), Style.mat(0xdd8258));
    sofaBack.position.set(0, 0.9, -0.4); sofa.add(sofaBack);
    var cushL = new THREE.Mesh(Style.roundedBox(0.8, 0.4, 0.7), Style.mat(0xfff3d6));
    cushL.position.set(-0.9, 0.85, 0); sofa.add(cushL);
    var cushR = new THREE.Mesh(Style.roundedBox(0.8, 0.4, 0.7), Style.mat(0xbfe3f2));
    cushR.position.set(0.9, 0.85, 0); sofa.add(cushR);
    sofa.position.set(-4.5, 0, -HALF_D + 0.75);
    scene.add(sofa);

    // テレビ台＋テレビ（奥の壁・右）
    var tvStand = new THREE.Mesh(Style.roundedBox(2.6, 0.5, 0.8), Style.mat(0x9a713f));
    tvStand.position.set(5, 0.25, -HALF_D + 0.6);
    scene.add(tvStand);
    var tv = new THREE.Mesh(Style.roundedBox(2.0, 1.2, 0.12), Style.mat(0x2a2a30));
    tv.position.set(5, 1.2, -HALF_D + 0.55);
    scene.add(tv);
    var tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0),
      new THREE.MeshBasicMaterial({ color: 0x6fc4e8 }));
    tvScreen.position.set(5, 1.2, -HALF_D + 0.62);
    scene.add(tvScreen);

    // 観葉植物（左の壁ぎわ）
    var plantPot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.6, 10), Style.mat(0xb85c3a));
    plantPot.position.set(-HALF_W + 0.8, 0.3, 2.5);
    scene.add(plantPot);
    for (var lv = 0; lv < 4; lv++) {
      var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.0, 6), Style.mat(0x4a9a52));
      leaf.position.set(-HALF_W + 0.8 + Math.cos(lv * 1.6) * 0.18, 0.95 + (lv % 2) * 0.2, 2.5 + Math.sin(lv * 1.6) * 0.18);
      leaf.rotation.z = Math.cos(lv * 1.6) * 0.35;
      leaf.rotation.x = -Math.sin(lv * 1.6) * 0.35;
      scene.add(leaf);
    }

    // 本棚（右の壁ぎわ）
    var shelf = new THREE.Mesh(Style.roundedBox(0.8, 2.0, 2.2), Style.mat(0x8a6a42));
    shelf.position.set(HALF_W - 0.5, 1.0, -1.5);
    scene.add(shelf);
    var bookColors = [0xe05050, 0x5f9ed6, 0xf2c531, 0x4a9a52];
    for (var bk = 0; bk < 4; bk++) {
      var book = new THREE.Mesh(Style.roundedBox(0.5, 0.38, 0.28), Style.mat(bookColors[bk]));
      book.position.set(HALF_W - 0.45, 0.55 + Math.floor(bk / 2) * 0.65, -2.0 + (bk % 2) * 0.7);
      scene.add(book);
    }

    // 散らばったおもちゃ（角のほう・小さい・見た目のみ）
    var toyBall = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshPhongMaterial({ color: 0xe05050, shininess: 60 }));
    toyBall.position.set(-7.5, 0.22, 5.2);
    scene.add(toyBall);
    var toyBlockA = new THREE.Mesh(Style.roundedBox(0.35, 0.35, 0.35), Style.mat(0xf2c531));
    toyBlockA.position.set(7.8, 0.18, 4.8);
    toyBlockA.rotation.y = 0.6;
    scene.add(toyBlockA);
    var toyBlockB = new THREE.Mesh(Style.roundedBox(0.35, 0.35, 0.35), Style.mat(0x5f9ed6));
    toyBlockB.position.set(8.2, 0.18, 5.3);
    scene.add(toyBlockB);

    // 壁（薄いベージュ）
    var wallMat = new THREE.MeshLambertMaterial({ color: 0xf0e8d8, side: 2 }); // DoubleSide=2

    // 奥の壁（+Z 方向）
    var wallBack = new THREE.Mesh(Style.roundedBox(ROOM_W, 3, 0.2), wallMat);
    wallBack.position.set(0, 1.5, -HALF_D);
    scene.add(wallBack);

    // 手前の壁（-Z 方向、カメラ側）
    var wallFront = new THREE.Mesh(Style.roundedBox(ROOM_W, 3, 0.2), wallMat);
    wallFront.position.set(0, 1.5, HALF_D);
    scene.add(wallFront);

    // 左壁
    var wallLeft = new THREE.Mesh(Style.roundedBox(0.2, 3, ROOM_D), wallMat);
    wallLeft.position.set(-HALF_W, 1.5, 0);
    scene.add(wallLeft);

    // 右壁
    var wallRight = new THREE.Mesh(Style.roundedBox(0.2, 3, ROOM_D), wallMat);
    wallRight.position.set(HALF_W, 1.5, 0);
    scene.add(wallRight);
  }

  /* =========================================================================
   * ルンバスポーン位置（壁際ランダム）
   * ========================================================================= */
  function randomEdgePos() {
    var side = Math.floor(Math.random() * 4);
    var margin = 1.2;
    if (side === 0) return { x: -HALF_W + margin, z: (Math.random() - 0.5) * (ROOM_D - margin * 2) };
    if (side === 1) return { x:  HALF_W - margin, z: (Math.random() - 0.5) * (ROOM_D - margin * 2) };
    if (side === 2) return { x: (Math.random() - 0.5) * (ROOM_W - margin * 2), z: -HALF_D + margin };
    return             { x: (Math.random() - 0.5) * (ROOM_W - margin * 2), z:  HALF_D - margin };
  }

  /* =========================================================================
   * AABB 衝突チェック（ルンバ vs 家具）
   * 次のフレーム位置 (nx, nz) に Roomba が移動した場合に衝突するか判定
   * ========================================================================= */
  function collidesWithFurniture(nx, nz) {
    var r = ROOMBA_RADIUS;
    for (var i = 0; i < FURNITURE_BOXES.length; i++) {
      var fb = FURNITURE_BOXES[i];
      var cx = fb[0], cz = fb[1], hw = fb[2] + r, hd = fb[3] + r;
      if (nx > cx - hw && nx < cx + hw && nz > cz - hd && nz < cz + hd) {
        return true;
      }
    }
    return false;
  }

  /* =========================================================================
   * 安全なリスポーン位置を探す
   * ルンバから離れた場所を返す
   * ========================================================================= */
  function findSafePos() {
    var candidates = [
      { x: 0, z: 0 },
      { x: 6, z: -5 },
      { x: -3, z: 5 },
      { x: 7, z: 4 },
      { x: -2, z: -6 },
      { x: 3, z: -6 },
    ];

    for (var c = 0; c < candidates.length; c++) {
      var cx = candidates[c].x;
      var cz = candidates[c].z;
      var safe = true;
      for (var i = 0; i < roombas.length; i++) {
        if (!roombas[i].active) continue;
        var dx = cx - roombas[i].x;
        var dz = cz - roombas[i].z;
        if (Math.sqrt(dx * dx + dz * dz) < 3.0) {
          safe = false;
          break;
        }
      }
      if (safe) return { x: cx, z: cz };
    }
    // どこも安全でなければ原点
    return { x: 0, z: 0 };
  }

  /* =========================================================================
   * ルンバをアクティブ化
   * ========================================================================= */
  function activateRoomba(idx, type, x, z, angle) {
    var rb = roombas[idx];
    rb.type = type;
    rb.x = x;
    rb.z = z;
    rb.angle = angle;
    rb.speed = (type === 'bouncer') ? BOUNCER_SPEED : CHASER_SPEED_BASE + chaserSpeedBoost;
    rb.active = true;
    rb.warn = false;
    // タイプの見た目を同期（プール再利用でタイプが変わるため）
    var isChaser = (type === 'chaser');
    rb.bodyMesh.material.color.setHex(isChaser ? 0xcc4444 : 0x888888);
    rb.indicatorMesh.visible = isChaser;
    rb.eyesMesh.visible = isChaser;
    rb.beamMesh.visible = isChaser;
    rb.glowMesh.visible = false;
    rb.mesh.position.set(x, 0, z);
    rb.mesh.visible = true;
  }

  /* =========================================================================
   * 最初の非アクティブルンバのインデックスを返す
   * ========================================================================= */
  function findInactiveRoomba() {
    for (var i = 0; i < roombas.length; i++) {
      if (!roombas[i].active) return i;
    }
    return -1; // プールが満杯
  }

  /* =========================================================================
   * Shell.registerGame
   * ========================================================================= */
  Shell.registerGame({
    id: 'TMRoombaOni',
    title: { en: 'Roomba Tag', ja: 'そうじきオニごっこ', es: 'Escóndete del Roomba', 'pt-BR': 'Foge do Roomba', fr: 'Fuyez le Roomba', de: 'Roomba-Fangen', it: 'Fuga dal Roomba', ko: '로봇청소기 오니놀이', 'zh-Hans': '逃离扫地机器人', tr: 'Roomba\'dan Kaç' },
    howto: { en: 'Drag to move the kid!\nEscape the robot vacuums!', ja: 'ドラッグで子どもをうごかして\nロボそうじきからにげろ！', es: '¡Arrastra al niño!\n¡Escapa de las aspiradoras!', 'pt-BR': 'Arraste a criança!\nFuja dos robôs aspiradores!', fr: 'Glissez pour bouger l\'enfant !\nFuyez les aspirateurs robots !', de: 'Ziehe das Kind!\nFliehe vor den Roboter-Saugern!', it: 'Trascina il bambino!\nScappa dagli aspirapolvere robot!', ko: '드래그로 아이를 움직여!\n로봇청소기에서 도망쳐!', 'zh-Hans': '拖动孩子移动！\n逃离机器人吸尘器！', tr: 'Çocuğu sürükle!\nRobot süpürgelerden kaç!' },
    scoreLabel: { en: 'sec', ja: 'びょう', es: 'seg', 'pt-BR': 'seg', fr: 'sec', de: 'Sek', it: 'sec', ko: '초', 'zh-Hans': '秒', tr: 'san' },
    bg: 0xf5f0e8,
    fogNear: 30, fogFar: 60,
    cameraFov: 60,
    cameraPos: [0, 16, 10],
    cameraLookAt: [0, 0, 0],
    allowContinue: true,

    /* -----------------------------------------------------------------------
     * init: シーン構築（scene.add はここだけ）
     * --------------------------------------------------------------------- */
    init: function (ctx) {
      var THREE = ctx.THREE;

      // 一時計算用Vector（new しておく）
      _tmpVec = new THREE.Vector3();

      // 部屋
      makeRoom(THREE, ctx.scene);

      // 家具
      makeFurniture(THREE, ctx.scene);

      // プレイヤー（うさぎ: scale=0.75、全長≈1.5）
      // 床と同化しないよう濃い茶色ボディに（視認性UP）
      var _bunny = GameBunny.make(THREE, { scale: 0.75, color: 0x8a5a2a });
      playerMesh = _bunny.group;
      playerMesh._bunny = _bunny; // アニメ用
      ctx.scene.add(playerMesh);

      // 足元の常時リングマーカー（脈動・プレイヤー位置を一目で示す）
      playerRing = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.74, 24),
        new THREE.MeshBasicMaterial({ color: 0x2fd455, transparent: true, opacity: 0.85, side: 2, depthWrite: false })
      );
      playerRing.rotation.x = -Math.PI / 2;
      playerRing.position.y = 0.04;
      ctx.scene.add(playerRing);

      // ルンバプール（POOL_SIZE 体を事前確保、全部 invisible）
      roombas = [];
      for (var i = 0; i < POOL_SIZE; i++) {
        var type = (i % 2 === 0) ? 'bouncer' : 'chaser';
        var rb = makeRoomba(THREE, type);
        ctx.scene.add(rb.group);
        roombas.push({
          mesh: rb.group,
          brushMesh: rb.brush,
          bodyMesh: rb.body,
          indicatorMesh: rb.indicator,
          eyesMesh: rb.eyes,
          beamMesh: rb.beam,
          glowMesh: rb.glow,
          type: type,
          active: false,
          warn: false,
          x: 0,
          z: 0,
          angle: 0,
          speed: BOUNCER_SPEED,
        });
        rb.group.visible = false;
      }

      // ライト
      var ambient = new THREE.AmbientLight(0xffffff, 0.6);
      ctx.scene.add(ambient);
      var dirLight = new THREE.DirectionalLight(0xffe8cc, 0.9);
      dirLight.position.set(5, 12, 8);
      ctx.scene.add(dirLight);
    },

    /* -----------------------------------------------------------------------
     * start: ゲーム開始／リスタート時の状態初期化
     * --------------------------------------------------------------------- */
    start: function (ctx) {
      // プレイヤー位置リセット
      playerX = 0;
      playerZ = 0;
      targetX = 0;
      targetZ = 0;
      pointerActive = false;
      playerMesh.position.set(0, 0, 0);

      // 家具乗りっぱなしタイマーをリセット
      resetFurnitureShake(furnIdx);
      furnIdx = -1;
      furnTimer = 0;
      furnWarned = false;

      // 全ルンバを非表示に
      for (var i = 0; i < roombas.length; i++) {
        roombas[i].active = false;
        roombas[i].mesh.visible = false;
      }

      // タイマー・速度リセット
      chaserSpeedBoost = 0;
      nextSpawnTime = SPAWN_INTERVAL;

      // 初期ルンバ: 直進型1体＋学習型1体をスポーン
      var pos0 = randomEdgePos();
      activateRoomba(0, 'bouncer', pos0.x, pos0.z, Math.random() * Math.PI * 2);

      var pos1 = randomEdgePos();
      activateRoomba(1, 'chaser', pos1.x, pos1.z, Math.random() * Math.PI * 2);

      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Escape from the robot vacuums!', ja: 'ロボそうじきからにげろ！', es: '¡Escapa de las aspiradoras!', 'pt-BR': 'Fuja dos robôs aspiradores!', fr: 'Fuyez les aspirateurs robots !', de: 'Fliehe vor den Roboter-Saugern!', it: 'Scappa dagli aspirapolvere!', ko: '로봇청소기에서 도망쳐!', 'zh-Hans': '逃离机器人吸尘器！', tr: 'Robot süpürgelerden kaç!' }));
    },

    /* -----------------------------------------------------------------------
     * onContinue: コンティニュー時（ルンバ状態はそのまま、プレイヤーだけ復活）
     * --------------------------------------------------------------------- */
    onContinue: function (ctx) {
      var safe = findSafePos();
      playerX = safe.x;
      playerZ = safe.z;
      targetX = safe.x;
      targetZ = safe.z;
      pointerActive = false;
      playerMesh.position.set(playerX, 0, playerZ);
      resetFurnitureShake(furnIdx);
      furnIdx = -1;
      furnTimer = 0;
      furnWarned = false;
      ctx.setHint(ctx.t({ en: 'Run again!', ja: 'またにげろ！', es: '¡Corre otra vez!', 'pt-BR': 'Corra de novo!', fr: 'Fuyez encore !', de: 'Wieder flüchten!', it: 'Scappa di nuovo!', ko: '다시 도망쳐!', 'zh-Hans': '再跑！', tr: 'Tekrar kaç!' }));
    },

    /* -----------------------------------------------------------------------
     * 操作: ポインター（ドラッグで子どもを移動）
     * p.nx, p.ny は [-1, 1] の正規化座標
     * --------------------------------------------------------------------- */
    onPointerDown: function (ctx, p) {
      pointerActive = true;
      targetX = p.nx * HALF_W;
      targetZ = -p.ny * HALF_D;
    },

    onPointerMove: function (ctx, p) {
      if (!pointerActive) return;
      targetX = p.nx * HALF_W;
      targetZ = -p.ny * HALF_D;
    },

    onPointerUp: function (ctx, p) {
      pointerActive = false;
    },

    /* -----------------------------------------------------------------------
     * update: メインループ（毎フレーム）
     * --------------------------------------------------------------------- */
    update: function (ctx, dt) {
      var elapsed = ctx.elapsed;
      var i;

      /* --- 学習型の速度を時間で徐々に上げる (10秒ごとに +0.1) --- */
      chaserSpeedBoost = Math.floor(elapsed / 10) * 0.1;

      /* --- プレイヤー移動 --- */
      var dx = targetX - playerX;
      var dz = targetZ - playerZ;
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.05) {
        var move = Math.min(dist, PLAYER_SPEED * dt);
        playerX += (dx / dist) * move;
        playerZ += (dz / dist) * move;
      }

      // 壁クランプ（部屋の端を超えない）
      var pw = HALF_W - PLAYER_RADIUS;
      var pd = HALF_D - PLAYER_RADIUS;
      if (playerX < -pw) playerX = -pw;
      if (playerX >  pw) playerX =  pw;
      if (playerZ < -pd) playerZ = -pd;
      if (playerZ >  pd) playerZ =  pd;

      /* --- 家具乗りっぱなし対策 ---
       * 家具の上は約2.5秒でガタガタ警告、4秒で床へ強制滑り落とし。
       * 家具から降りるとタイマーはリセットされる。 */
      var onFurn = playerFurnitureIndex(playerX, playerZ);
      if (onFurn !== furnIdx) {
        // 乗り替わり/乗降 → 揺れを戻してタイマーリセット
        resetFurnitureShake(furnIdx);
        furnIdx = onFurn;
        furnTimer = 0;
        furnWarned = false;
      }

      var playerY = 0;
      if (furnIdx >= 0) {
        furnTimer += dt;
        playerY = FURN_TOPS[furnIdx];

        if (furnTimer >= FURN_EJECT_T) {
          // 強制滑り落とし: いちばん近い辺の外側へ押し出す
          var fb = FURNITURE_BOXES[furnIdx];
          var exL = playerX - (fb[0] - fb[2]);
          var exR = (fb[0] + fb[2]) - playerX;
          var exB = playerZ - (fb[1] - fb[3]);
          var exF = (fb[1] + fb[3]) - playerZ;
          var pad = PLAYER_RADIUS + 0.4;
          var minEx = Math.min(exL, exR, exB, exF);
          if (minEx === exL)      playerX = fb[0] - fb[2] - pad;
          else if (minEx === exR) playerX = fb[0] + fb[2] + pad;
          else if (minEx === exB) playerZ = fb[1] - fb[3] - pad;
          else                    playerZ = fb[1] + fb[3] + pad;
          // 部屋の中に収める
          if (playerX < -pw) playerX = -pw;
          if (playerX >  pw) playerX =  pw;
          if (playerZ < -pd) playerZ = -pd;
          if (playerZ >  pd) playerZ =  pd;
          targetX = playerX;
          targetZ = playerZ;
          resetFurnitureShake(furnIdx);
          furnIdx = -1;
          furnTimer = 0;
          furnWarned = false;
          playerY = 0;
          ctx.sfx.bounce();
          ctx.vibrate(50);
        } else if (furnTimer >= FURN_SHAKE_T) {
          // 警告: 家具がガタガタ揺れ、プレイヤーも小刻みに跳ねる
          if (!furnWarned) {
            furnWarned = true;
            ctx.sfx.bounce();
            ctx.vibrate(30);
          }
          var g = furnitureGroups[furnIdx];
          g.position.x = furnBasePos[furnIdx].x + Math.sin(elapsed * 38) * 0.06;
          g.position.z = furnBasePos[furnIdx].z + Math.cos(elapsed * 31) * 0.05;
          g.rotation.z = Math.sin(elapsed * 27) * 0.03;
          playerY += Math.abs(Math.sin(elapsed * 24)) * 0.08;
        }
      }

      // 歩きアニメ（うさぎ）
      var walking = dist > 0.1;
      playerMesh.position.set(playerX, playerY, playerZ);
      if (walking) {
        playerMesh.rotation.y = Math.atan2(dx, dz);
        if (playerMesh._bunny) {
          var wt = elapsed * 8;
          playerMesh._bunny.legL.rotation.x =  Math.sin(wt) * 0.5;
          playerMesh._bunny.legR.rotation.x = -Math.sin(wt) * 0.5;
          playerMesh._bunny.flop(elapsed);
        }
      }

      // 足元リングマーカー追従（脈動）
      playerRing.position.set(playerX, playerY + 0.04, playerZ);
      playerRing.material.opacity = 0.6 + Math.sin(elapsed * 5) * 0.25;

      /* --- スポーン: 15秒ごとに1体追加 --- */
      if (elapsed >= nextSpawnTime) {
        var idx = findInactiveRoomba();
        if (idx >= 0) {
          // 偶数スポーンは直進型、奇数は学習型
          var spawnType = (Math.floor(elapsed / SPAWN_INTERVAL) % 2 === 0) ? 'chaser' : 'bouncer';
          var sp = randomEdgePos();
          activateRoomba(idx, spawnType, sp.x, sp.z, Math.random() * Math.PI * 2);
        }
        nextSpawnTime += SPAWN_INTERVAL;
      }

      /* --- ルンバ更新 --- */
      for (i = 0; i < roombas.length; i++) {
        var rb = roombas[i];
        if (!rb.active) continue;

        // ブラシ回転
        rb.brushMesh.rotation.y += dt * 8;

        var nx, nz;

        if (rb.type === 'bouncer') {
          /* --- 直進型: 直線移動 + 壁/家具で反射 --- */
          rb.speed = BOUNCER_SPEED; // 直進型は速度固定
          nx = rb.x + Math.sin(rb.angle) * rb.speed * dt;
          nz = rb.z + Math.cos(rb.angle) * rb.speed * dt;

          // 壁反射
          var rw = HALF_W - ROOMBA_RADIUS;
          var rd = HALF_D - ROOMBA_RADIUS;
          var bounced = false;
          if (nx < -rw || nx > rw) {
            rb.angle = Math.PI - rb.angle;
            bounced = true;
          }
          if (nz < -rd || nz > rd) {
            rb.angle = -rb.angle;
            bounced = true;
          }
          if (bounced) {
            nx = rb.x + Math.sin(rb.angle) * rb.speed * dt;
            nz = rb.z + Math.cos(rb.angle) * rb.speed * dt;
          }

          // 家具衝突で反射
          if (collidesWithFurniture(nx, nz)) {
            // X方向のみ試す
            if (!collidesWithFurniture(rb.x, nz)) {
              rb.angle = Math.PI - rb.angle;
              nx = rb.x;
            } else if (!collidesWithFurniture(nx, rb.z)) {
              // Z方向のみ試す
              rb.angle = -rb.angle;
              nz = rb.z;
            } else {
              // 完全にブロック → 180度回転
              rb.angle += Math.PI;
              nx = rb.x;
              nz = rb.z;
            }
          }

          rb.x = nx;
          rb.z = nz;

        } else {
          /* --- 学習型: プレイヤーへ徐々に向かう --- */
          rb.speed = CHASER_SPEED_BASE + chaserSpeedBoost;

          // 目標方向を計算
          var tdx = playerX - rb.x;
          var tdz = playerZ - rb.z;
          var tAngle = Math.atan2(tdx, tdz);

          // 現在角度から目標角度へ最大 CHASER_TURN_SPEED * dt だけ回転
          var angleDiff = tAngle - rb.angle;
          // 角度を -PI〜PI に正規化
          while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

          var maxTurn = CHASER_TURN_SPEED * dt;
          if (Math.abs(angleDiff) <= maxTurn) {
            rb.angle = tAngle;
          } else {
            rb.angle += Math.sign(angleDiff) * maxTurn;
          }

          nx = rb.x + Math.sin(rb.angle) * rb.speed * dt;
          nz = rb.z + Math.cos(rb.angle) * rb.speed * dt;

          // 壁クランプ
          var cw = HALF_W - ROOMBA_RADIUS;
          var cd = HALF_D - ROOMBA_RADIUS;
          if (nx < -cw) { nx = -cw; rb.angle = Math.PI - rb.angle; }
          if (nx >  cw) { nx =  cw; rb.angle = Math.PI - rb.angle; }
          if (nz < -cd) { nz = -cd; rb.angle = -rb.angle; }
          if (nz >  cd) { nz =  cd; rb.angle = -rb.angle; }

          // 家具衝突: ずらして回避
          if (collidesWithFurniture(nx, nz)) {
            if (!collidesWithFurniture(rb.x, nz)) {
              nx = rb.x;
              rb.angle = Math.PI - rb.angle + (Math.random() - 0.5) * 0.5;
            } else if (!collidesWithFurniture(nx, rb.z)) {
              nz = rb.z;
              rb.angle = -rb.angle + (Math.random() - 0.5) * 0.5;
            } else {
              nx = rb.x;
              nz = rb.z;
              rb.angle += Math.PI * 0.5 + (Math.random() - 0.5) * 0.5;
            }
          }

          rb.x = nx;
          rb.z = nz;
        }

        // メッシュ位置更新
        rb.mesh.position.set(rb.x, 0, rb.z);
        rb.mesh.rotation.y = rb.angle;

        // 追跡型の扇ビームを脈動（「狙っている」感）
        if (rb.type === 'chaser') {
          rb.beamMesh.material.opacity = 0.22 + Math.sin(elapsed * 6) * 0.1;
        }

        /* --- 衝突判定: プレイヤー vs ルンバ --- */
        var cdx = playerX - rb.x;
        var cdz = playerZ - rb.z;
        var cdist = Math.sqrt(cdx * cdx + cdz * cdz);
        if (cdist < HIT_DIST) {
          ctx.vibrate(80);
          ctx.sfx.fail();
          ctx.gameOver(Math.floor(elapsed));
          return; // update を即終了
        }

        /* --- 危険予告: HIT_DIST の 1.5 倍圏内で発光＋振動 --- */
        if (cdist < HIT_DIST * 1.5) {
          rb.glowMesh.visible = true;
          rb.glowMesh.material.opacity = 0.45 + Math.sin(elapsed * 16) * 0.35;
          if (!rb.warn) {
            rb.warn = true;
            ctx.vibrate(20);
          }
        } else {
          rb.glowMesh.visible = false;
          rb.warn = false;
        }
      }

      /* --- スコア更新（生存秒数）--- */
      ctx.setScore(Math.floor(elapsed));
    }
  });
})();
