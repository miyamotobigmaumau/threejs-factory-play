/* =========================================================================
 * TMNinjaDaruma — にんじゃ姫きゅうしゅつ
 * ルール: 塔のてっぺんに囚われた「姫」。下の段を手裏剣で撃ち抜いて塔を
 *   低くし、姫が地上（カートの上）まで降りたら救出＝ステージクリア。
 *   姫に手裏剣を当てたらゲームオーバー（照準ラインが姫の高さで赤色化）。
 *   ステージが上がると邪魔が段階導入される:
 *     Stage2+ … 提灯が軌道を横切る（当たると手裏剣落下）
 *     Stage3+ … カラスも横切る
 *     Stage4+ … 風で手裏剣が上下に曲がる（葉パーティクルで可視化）
 *     Stage6+ … 塔が左右にゆっくりスライド
 * 操作: スワイプの高さで狙い、指を離すと発射。
 * スコア: 撃ち抜いた段の累計。手裏剣は 1 段撃破ごとに +1（最大 7）。
 * ========================================================================= */
(function () {
  'use strict';

  /* ==========================================================================
   * 定数
   * ========================================================================== */
  var POOL_SIZE      = 10;    // 胴体ティアの最大プール数
  var TIER_W         = 1.6;   // タワー段の幅
  var TIER_H         = 1.0;   // タワー段の高さ
  var TIER_SPACING   = 1.15;  // 段同士の中心間隔
  var CART_W         = 2.4;   // カートの幅
  var CART_H         = 0.28;  // カートの高さ
  var CART_Y         = 0.14;  // カートの中心Y
  var FLOOR_Y        = 0.0;   // 床Y
  var SHURIKEN_SPEED = 27;    // しゅりけんZ速度（手前→奥）
  var SHURIKEN_R     = 0.38;  // しゅりけんのおよその半径（当たり判定）
  var SHURIKEN_Z0    = 9.0;   // 発射Z（手前）
  var SHURIKEN_Y0    = 1.2;   // 発射Y（にんじゃの手元の高さ）
  var CART_RANGE     = 2.2;   // Stage6+ で塔がスライドする範囲
  var MAX_SHURIKENS  = 7;     // しゅりけん最大数
  var INIT_TIERS     = 4;     // Stage1 の段数（ステージごとに +1、最大 8）
  var MAX_TIERS      = 8;     // 段数上限
  var TIME_LIMIT     = 90;    // 制限時間（秒）

  var PRIN_CY        = 0.6;   // 姫あたり判定帯の中心（姫の足元からのオフセット）
  var PRIN_BAND      = 0.75;  // 姫あたり判定帯の半高
  var FLY_DUR        = 0.55;  // 撃ち抜いた段の吹き飛び時間
  var FALL_DUR       = 0.15;  // 上の段の落下時間
  var RESCUE_DUR     = 1.5;   // 救出演出の時間
  var OB_Z           = 4.5;   // 邪魔キャラが横切る奥行き
  var HEART_POOL     = 8;     // ハートパーティクル数（プール）
  var LEAF_POOL      = 12;    // 葉パーティクル数（プール）

  /* ==========================================================================
   * 状態変数（start で毎回リセット）
   * ========================================================================== */
  var stage;           // 現在ステージ（1〜）
  var numTiers;        // 現在の胴体段数
  var cartX;           // カート（塔）の現在X座標
  var cartDir;         // スライド方向 (+1/-1)
  var shurikens;       // 残しゅりけん数
  var shurikenFlying;  // 飛行中フラグ
  var shurikenFalling; // 邪魔に当たって落下中フラグ
  var shurikenVy;      // 落下中のY速度
  var shurikenX;       // しゅりけん現在X
  var shurikenY;       // しゅりけん現在Y（z進行度で aimY+windOff へ収束）
  var shurikenZ;       // しゅりけん奥行き（手前z大→奥z=0へ飛ぶ）
  var shuStartX;       // 発射時X（軌道補間の起点）
  var swipeStartNY;    // スワイプ開始 p.ny
  var aimY;            // 狙い高さ（世界座標Y）
  var aimVisible;      // 照準線表示フラグ
  var totalKnocked;    // 累計撃ち抜き数（スコア）
  var aimDanger = false; // 照準が姫の高さ帯に入っているか（黄→赤の警告状態）

  /* 風（Stage4+） */
  var windOn;          // 風ありフラグ
  var windX, windY;    // 風ベクトル（windY がゲームプレイに影響、windX は葉の流れ）
  var windTimer;       // 次の風変化までの秒
  var windOff;         // 飛行中に累積する狙いズレ

  /* 救出演出 */
  var rescuing;        // 救出演出中フラグ
  var rescueT;         // 救出経過秒
  var heartAcc;        // ハート発生アキュムレータ

  /* 撃ち抜いた段の吹き飛びアニメ（1発ずつなので単一スロット） */
  var flyTierIdx = -1;   // 吹き飛び中の tierPool インデックス（-1=なし）
  var flyTierT = 0;      // 吹き飛び経過秒

  /* 姫の落下アニメ */
  var prinFallFrom = 0;        // 落下開始Y（カートローカル）
  var prinFallT = FALL_DUR;    // 落下経過秒（FALL_DUR 以上で完了）
  var prinTargetY = 0;         // 落下先Y（カートローカル、姫の足元）

  /* タワー状態プール（init で一度だけ生成） */
  var tierState = [];  // [{alive, y, fallFrom, fallT}] × POOL_SIZE

  /* ==========================================================================
   * Three.js オブジェクト（init で一度だけ生成）
   * ========================================================================== */
  var cartMesh;
  var cartWheels = [];   // 車輪メッシュ x4
  var tierPool = [];     // 長さ POOL_SIZE

  // 姫（グループ＝カートの子。origin は姫の足元）
  var princessGrp;
  var prinHeadMesh;
  var prinFaceNormal;    // 通常顔テクスチャ
  var prinFaceWorried;   // 心配顔テクスチャ（照準が姫の帯に入った警告）
  var waveArm;           // 手を振る腕（グループ）

  // しゅりけん・照準・背景
  var shurikenMesh;
  var aimLine;
  var moonMesh;
  var floorMesh;
  var bgBuildings = [];
  var starsMesh;

  // 邪魔キャラ（Stage2+ 提灯 / Stage3+ カラス）
  var obstacles = [];    // [{grp, active, x, y, dir, speed, r, phase, wings}]

  // パーティクルプール
  var hearts = [];       // [{mesh, alive, t, x, y, vx, vy}] × HEART_POOL
  var leaves = [];       // [{mesh, x, y, z, phase, spin}] × LEAF_POOL

  // DOM
  var uiShuriken;        // しゅりけん残数（✦アイコン）
  var uiStage;           // ステージ表示（⛩ + 数字）

  /* ==========================================================================
   * ヘルパー: テクスチャ（Canvas2D → CanvasTexture）
   * ========================================================================== */
  function makeTierTexture(THREE, color) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    var c = cv.getContext('2d');
    c.fillStyle = '#' + color.toString(16).padStart(6, '0');
    c.fillRect(0, 0, 64, 64);
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, 32); c.lineTo(64, 32); c.stroke();
    c.beginPath(); c.moveTo(32, 0); c.lineTo(32, 64); c.stroke();
    return new THREE.CanvasTexture(cv);
  }

  // 姫の顔（球にラップ。中心＝正面）。worried=true で心配顔。
  function makePrincessFace(THREE, worried) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var c = cv.getContext('2d');
    // 肌
    c.fillStyle = '#ffe3cf';
    c.fillRect(0, 0, 128, 128);
    // 目
    c.fillStyle = '#332222';
    if (worried) {
      // 心配してまん丸目
      c.beginPath(); c.arc(46, 58, 7, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(82, 58, 7, 0, Math.PI * 2); c.fill();
    } else {
      // にっこりアーチ目
      c.lineWidth = 4; c.strokeStyle = '#332222';
      c.beginPath(); c.arc(46, 60, 8, Math.PI + 0.3, Math.PI * 2 - 0.3); c.stroke();
      c.beginPath(); c.arc(82, 60, 8, Math.PI + 0.3, Math.PI * 2 - 0.3); c.stroke();
    }
    // 眉
    c.strokeStyle = '#553333';
    c.lineWidth = 3;
    if (worried) {
      c.beginPath(); c.moveTo(38, 44); c.lineTo(54, 48); c.stroke();
      c.beginPath(); c.moveTo(90, 44); c.lineTo(74, 48); c.stroke();
    } else {
      c.beginPath(); c.moveTo(38, 46); c.lineTo(54, 45); c.stroke();
      c.beginPath(); c.moveTo(90, 46); c.lineTo(74, 45); c.stroke();
    }
    // ほっぺ
    c.fillStyle = 'rgba(255,140,160,0.55)';
    c.beginPath(); c.arc(34, 76, 8, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(94, 76, 8, 0, Math.PI * 2); c.fill();
    // 口
    c.strokeStyle = '#aa4455';
    c.lineWidth = 3;
    if (worried) {
      c.beginPath(); c.arc(64, 84, 6, 0, Math.PI * 2); c.stroke();
    } else {
      c.beginPath(); c.arc(64, 78, 9, 0.3, Math.PI - 0.3); c.stroke();
    }
    return new THREE.CanvasTexture(cv);
  }

  function makeShurikenTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    var c = cv.getContext('2d');
    c.fillStyle = '#c8c8c8';
    c.strokeStyle = '#666';
    c.lineWidth = 1;
    var cx = 32, cy = 32, r = 28;
    for (var i = 0; i < 4; i++) {
      var a = (i * Math.PI / 2);
      c.save();
      c.translate(cx, cy);
      c.rotate(a);
      c.beginPath();
      c.moveTo(0, -6);
      c.lineTo(r, 0);
      c.lineTo(0, 6);
      c.closePath();
      c.fill(); c.stroke();
      c.restore();
    }
    c.fillStyle = '#888';
    c.beginPath(); c.arc(cx, cy, 5, 0, Math.PI * 2); c.fill();
    return new THREE.CanvasTexture(cv);
  }

  function makeHeartTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    var c = cv.getContext('2d');
    c.fillStyle = '#ff5f8f';
    c.beginPath();
    c.moveTo(32, 56);
    c.bezierCurveTo(4, 36, 8, 8, 32, 22);
    c.bezierCurveTo(56, 8, 60, 36, 32, 56);
    c.fill();
    return new THREE.CanvasTexture(cv);
  }

  function makeLeafTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    var c = cv.getContext('2d');
    c.fillStyle = '#8ecf5a';
    c.beginPath();
    c.ellipse(32, 32, 26, 12, 0.6, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#5a9634';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(12, 46); c.lineTo(52, 18); c.stroke();
    return new THREE.CanvasTexture(cv);
  }

  /* ==========================================================================
   * ヘルパー: しゅりけんジオメトリ（BufferGeometry、4点星）
   * ========================================================================== */
  function makeShurikenGeometry(THREE) {
    var ro = 0.38; // 外半径
    var ri = 0.10; // 内半径
    var verts = [];
    var idxs  = [];
    verts.push(0, 0, 0); // 0 中心
    for (var i = 0; i < 4; i++) {
      var ao = (i * Math.PI / 2) - Math.PI / 4;
      var am = ao + Math.PI / 4;
      verts.push(
        Math.cos(ao) * ro, Math.sin(ao) * ro, 0,  // 外頂点
        Math.cos(am) * ri, Math.sin(am) * ri, 0   // 内頂点(中間)
      );
    }
    for (var j = 0; j < 4; j++) {
      var outer = 1 + j * 2;
      var innerPrev = (j === 0) ? 8 : (j * 2);
      var innerNext = 2 + j * 2;
      idxs.push(0, innerPrev, outer);
      idxs.push(0, outer, innerNext);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idxs);
    geo.computeVertexNormals();
    return geo;
  }

  function makeAimLineGeometry(THREE) {
    var pts = new Float32Array([-10, 0, 0, 10, 0, 0]);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }

  function makeStarsGeometry(THREE) {
    var count = 120;
    var pts = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      pts[i * 3]     = (Math.random() - 0.5) * 30;
      pts[i * 3 + 1] = Math.random() * 18 + 2;
      pts[i * 3 + 2] = -8 - Math.random() * 6;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }

  var TIER_COLORS = [
    0x4a9e6b, 0x6b8fd4, 0xd4a84b, 0x9b6bd4, 0x4bb8d4,
    0xd46b6b, 0x8bd44b, 0xd4884b, 0x4b6bd4, 0xd4c84b
  ];

  /* ==========================================================================
   * ヘルパー: 姫キャラ生成（ピンクの着物＋髪飾り。origin=足元）
   * ========================================================================== */
  function buildPrincess(THREE) {
    princessGrp = new THREE.Group();

    // 着物（すそ広がりの円錐台・ピンク）
    var kimono = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.44, 0.66, 12),
      Style.mat(0xff9fc0)
    );
    kimono.position.y = 0.33;
    princessGrp.add(kimono);

    // 帯
    var obi = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.26, 0.12, 12),
      Style.mat(0xd84a6f)
    );
    obi.position.y = 0.52;
    princessGrp.add(obi);

    // 頭（顔テクスチャ）
    prinFaceNormal = makePrincessFace(THREE, false);
    prinFaceWorried = makePrincessFace(THREE, true);
    prinHeadMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 16, 12),
      new THREE.MeshLambertMaterial({ map: prinFaceNormal })
    );
    prinHeadMesh.position.y = 0.88;
    princessGrp.add(prinHeadMesh);

    // 髪（後頭部）＋おだんご
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.29, 12, 10),
      Style.mat(0x2a1a22)
    );
    hair.position.set(0, 0.95, -0.09);
    princessGrp.add(hair);
    var bun = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      Style.mat(0x2a1a22)
    );
    bun.position.set(0, 1.2, -0.04);
    princessGrp.add(bun);

    // 髪飾り（かんざし: 棒＋花）
    var stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.34, 6),
      Style.mat(0xe8c46a)
    );
    stick.rotation.z = Math.PI / 3;
    stick.position.set(0.16, 1.24, -0.04);
    princessGrp.add(stick);
    var flower = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      Style.mat(0xff6f9f, { emissive: 0x441122 })
    );
    flower.position.set(0.3, 1.32, -0.04);
    princessGrp.add(flower);

    // 左腕（そで・固定）
    var armL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, 0.34, 8),
      Style.mat(0xff9fc0)
    );
    armL.rotation.z = 0.6;
    armL.position.set(-0.26, 0.5, 0);
    princessGrp.add(armL);

    // 右腕（手を振る・グループごと回す）
    waveArm = new THREE.Group();
    waveArm.position.set(0.22, 0.6, 0); // 肩の位置
    var armR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, 0.34, 8),
      Style.mat(0xff9fc0)
    );
    armR.position.y = 0.17; // 肩から上へ伸ばす
    waveArm.add(armR);
    var handR = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      Style.mat(0xffe3cf)
    );
    handR.position.y = 0.36;
    waveArm.add(handR);
    waveArm.rotation.z = -2.2;
    princessGrp.add(waveArm);

    cartMesh.add(princessGrp);
  }

  /* ==========================================================================
   * ヘルパー: 邪魔キャラ生成（提灯・カラス）
   * ========================================================================== */
  function buildObstacles(THREE, scene) {
    // --- 提灯（あたたかい光の円筒） ---
    var lanGrp = new THREE.Group();
    var lanBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.52, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb060 })
    );
    lanGrp.add(lanBody);
    var lanCapT = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.1, 8),
      Style.mat(0x442222)
    );
    lanCapT.position.y = 0.31;
    lanGrp.add(lanCapT);
    var lanCapB = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.16, 0.1, 8),
      Style.mat(0x442222)
    );
    lanCapB.position.y = -0.31;
    lanGrp.add(lanCapB);
    lanGrp.visible = false;
    scene.add(lanGrp);
    obstacles.push({
      grp: lanGrp, active: false, x: -6.5, y: 3, dir: 1,
      speed: 1.8, r: 0.55, phase: 0, wings: null
    });

    // --- カラス（黒い胴＋はばたく羽） ---
    var crowGrp = new THREE.Group();
    var crowBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      Style.mat(0x23233a)
    );
    crowBody.scale.set(1.3, 1, 1);
    crowGrp.add(crowBody);
    var beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.2, 6),
      Style.mat(0xe8a030)
    );
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.33, 0.03, 0);
    crowGrp.add(beak);
    var wingGeo = new THREE.PlaneGeometry(0.24, 0.5);
    var wingMat = Style.mat(0x2c2c46, { side: THREE.DoubleSide });
    var wingL = new THREE.Mesh(wingGeo, wingMat);
    wingL.position.set(0, 0.1, 0.24);
    var wingR = new THREE.Mesh(wingGeo, wingMat);
    wingR.position.set(0, 0.1, -0.24);
    crowGrp.add(wingL); crowGrp.add(wingR);
    crowGrp.visible = false;
    scene.add(crowGrp);
    obstacles.push({
      grp: crowGrp, active: false, x: 6.5, y: 4.5, dir: -1,
      speed: 2.8, r: 0.45, phase: 2.1, wings: [wingL, wingR]
    });
  }

  /* ==========================================================================
   * ヘルパー: UI（しゅりけん残数・ステージ）
   * ========================================================================== */
  function updateUI() {
    if (!uiShuriken) return;
    // ノンバーバル: ✦=残弾 / ✧=消費済み のアイコン表示のみ
    var s = '';
    for (var i = 0; i < MAX_SHURIKENS; i++) {
      s += (i < shurikens) ? '✦ ' : '✧ ';
    }
    uiShuriken.textContent = s.trim();
  }

  function updateStageUI() {
    if (uiStage) uiStage.textContent = '⛩ ' + stage;
  }

  // カスタムHUD（✦残数・⛩ステージ）の表示切替。プレイ中のみ表示し、
  // タイトル/リザルト画面への残留を防ぐ。
  function showHud(on) {
    var d = on ? '' : 'none';
    if (uiShuriken) uiShuriken.style.display = d;
    if (uiStage) uiStage.style.display = d;
  }

  /* ==========================================================================
   * ヘルパー: タワー再構築（alive な段だけ下から詰めて Y を再設定）
   *   animate=true なら FALL_DUR 秒かけて落下させる
   * ========================================================================== */
  function rebuildTower(animate) {
    var localBase = CART_H / 2 + TIER_H / 2;
    var yPos = localBase;
    var aliveCount = 0;
    for (var i = 0; i < numTiers; i++) {
      var ts = tierState[i];
      if (!ts.alive) continue;
      ts.y = yPos;
      if (animate && Math.abs(tierPool[i].position.y - yPos) > 1e-4) {
        ts.fallFrom = tierPool[i].position.y;
        ts.fallT = 0;
      } else {
        ts.fallT = FALL_DUR;
        tierPool[i].position.y = yPos;
      }
      yPos += TIER_SPACING;
      aliveCount++;
    }
    // 姫の足元位置: 生きてる最上段の天面（全滅時はカートの天面＝地上）
    if (aliveCount > 0) {
      prinTargetY = yPos - TIER_SPACING + TIER_H / 2;
    } else {
      prinTargetY = CART_H / 2;
    }
    if (animate && Math.abs(princessGrp.position.y - prinTargetY) > 1e-4) {
      prinFallFrom = princessGrp.position.y;
      prinFallT = 0;
    } else {
      prinFallT = FALL_DUR;
      princessGrp.position.y = prinTargetY;
    }
    return aliveCount;
  }

  /* ==========================================================================
   * ヘルパー: 吹き飛びアニメ中の段を即時終了して transform を初期化
   * ========================================================================== */
  function resetFlyTier() {
    if (flyTierIdx < 0) return;
    var fm = tierPool[flyTierIdx];
    fm.visible = false;
    fm.position.z = 0;
    fm.rotation.set(0, 0, 0);
    fm.scale.setScalar(1);
    flyTierIdx = -1;
    flyTierT = 0;
  }

  /* ==========================================================================
   * ヘルパー: 照準の危険帯（姫の高さ）判定
   *   帯に入ったら照準ラインを黄→赤に、姫を心配顔に切替（状態変化時のみ）
   * ========================================================================== */
  function updateAimDanger() {
    var prinWY = CART_Y + prinTargetY + PRIN_CY;
    var danger = Math.abs(aimY - prinWY) < PRIN_BAND;
    if (danger === aimDanger) return;
    aimDanger = danger;
    aimLine.material.color.setHex(danger ? 0xff2222 : 0xffff00);
    aimLine.material.opacity = danger ? 0.85 : 0.5;
    prinHeadMesh.material.map = danger ? prinFaceWorried : prinFaceNormal;
    prinHeadMesh.material.needsUpdate = true;
  }

  /* ==========================================================================
   * ヘルパー: ハート発生（プールから空きを取る）
   * ========================================================================== */
  function spawnHeart(x, y) {
    for (var i = 0; i < HEART_POOL; i++) {
      var h = hearts[i];
      if (h.alive) continue;
      h.alive = true;
      h.t = 0;
      h.x = x; h.y = y;
      h.vx = (Math.random() - 0.5) * 1.4;
      h.vy = 1.6 + Math.random() * 0.9;
      h.mesh.visible = true;
      h.mesh.position.set(x, y, 1.2);
      h.mesh.scale.setScalar(0.5);
      h.mesh.material.opacity = 0.95;
      return;
    }
  }

  /* ==========================================================================
   * ヘルパー: 風を引き直す（Stage4+）
   * ========================================================================== */
  function pickWind() {
    windTimer = 3 + Math.random() * 2;
    var mag = 1.2 + 0.35 * Math.min(stage - 4, 6);
    windY = (Math.random() * 2 - 1) * mag;
    if (windY > -0.6 && windY < 0.6) windY = (windY < 0 ? -0.6 : 0.6);
    windX = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.4);
  }

  /* ==========================================================================
   * ヘルパー: ステージ設定（塔・邪魔・風・スライドを stage に合わせて構成）
   * ========================================================================== */
  function setupStage(ctx) {
    numTiers = Math.min(INIT_TIERS + (stage - 1), MAX_TIERS);

    resetFlyTier();
    for (var i = 0; i < numTiers; i++) {
      tierState[i].alive = true;
      tierState[i].y = 0;
      tierState[i].fallT = FALL_DUR;
      tierPool[i].visible = true;
      tierPool[i].position.set(0, 0, 0);
    }
    for (var j = numTiers; j < POOL_SIZE; j++) {
      tierState[j].alive = false;
      tierPool[j].visible = false;
    }
    rebuildTower();

    // 邪魔キャラ: Stage2+ 提灯 / Stage3+ カラス。速度はステージで微増。
    obstacles[0].active = (stage >= 2);
    obstacles[0].speed = Math.min(1.6 + stage * 0.15, 3.2);
    obstacles[1].active = (stage >= 3);
    obstacles[1].speed = Math.min(2.4 + stage * 0.2, 4.5);
    for (var k = 0; k < obstacles.length; k++) {
      var ob = obstacles[k];
      ob.grp.visible = ob.active;
      ob.x = (ob.dir > 0) ? -6.5 : 6.5;
      ob.y = 1.5 + Math.random() * 4.5;
    }

    // 風: Stage4+（windTimer=0 で即引き直し）
    windOn = (stage >= 4);
    windTimer = 0;
    windOff = 0;
    if (!windOn) { windX = 0; windY = 0; }
    for (var m = 0; m < LEAF_POOL; m++) leaves[m].mesh.visible = windOn;

    // 塔スライド: Stage6+
    if (stage < 6) {
      cartX = 0;
      cartMesh.position.x = 0;
    }

    updateStageUI();

    // 新ハザード導入をアイコンで予告（ノンバーバル）
    if (stage === 2) ctx.setHint('🏮 !');
    else if (stage === 3) ctx.setHint('🐦 !');
    else if (stage === 4) ctx.setHint('🍃 !');
    else if (stage === 6) ctx.setHint('⇄ !');
  }

  /* ==========================================================================
   * ヘルパー: しゅりけんロスト処理（外れ/落下しきった後の共通処理）
   * ========================================================================== */
  function loseShuriken(ctx) {
    if (shurikens <= 0) {
      showHud(false);
      ctx.sfx.fail();
      ctx.gameOver(ctx.score);
      return;
    }
    updateUI();
  }

  /* ==========================================================================
   * init — シーン構築（一度だけ）
   * ========================================================================== */
  Shell.registerGame({
    id: 'TMNinjaDaruma',
    title: { en: 'Ninja Rescue', ja: 'にんじゃ姫きゅうしゅつ', es: 'Rescate Ninja', 'pt-BR': 'Resgate Ninja', fr: 'Sauvetage Ninja', de: 'Ninja-Rettung', it: 'Salvataggio Ninja', ko: '닌자 공주 구출', 'zh-Hans': '忍者救公主', tr: 'Ninja Kurtarma' },
    howto: {
      en: 'Shoot the tiers to lower the tower\nand rescue the princess on top!\nDon\'t hit her!',
      ja: 'だんを撃ちぬいて塔を低くし\nてっぺんの姫をたすけだそう！\n姫に当てたらアウト！',
      es: '¡Dispara a los niveles para bajar la torre\ny rescatar a la princesa!\n¡No la golpees!',
      'pt-BR': 'Atire nos andares para baixar a torre\ne resgatar a princesa!\nNão acerte nela!',
      fr: 'Tirez sur les étages pour abaisser la tour\net sauver la princesse !\nNe la touchez pas !',
      de: 'Triff die Stufen, senke den Turm\nund rette die Prinzessin!\nTriff sie nicht!',
      it: 'Colpisci i livelli per abbassare la torre\ne salvare la principessa!\nNon colpirla!',
      ko: '단을 쏘아 탑을 낮추고\n꼭대기의 공주를 구출하자!\n공주를 맞히면 아웃!',
      'zh-Hans': '射穿塔层降低高塔\n救出顶上的公主！\n打中公主就输了！',
      tr: 'Katları vur, kuleyi alçalt\nve prensesi kurtar!\nOna vurma!'
    },
    scoreLabel: { en: 'tiers', ja: '段', es: 'niveles', 'pt-BR': 'andares', fr: 'niveaux', de: 'Stufen', it: 'livelli', ko: '단', 'zh-Hans': '层', tr: 'kat' },
    bg: 0x0a0a2e,
    cameraPos: [0, 5, 12],
    cameraLookAt: [0, 4, 0],
    cameraFov: 55,
    // 縦持ち実機対策: Stage6+ の塔スライド範囲（±CART_RANGE＋塔幅）が
    // 必ず画面内に収まるよう横幅を宣言（shell.js が FOV を自動調整）。
    fitWidth: 7,

    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;

      /* --- 床 --- */
      floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 10),
        Style.mat(0x1a1a3a)
      );
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(0, FLOOR_Y, 0);
      scene.add(floorMesh);

      /* --- 背景: 道場の壁（後ろ） --- */
      var wallMat = Style.mat(0x1e1e3e);
      var wallBack = new THREE.Mesh(new THREE.PlaneGeometry(20, 15), wallMat);
      wallBack.position.set(0, 7.5, -5);
      scene.add(wallBack);

      /* --- 背景建物 x4（夜の町屋: 灯りのついた窓＋瓦屋根） --- */
      var buildColors = [0x282850, 0x2e2e58, 0x2a2a52, 0x30305e];
      var winMat = new THREE.MeshBasicMaterial({ color: 0xffd980 });
      var winGeo = new THREE.PlaneGeometry(0.4, 0.5);
      var roofMat = Style.mat(0x1a1a38);
      for (var b = 0; b < 4; b++) {
        var bw = 2.5 + Math.random() * 1.5;
        var bh = 3 + Math.random() * 5;
        var bMesh = new THREE.Mesh(
          Style.roundedBox(bw, bh, 0.5),
          Style.mat(buildColors[b])
        );
        bMesh.position.set(-7 + b * 4.5, bh / 2, -4.5);
        scene.add(bMesh);
        bgBuildings.push(bMesh);
        var roof = new THREE.Mesh(new THREE.ConeGeometry(bw * 0.72, 0.7, 4), roofMat);
        roof.rotation.y = Math.PI / 4;
        roof.position.set(bMesh.position.x, bh + 0.32, -4.5);
        scene.add(roof);
        var cols = 2, rows = Math.max(1, Math.floor(bh / 1.6));
        for (var wr = 0; wr < rows; wr++) {
          for (var wc2 = 0; wc2 < cols; wc2++) {
            if (Math.random() < 0.35) continue;
            var win = new THREE.Mesh(winGeo, winMat);
            win.position.set(
              bMesh.position.x - bw / 4 + wc2 * (bw / 2),
              0.9 + wr * 1.5,
              -4.5 + 0.27);
            scene.add(win);
          }
        }
      }

      /* --- 月 --- */
      moonMesh = new THREE.Mesh(
        new THREE.CircleGeometry(1.2, 32),
        new THREE.MeshBasicMaterial({ color: 0xfff8d0 })
      );
      moonMesh.position.set(4, 12, -4.8);
      scene.add(moonMesh);

      /* --- 星フィールド --- */
      starsMesh = new THREE.Points(
        makeStarsGeometry(THREE),
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.12 })
      );
      scene.add(starsMesh);

      /* --- カート --- */
      var cartMat = Style.mat(0x5a3a1a);
      cartMesh = new THREE.Mesh(
        Style.roundedBox(CART_W, CART_H, 1.2),
        cartMat
      );
      cartMesh.position.set(0, CART_Y, 0);
      scene.add(cartMesh);

      // 車輪 x4
      var wheelMat = Style.mat(0x222222);
      var wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.18, 10);
      var wheelOffsets = [
        [-0.85, 0, 0.62], [0.85, 0, 0.62],
        [-0.85, 0, -0.62], [0.85, 0, -0.62]
      ];
      for (var w = 0; w < 4; w++) {
        var wm = new THREE.Mesh(wheelGeo, wheelMat);
        wm.rotation.z = Math.PI / 2;
        wm.position.set(
          wheelOffsets[w][0],
          -CART_H / 2 + 0.01,
          wheelOffsets[w][2]
        );
        cartMesh.add(wm);
        cartWheels.push(wm);
      }

      /* --- タワー胴体プール --- */
      for (var i = 0; i < POOL_SIZE; i++) {
        var tex = makeTierTexture(THREE, TIER_COLORS[i % TIER_COLORS.length]);
        var tMesh = new THREE.Mesh(
          Style.roundedBox(TIER_W, TIER_H, TIER_W * 0.8),
          new THREE.MeshLambertMaterial({ map: tex })
        );
        tMesh.visible = false;
        cartMesh.add(tMesh);
        tierPool.push(tMesh);
      }

      /* --- 姫 --- */
      buildPrincess(THREE);

      /* --- しゅりけん --- */
      var shurikenGeo = makeShurikenGeometry(THREE);
      var shurikenTex = makeShurikenTexture(THREE);
      shurikenMesh = new THREE.Mesh(
        shurikenGeo,
        new THREE.MeshBasicMaterial({ map: shurikenTex, side: THREE.DoubleSide })
      );
      shurikenMesh.visible = false;
      scene.add(shurikenMesh);

      /* --- 照準ライン --- */
      aimLine = new THREE.Line(
        makeAimLineGeometry(THREE),
        new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 })
      );
      aimLine.visible = false;
      scene.add(aimLine);

      /* --- 邪魔キャラ（提灯・カラス） --- */
      buildObstacles(THREE, scene);

      /* --- ハートプール（救出演出） --- */
      var heartTex = makeHeartTexture(THREE);
      var heartGeo = new THREE.PlaneGeometry(0.6, 0.6);
      for (var hp = 0; hp < HEART_POOL; hp++) {
        var hm = new THREE.Mesh(
          heartGeo,
          new THREE.MeshBasicMaterial({ map: heartTex, transparent: true, opacity: 0.95, depthWrite: false })
        );
        hm.visible = false;
        scene.add(hm);
        hearts.push({ mesh: hm, alive: false, t: 0, x: 0, y: 0, vx: 0, vy: 0 });
      }

      /* --- 葉プール（風の可視化） --- */
      var leafTex = makeLeafTexture(THREE);
      var leafGeo = new THREE.PlaneGeometry(0.36, 0.36);
      for (var lp = 0; lp < LEAF_POOL; lp++) {
        var lm = new THREE.Mesh(
          leafGeo,
          new THREE.MeshBasicMaterial({ map: leafTex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
        );
        lm.visible = false;
        scene.add(lm);
        leaves.push({
          mesh: lm,
          x: (Math.random() - 0.5) * 14,
          y: 1 + Math.random() * 7,
          z: 2 + Math.random() * 4,
          phase: Math.random() * Math.PI * 2,
          spin: Math.random() * 2
        });
        lm.position.set(leaves[lp].x, leaves[lp].y, leaves[lp].z);
      }

      /* --- ライト --- */
      var ambLight = new THREE.AmbientLight(0x334466, 0.8);
      scene.add(ambLight);
      var dirLight = new THREE.DirectionalLight(0xfff0cc, 1.2);
      dirLight.position.set(3, 10, 6);
      scene.add(dirLight);

      /* --- UI: しゅりけん残数・ステージ --- */
      uiShuriken = document.createElement('div');
      uiShuriken.style.cssText = [
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);',
        'font-size:1.1em;color:#ffe44a;text-shadow:0 1px 4px #000;',
        'letter-spacing:2px;z-index:11;pointer-events:none;',
        'font-family:sans-serif;font-weight:bold;'
      ].join('');
      document.body.appendChild(uiShuriken);

      uiStage = document.createElement('div');
      uiStage.style.cssText = [
        'position:fixed;bottom:112px;left:50%;transform:translateX(-50%);',
        'font-size:1em;color:#ffd0e0;text-shadow:0 1px 4px #000;',
        'letter-spacing:2px;z-index:11;pointer-events:none;',
        'font-family:sans-serif;font-weight:bold;'
      ].join('');
      document.body.appendChild(uiStage);
      showHud(false); // タイトル画面では非表示

      /* --- tierState プリアロケート --- */
      tierState = [];
      for (var ts = 0; ts < POOL_SIZE; ts++) {
        tierState.push({ alive: false, y: 0, fallFrom: 0, fallT: FALL_DUR });
      }
    },

    /* ========================================================================
     * start — ゲーム状態リセット
     * ======================================================================== */
    start: function (ctx) {
      stage          = 1;
      totalKnocked   = 0;
      shurikens      = 5;
      shurikenFlying = false;
      shurikenFalling = false;
      shurikenVy     = 0;
      shurikenX      = 0;
      shurikenY      = SHURIKEN_Y0;
      shurikenZ      = SHURIKEN_Z0;
      shuStartX      = 0;
      swipeStartNY   = null;
      aimY           = 3;
      aimVisible     = false;
      rescuing       = false;
      rescueT        = 0;
      heartAcc       = 0;
      cartX          = 0;
      cartDir        = 1;

      cartMesh.position.set(0, CART_Y, 0);

      // パーティクル全消し
      for (var h = 0; h < HEART_POOL; h++) {
        hearts[h].alive = false;
        hearts[h].mesh.visible = false;
      }

      // ステージ1構成（塔・邪魔・風・UIをまとめてリセット）
      setupStage(ctx);

      // しゅりけん非表示
      shurikenMesh.visible = false;
      shurikenMesh.scale.setScalar(1);
      shurikenMesh.position.set(-9, 3, 0);

      // 照準非表示・警告状態リセット（黄ライン＋にっこり顔）
      aimLine.visible = false;
      aimDanger = false;
      aimLine.material.color.setHex(0xffff00);
      aimLine.material.opacity = 0.5;
      prinHeadMesh.material.map = prinFaceNormal;
      prinHeadMesh.material.needsUpdate = true;

      ctx.setHint(ctx.t({ en: 'Rescue the princess on top!', ja: 'てっぺんの姫をたすけだせ！', es: '¡Rescata a la princesa!', 'pt-BR': 'Resgate a princesa!', fr: 'Sauvez la princesse !', de: 'Rette die Prinzessin!', it: 'Salva la principessa!', ko: '꼭대기의 공주를 구하자!', 'zh-Hans': '救出顶上的公主！', tr: 'Prensesi kurtar!' }));
      showHud(true);
      updateUI();
    },

    /* ========================================================================
     * update — フレーム処理
     * ======================================================================== */
    update: function (ctx, dt) {
      var i, ts, k;

      /* ---- タイムアウトチェック ---- */
      if (ctx.elapsed >= TIME_LIMIT) {
        showHud(false);
        ctx.sfx.success();
        ctx.endGame(ctx.score);
        return;
      }

      /* ---- 塔スライド（Stage6+） ---- */
      if (stage >= 6 && !rescuing) {
        var slideSpeed = Math.min(0.6 + (stage - 6) * 0.12, 1.4);
        cartX += slideSpeed * cartDir * dt;
        if (cartX > CART_RANGE) { cartX = CART_RANGE; cartDir = -1; }
        else if (cartX < -CART_RANGE) { cartX = -CART_RANGE; cartDir = 1; }
        cartMesh.position.x = cartX;
      }

      /* ---- 段の落下アニメ ---- */
      for (i = 0; i < POOL_SIZE; i++) {
        ts = tierState[i];
        if (ts.alive && ts.fallT < FALL_DUR) {
          ts.fallT += dt;
          k = Math.min(1, ts.fallT / FALL_DUR);
          tierPool[i].position.y = ts.fallFrom + (ts.y - ts.fallFrom) * k;
        }
      }

      /* ---- 撃ち抜いた段の吹き飛びアニメ ---- */
      if (flyTierIdx >= 0) {
        flyTierT += dt;
        var fm = tierPool[flyTierIdx];
        k = Math.min(1, flyTierT / FLY_DUR);
        fm.position.z = -k * 5;
        fm.rotation.x = -k * 5;
        fm.scale.setScalar(Math.max(0.01, 1 - k));
        if (flyTierT >= FLY_DUR) resetFlyTier();
      }

      /* ---- 姫: 落下アニメ＋手振り＋救出ジャンプ ---- */
      var prinBaseY = prinTargetY;
      if (prinFallT < FALL_DUR) {
        prinFallT += dt;
        k = Math.min(1, prinFallT / FALL_DUR);
        prinBaseY = prinFallFrom + (prinTargetY - prinFallFrom) * k;
      }
      var prinJump = 0;
      if (rescuing) {
        rescueT += dt;
        prinJump = Math.abs(Math.sin(rescueT * 7)) * 0.5;
        // ハートを一定間隔で発生
        heartAcc += dt;
        while (heartAcc > 0.18) {
          heartAcc -= 0.18;
          spawnHeart(
            cartX + (Math.random() - 0.5) * 1.0,
            CART_Y + prinBaseY + 0.9 + Math.random() * 0.5
          );
        }
        // 腕を大きく振る
        waveArm.rotation.z = -2.2 + Math.sin(rescueT * 14) * 0.7;
        if (rescueT >= RESCUE_DUR) {
          rescuing = false;
          stage++;
          setupStage(ctx);
        }
      } else {
        // 小さく手を振る
        waveArm.rotation.z = -2.2 + Math.sin(ctx.elapsed * 5) * 0.45;
      }
      princessGrp.position.y = prinBaseY + prinJump;

      /* ---- ハートパーティクル更新（プール） ---- */
      for (i = 0; i < HEART_POOL; i++) {
        var hh = hearts[i];
        if (!hh.alive) continue;
        hh.t += dt;
        if (hh.t > 1.1) {
          hh.alive = false;
          hh.mesh.visible = false;
          continue;
        }
        hh.x += hh.vx * dt;
        hh.y += hh.vy * dt;
        hh.mesh.position.set(hh.x, hh.y, 1.2);
        hh.mesh.scale.setScalar(0.5 + hh.t * 0.6);
        hh.mesh.material.opacity = 0.95 * (1 - hh.t / 1.1);
      }

      /* ---- 風（Stage4+）: 変化タイマー＋葉パーティクル ---- */
      if (windOn) {
        windTimer -= dt;
        if (windTimer <= 0) pickWind();
        for (i = 0; i < LEAF_POOL; i++) {
          var lf = leaves[i];
          lf.x += windX * 1.8 * dt;
          lf.y += windY * 1.8 * dt + Math.sin(ctx.elapsed * 3 + lf.phase) * 0.5 * dt;
          lf.mesh.rotation.z += dt * (2 + lf.spin);
          if (lf.x > 8 || lf.x < -8 || lf.y < 0.3 || lf.y > 9) {
            lf.x = (windX > 0) ? -8 : 8;
            lf.y = 1 + Math.random() * 7;
          }
          lf.mesh.position.set(lf.x, lf.y, lf.z);
        }
      }

      /* ---- 邪魔キャラ移動（Stage2+） ---- */
      for (i = 0; i < obstacles.length; i++) {
        var ob = obstacles[i];
        if (!ob.active) continue;
        ob.x += ob.dir * ob.speed * dt;
        if (ob.dir > 0 && ob.x > 6.5) {
          ob.x = -6.5;
          ob.y = 1.5 + Math.random() * 4.5;
        } else if (ob.dir < 0 && ob.x < -6.5) {
          ob.x = 6.5;
          ob.y = 1.5 + Math.random() * 4.5;
        }
        var bob = Math.sin(ctx.elapsed * 2.2 + ob.phase) * 0.25;
        ob.grp.position.set(ob.x, ob.y + bob, OB_Z);
        if (ob.wings) {
          var flap = Math.sin(ctx.elapsed * 14) * 0.7;
          ob.wings[0].rotation.x = flap;
          ob.wings[1].rotation.x = -flap;
          ob.grp.rotation.y = (ob.dir > 0) ? 0 : Math.PI;
        }
      }

      /* ---- しゅりけん飛行（手前→奥） ----
       * z進行度 p の smoothstep で発射点→照準へ決定論的に補間する。
       * 着弾Y = aimY + windOff（照準ラインと必ず一致。ズレは風だけ）。 */
      if (shurikenFlying) {
        shurikenZ -= SHURIKEN_SPEED * dt;
        if (windOn) windOff += windY * 1.5 * dt;                 // 風で狙いが上下に流れる
        var fp = 1 - Math.max(0, shurikenZ) / SHURIKEN_Z0;       // 0(発射)..1(着弾)
        var fe = fp * fp * (3 - 2 * fp);                         // smoothstep
        shurikenX = shuStartX + (cartX - shuStartX) * fe;        // タワーのxへ寄せる
        shurikenY = SHURIKEN_Y0 + (aimY - SHURIKEN_Y0) * fe + windOff;
        shurikenMesh.position.set(shurikenX, shurikenY, shurikenZ);
        shurikenMesh.rotation.z += 22 * dt;
        shurikenMesh.scale.setScalar(0.7 + Math.max(0, shurikenZ) / 9 * 0.5);

        /* -- 邪魔キャラに接触 → しゅりけん落下 -- */
        for (i = 0; i < obstacles.length; i++) {
          var ob2 = obstacles[i];
          if (!ob2.active) continue;
          if (Math.abs(shurikenZ - OB_Z) > 0.9) continue;
          var odx = shurikenX - ob2.grp.position.x;
          var ody = shurikenY - ob2.grp.position.y;
          var orr = ob2.r + SHURIKEN_R * 0.8;
          if (odx * odx + ody * ody < orr * orr) {
            shurikenFlying = false;
            shurikenFalling = true;
            shurikenVy = 2.0;
            ctx.sfx.bounce();
            ctx.vibrate(30);
            ctx.setHint('💫');
            break;
          }
        }

        /* -- 奥のタワー面 z≈0 に到達 → 当たり判定 -- */
        if (shurikenFlying && shurikenZ <= 0.2) {
          shurikenFlying = false;
          shurikenMesh.visible = false;
          shurikenMesh.scale.setScalar(1);
          var shuY = shurikenY;

          // 姫チェック（最優先）: 当てたらゲームオーバー
          var prinWY = CART_Y + princessGrp.position.y + PRIN_CY;
          if (Math.abs(shuY - prinWY) < PRIN_BAND) {
            prinHeadMesh.material.map = prinFaceWorried;
            prinHeadMesh.material.needsUpdate = true;
            showHud(false);
            ctx.sfx.fail();
            ctx.vibrate(80);
            ctx.gameOver(ctx.score);
            return;
          }

          // 胴体チェック（下から上へ）
          var hitTier = false;
          for (i = 0; i < numTiers; i++) {
            ts = tierState[i];
            if (!ts.alive) continue;
            var tierWorldY = CART_Y + tierPool[i].position.y;
            if (Math.abs(shuY - tierWorldY) < TIER_H / 2 + SHURIKEN_R * 0.7) {
              hitTier = true;
              ts.alive = false;

              // 撃ち抜いた段は奥へ回転しながら吹き飛ぶ
              resetFlyTier();
              flyTierIdx = i;
              flyTierT = 0;
              tierPool[i].visible = true;

              // スコア加算
              ctx.addScore(1);
              totalKnocked++;
              ctx.sfx.score();

              // 上の段＆姫を落下再配置
              var aliveCount = rebuildTower(true);

              // しゅりけん補充（最大7）
              if (shurikens < MAX_SHURIKENS) shurikens++;
              updateUI();

              // 姫が地上に降りた → 救出演出開始
              if (aliveCount === 0) {
                rescuing = true;
                rescueT = 0;
                heartAcc = 0;
                ctx.sfx.success();
                ctx.setHint('💖');
              }
              break;
            }
          }

          // どの段にも当たらなかった → はずれ
          if (!hitTier) {
            ctx.setHint('✖');
            loseShuriken(ctx);
            return;
          }
        }
      }

      /* ---- しゅりけん落下（邪魔に当たった後） ---- */
      if (shurikenFalling) {
        shurikenVy -= 22 * dt;
        shurikenY += shurikenVy * dt;
        shurikenMesh.position.set(shurikenX, shurikenY, shurikenZ);
        shurikenMesh.rotation.z += 28 * dt;
        if (shurikenY < FLOOR_Y + 0.15) {
          shurikenFalling = false;
          shurikenMesh.visible = false;
          shurikenMesh.scale.setScalar(1);
          loseShuriken(ctx);
          return;
        }
      }
    },

    /* ========================================================================
     * ポインター: スワイプ開始
     * ======================================================================== */
    onPointerDown: function (ctx, p) {
      if (shurikenFlying || shurikenFalling || rescuing) return;
      swipeStartNY = p.ny;
      aimY = nyCsToWorldY(p.ny);
      aimLine.position.y = aimY;
      aimLine.visible = true;
      aimVisible = true;
      updateAimDanger();
    },

    /* ========================================================================
     * ポインター: スワイプ移動（照準更新）
     * ======================================================================== */
    onPointerMove: function (ctx, p) {
      if (!aimVisible || shurikenFlying || shurikenFalling || rescuing) return;
      aimY = nyCsToWorldY(p.ny);
      aimLine.position.y = aimY;
      updateAimDanger();
    },

    /* ========================================================================
     * ポインター: 指を離す → しゅりけん投擲
     * ======================================================================== */
    onPointerUp: function (ctx, p) {
      if (shurikenFlying || shurikenFalling || rescuing) return;
      aimLine.visible = false;
      aimVisible = false;

      if (swipeStartNY === null) return;
      if (shurikens <= 0) {
        showHud(false);
        ctx.sfx.fail();
        ctx.gameOver(ctx.score);
        return;
      }

      // しゅりけんを消費してから投げる
      shurikens--;
      updateUI();

      // 手前（プレイヤー側）から発射 → 奥のタワーへ飛ぶ。狙った高さ(aimY)に刺さる。
      shuStartX = cartX;
      shurikenX = shuStartX;
      shurikenY = SHURIKEN_Y0;
      shurikenZ = SHURIKEN_Z0;
      windOff = 0;

      swipeStartNY = null;

      shurikenMesh.position.set(shurikenX, shurikenY, shurikenZ);
      shurikenMesh.rotation.z = 0;
      shurikenMesh.visible = true;
      shurikenFlying = true;

      ctx.sfx.tap();
    }
  });

  /* ==========================================================================
   * ヘルパー: 正規化Y座標 (ny: -1..+1) → ワールドY
   *   ny=-1 (画面下) → 1.0 (最下段) / ny=+1 (画面上) → 7.5 (上の方)
   * ========================================================================== */
  function nyCsToWorldY(ny) {
    var t = (ny + 1) / 2; // 0(下)..1(上)
    return 1.0 + t * 6.5;
  }

})();
