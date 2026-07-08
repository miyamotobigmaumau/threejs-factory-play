/* =========================================================================
 * TMYokaiKagefumi — ようかいかげふみ（防衛型）
 * ルール: 妖怪は鳥居から町へ逃げようと歩く。「影」をタップで封印！
 *   鳥居を3匹くぐられたら終了（逃走ライフ制）。
 *   本体タップは -1点＋その妖怪が加速。影が短い妖怪は高得点。連続封印でボーナス。
 * 操作: 影をタップ（光源変化で影の向きが変わる）
 * スコア: 封印数ベースの得点（ひき）
 * ========================================================================= */
(function () {
  'use strict';

  // =========================================================
  // 定数
  // =========================================================
  var YOKAI_COUNT = 5;       // 妖怪の数
  var PLAY_HALF  = 7.0;      // フィールド半径（片側）
  var SHADOW_MIN = 0.9;      // 影スケール（最小）
  var SHADOW_MAX = 3.5;      // 影スケール（最大、60秒時）
  var RESPAWN_DELAY = 2.0;   // 封印後のリスポーン秒数
  var GATE_HALF = 1.4;       // 鳥居の通り抜け幅（±）
  var ESCAPE_MAX = 3;        // 逃走ライフ（3匹くぐられたら終了）

  // =========================================================
  // モジュールスコープ変数（per-frameアロケーション禁止）
  // =========================================================
  var yokaiList = [];        // 妖怪データ配列
  var shadowMeshes = [];     // 影メッシュ配列（レイキャスト用）
  var bodyMeshes  = [];      // 本体メッシュ配列（レイキャスト用）

  var raycaster;             // THREE.Raycaster（init()で1回だけ生成）
  var rayOrigin;             // 再利用 Vector3
  var rayDir;                // 再利用 Vector3
  var tmpVec2;               // 計算用 Vector3

  var score = 0;
  var elapsed = 0;
  var sunAngle = 0;          // 太陽の方位角（ラジアン）
  var lanternActive = false; // 提灯フェーズフラグ
  var escapes = 0;           // 鳥居をくぐられた数（ライフ）
  var streak = 0;            // 連続封印数（コンボ）
  var gameEnded = false;

  // 地面・装飾メッシュ（init()で生成、start()でリセット不要）
  var groundMesh;
  var toriiGroup;
  var lanternWindows = [];   // 灯篭の火袋（点灯演出用）

  // 教示・演出用（プール方式）
  var lifeDiv, lifeSpans = [];   // 画面上部の⛩ライフ表示DOM
  var demoGhost;                 // 指ゴースト（白い半透明の球）
  var demoRipple;                // 指ゴーストのタップ波紋リング
  var demoActive = false;        // デモ再生中フラグ
  var demoT = 0;                 // デモ経過時間
  var xMarkGroup;                // 本体タップ時の✗マーク
  var xMarkMat;                  // ✗マーク共有マテリアル
  var xMarkTimer = 0;
  var sealPillars = [];          // 封印演出の光の柱プール {mesh, t}

  // =========================================================
  // 妖怪グループを生成する関数
  //   body  = 白い球体 + 目2つ
  //   shadow = 黒い平面（地面直上）
  // =========================================================
  function makeYokai(THREE, scene) {
    var group = new THREE.Group();

    // --- 本体: おばけ（丸い頭＋すぼんだしっぽ） ---
    var bodyMat = Style.mat(0xf0f0e0);
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), bodyMat);
    body.position.y = 0.62;
    group.add(body);
    // しっぽ（下すぼみの逆コーン）
    var tail = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.5, 10), bodyMat);
    tail.rotation.x = Math.PI;
    tail.position.y = 0.28;
    body.add(tail);
    tail.position.set(0, -0.35, -0.05);
    // 両手（小さなまるい手）
    var handGeo = new THREE.SphereGeometry(0.11, 8, 6);
    var handL = new THREE.Mesh(handGeo, bodyMat);
    var handR = new THREE.Mesh(handGeo, bodyMat);
    handL.position.set(-0.42, -0.05, 0.1);
    handR.position.set( 0.42, -0.05, 0.1);
    body.add(handL);
    body.add(handR);

    // --- 目: 小さな黒球×2 ＋ 口 ---
    var eyeGeo = new THREE.SphereGeometry(0.07, 6, 4);
    var eyeMat = Style.mat(0x111111);
    var eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    var eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.15, 0.72, 0.36);
    eyeR.position.set( 0.15, 0.72, 0.36);
    group.add(eyeL);
    group.add(eyeR);
    // あいた口（黒いだ円）
    var mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eyeMat);
    mouth.scale.set(1, 1.3, 0.4);
    mouth.position.set(0, 0.55, 0.38);
    group.add(mouth);

    // --- 影: 黒い平面（PlaneGeometry） ---
    var shadowGeo = new THREE.PlaneGeometry(0.8, 1.5);
    var shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    var shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2; // 水平に寝かせる
    shadow.position.y = 0.01;          // 地面のすぐ上
    scene.add(shadow); // 影は独立してsceneに追加（group外）

    // --- 影の縁光: 薄紫のひとまわり大きい平面（常時ゆっくり脈動） ---
    var glowGeo = new THREE.PlaneGeometry(0.8, 1.5);
    var glowMat = new THREE.MeshBasicMaterial({
      color: 0xb388ff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false
    });
    var glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.006; // 影のすぐ下
    scene.add(glow);

    scene.add(group);

    // ユーザーデータとして body/shadow を紐付け
    body._yokaiId  = yokaiList.length;
    shadow._yokaiId = yokaiList.length;

    return {
      group:  group,
      body:   body,
      shadow: shadow,
      glow:   glow,
      // 移動ベクトル（xz平面）
      vx: (Math.random() - 0.5) * 2.5,
      vz: (Math.random() - 0.5) * 2.5,
      // リスポーンカウントダウン（0以下＝生存中）
      respawnTimer: 0,
      visible: true,
      shadowAngle: 0,
      shadowLen: SHADOW_MIN,
      speedMul: 1,           // 本体タップで加速するペナルティ倍率
      shadowFactor: 1,       // 個体ごとの影の長さ（短い=高得点）
      wobblePhase: Math.random() * Math.PI * 2,
      sealing: false,        // 封印アニメ中フラグ
      sealT: 0               // 封印アニメ残り時間
    };
  }

  // =========================================================
  // 妖怪を可視化するヘルパー
  // =========================================================
  function setYokaiVisible(y, v) {
    y.visible = v;
    y.group.visible = v;
    y.shadow.visible = v;
    y.glow.visible = v;
  }

  // =========================================================
  // ライフ（逃走残数）表示: 画面上部の⛩アイコン列を更新
  // =========================================================
  function updateLifeHint(ctx) {
    for (var h = 0; h < lifeSpans.length; h++) {
      lifeSpans[h].style.opacity = (h < ESCAPE_MAX - escapes) ? '1' : '0.2';
    }
  }

  // =========================================================
  // ランダム位置へ配置するヘルパー
  // =========================================================
  function respawnYokai(y) {
    // 鳥居（奥）から遠い手前側に湧く → 鳥居へ歩いて行く
    var x = (Math.random() * 2 - 1) * (PLAY_HALF - 1);
    var z = 1.0 + Math.random() * (PLAY_HALF - 2);
    y.group.position.set(x, 0, z);
    y.group.scale.set(1, 1, 1);
    y.sealing = false;
    y.sealT = 0;
    y.speedMul = 1;
    y.shadowFactor = 0.6 + Math.random() * 0.8; // 0.6〜1.4（短い個体=高得点）
    y.wobblePhase = Math.random() * Math.PI * 2;
    setYokaiVisible(y, true);
  }

  // =========================================================
  // 影の変換を更新
  //   elapsed: 経過秒数（0〜60）
  //   sunAngle: 太陽方位角（ラジアン）
  // =========================================================
  function updateShadow(y, elapsed, sunAngle, lanternAngle) {
    var px = y.group.position.x;
    var pz = y.group.position.z;

    // 影の長さ: 時間が経つほど伸びる × 個体差（短い個体=高得点）
    var t  = Math.min(elapsed / 60, 1);
    var scaleZ = (SHADOW_MIN + (SHADOW_MAX - SHADOW_MIN) * t) * (y.shadowFactor || 1);

    // 30秒以降は提灯が加わって影の方向がランダムに変わる
    var finalAngle = sunAngle;
    if (lanternActive) {
      // 提灯の影が半分確率で支配（yokaiIdで決定的に分岐）
      var yi = y.body._yokaiId;
      if ((yi % 2 === 0) !== (Math.floor(elapsed * 0.4) % 2 === 0)) {
        finalAngle = lanternAngle;
      }
    }

    // 影の中心座標: 妖怪足元からfinalAngle方向へoffset
    var offset = scaleZ * 0.5;
    var sx = px + Math.sin(finalAngle) * offset;
    var sz = pz + Math.cos(finalAngle) * offset;

    y.shadow.position.x = sx;
    y.shadow.position.z = sz;
    y.shadow.position.y = 0.01;

    // 影の向きをfinalAngleに合わせる
    y.shadow.rotation.x = -Math.PI / 2;
    y.shadow.rotation.z = finalAngle;

    // 影のスケール: x=幅(固定)、y=長さ（scaleZで伸ばす）
    y.shadow.scale.set(1, scaleZ, 1);

    // 縁光を影に同期（ひとまわり大きく・ゆっくり脈動）
    var pulse = 1.12 + 0.06 * Math.sin(elapsed * 2.2 + y.body._yokaiId * 1.7);
    y.glow.position.set(sx, 0.006, sz);
    y.glow.rotation.x = -Math.PI / 2;
    y.glow.rotation.z = finalAngle;
    y.glow.scale.set(pulse, scaleZ * pulse, 1);
    y.glow.material.opacity = 0.2 + 0.14 * (0.5 + 0.5 * Math.sin(elapsed * 2.2 + y.body._yokaiId * 1.7));

    // タップ判定用に現在の影の姿勢を保存
    y.shadowAngle = finalAngle;
    y.shadowLen = scaleZ;
  }

  // =========================================================
  // 鳥居を生成する関数（装飾）
  // =========================================================
  function makeTorii(THREE) {
    var g = new THREE.Group();
    var mat = Style.mat(0xcc3300);

    // 左柱
    var pillarGeo = new THREE.CylinderGeometry(0.18, 0.22, 3.5, 8);
    var pL = new THREE.Mesh(pillarGeo, mat);
    pL.position.set(-1.5, 1.75, 0);
    g.add(pL);

    // 右柱
    var pR = new THREE.Mesh(pillarGeo, mat);
    pR.position.set( 1.5, 1.75, 0);
    g.add(pR);

    // 上の横木（笠木）
    var kasaGeo = Style.roundedBox(4.0, 0.28, 0.28);
    var kasa = new THREE.Mesh(kasaGeo, mat);
    kasa.position.set(0, 3.65, 0);
    g.add(kasa);

    // 中段の横木（貫）
    var nukiGeo = Style.roundedBox(3.2, 0.18, 0.18);
    var nuki = new THREE.Mesh(nukiGeo, mat);
    nuki.position.set(0, 2.9, 0);
    g.add(nuki);

    return g;
  }

  // =========================================================
  // Shell.registerGame
  // =========================================================
  Shell.registerGame({
    id:           'TMYokaiKagefumi',
    title:        { en: 'Yokai Shadow Stomp', ja: 'ようかいかげふみ', es: 'Sombras de Yokai', 'pt-BR': 'Sombras do Yokai', fr: 'Ombres Yokai', de: 'Yokai Schattenspiel', it: 'Ombre Yokai', ko: '요괴 그림자 밟기', 'zh-Hans': '妖怪踩影子', tr: 'Yokai Gölge Oyunu' },
    howto:        { en: 'Yokai flee from the shrine gate to town!\nTap their "shadow" to seal them!\n3 yokai through the gate = game over.', ja: 'ようかいが とりいから 町へにげる！\n「かげ」をタップで ふういん！\nとりいを 3びき くぐられたら おわり。', es: '¡Los yokai huyen del torii al pueblo!\n¡Toca su "sombra" para sellarlos!\n3 yokai por el torii = fin del juego.', 'pt-BR': 'Os yokai fogem do torii para a cidade!\nToque na "sombra" para selá-los!\n3 yokai pela porta = fim de jogo.', fr: 'Les yokai fuient du torii vers la ville !\nTouchez leur « ombre » pour les sceller !\n3 yokai passent le torii = fin du jeu.', de: 'Yokai fliehen vom Torii in die Stadt!\nIhren „Schatten" antippen um sie zu versiegeln!\n3 Yokai durch das Tor = Spielende.', it: 'I yokai fuggono dal torii verso la città!\nTocca la loro «ombra» per sigillarli!\n3 yokai passano il torii = fine del gioco.', ko: '요괴가 도리이를 통해 마을로 도망친다!\n「그림자」를 탭해서 봉인하라!\n3마리 통과하면 끝.', 'zh-Hans': '妖怪从鸟居逃向城镇！\n点击他们的「影子」封印！\n3只通过鸟居 = 游戏结束。', tr: 'Yokailer toriiiden kasabaya kaçıyor!\n"Gölge"lerine dokun ve mühürle!\n3 yokai geçerse oyun biter.' },
    scoreLabel:   { en: 'pts', ja: 'てん', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pts', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg:           0xff8844,
    fitWidth:     15,
    allowContinue: false,

    // ------------------------------------------------------
    // init: メッシュ・ライト・カメラ設定をすべてここで行う
    // ------------------------------------------------------
    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;

      // ---- レイキャスター（モジュールスコープで1個のみ） ----
      raycaster = new THREE.Raycaster();
      rayOrigin = new THREE.Vector3();
      rayDir    = new THREE.Vector3();
      tmpVec2   = new THREE.Vector3();

      // ---- 地面: 石畳（グレー） ----
      groundMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(PLAY_HALF * 2, PLAY_HALF * 2),
        Style.mat(0x8d9276)
      );
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.position.y = 0;
      scene.add(groundMesh);

      // 石畳の目地ライン（格子）
      var lineMat = new THREE.MeshBasicMaterial({ color: 0x666655 });
      for (var gi = -PLAY_HALF; gi <= PLAY_HALF; gi += 2) {
        // 縦線
        var vlGeo = new THREE.PlaneGeometry(0.06, PLAY_HALF * 2);
        var vl = new THREE.Mesh(vlGeo, lineMat);
        vl.rotation.x = -Math.PI / 2;
        vl.position.set(gi, 0.005, 0);
        scene.add(vl);
        // 横線
        var hlGeo = new THREE.PlaneGeometry(PLAY_HALF * 2, 0.06);
        var hl = new THREE.Mesh(hlGeo, lineMat);
        hl.rotation.x = -Math.PI / 2;
        hl.position.set(0, 0.005, gi);
        scene.add(hl);
      }

      // ---- 鳥居（奥に配置） ----
      toriiGroup = makeTorii(THREE);
      toriiGroup.position.set(0, 0, -PLAY_HALF + 0.5);
      scene.add(toriiGroup);

      // ---- 鳥居の奥: 町（家のシルエット数軒） ----
      var houseMat = Style.mat(0x4a3550);
      var roofMat  = Style.mat(0x38263e);
      var housePos = [[-4.5, -PLAY_HALF - 3.5], [-1.5, -PLAY_HALF - 5],
                      [1.8, -PLAY_HALF - 4], [4.6, -PLAY_HALF - 3],
                      [0.2, -PLAY_HALF - 7]];
      for (var hp = 0; hp < housePos.length; hp++) {
        var hw = 1.6 + (hp % 3) * 0.5;
        var hh = 1.2 + ((hp * 7) % 4) * 0.35;
        var hb = new THREE.Mesh(Style.roundedBox(hw, hh, 1.4), houseMat);
        hb.position.set(housePos[hp][0], hh / 2, housePos[hp][1]);
        scene.add(hb);
        var hr = new THREE.Mesh(new THREE.ConeGeometry(hw * 0.75, 0.8, 4), roofMat);
        hr.position.set(housePos[hp][0], hh + 0.4, housePos[hp][1]);
        hr.rotation.y = Math.PI / 4;
        scene.add(hr);
      }

      // ---- 石灯篭×4（30びょうで点灯して提灯フェーズを予告） ----
      lanternWindows.length = 0;
      var stoneMat = Style.mat(0x9e9e8e);
      var lampPos = [[-PLAY_HALF + 1, -PLAY_HALF + 1], [PLAY_HALF - 1, -PLAY_HALF + 1],
                     [-PLAY_HALF + 1, PLAY_HALF - 1], [PLAY_HALF - 1, PLAY_HALF - 1]];
      for (var lp = 0; lp < 4; lp++) {
        var lg = new THREE.Group();
        var lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.3, 8), stoneMat);
        lampBase.position.y = 0.15;
        lg.add(lampBase);
        var lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.9, 8), stoneMat);
        lampPost.position.y = 0.75;
        lg.add(lampPost);
        var fireBox = new THREE.Mesh(Style.roundedBox(0.5, 0.4, 0.5), stoneMat);
        fireBox.position.y = 1.4;
        lg.add(fireBox);
        var lampWin = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.24),
          new THREE.MeshBasicMaterial({ color: 0x333326, transparent: true }));
        lampWin.position.set(0, 1.4, 0.26);
        lg.add(lampWin);
        lanternWindows.push(lampWin);
        var lampRoof = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.36, 4), stoneMat);
        lampRoof.position.y = 1.78;
        lampRoof.rotation.y = Math.PI / 4;
        lg.add(lampRoof);
        lg.position.set(lampPos[lp][0], 0, lampPos[lp][1]);
        scene.add(lg);
      }

      // ---- 妖怪を生成 ----
      yokaiList   = [];
      shadowMeshes = [];
      bodyMeshes  = [];
      for (var i = 0; i < YOKAI_COUNT; i++) {
        var y = makeYokai(THREE, scene);
        yokaiList.push(y);
        shadowMeshes.push(y.shadow);
        bodyMeshes.push(y.body);
      }

      // ---- 指ゴースト（初回教示デモ用: 白い半透明の球＋タップ波紋） ----
      demoGhost = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
      );
      demoGhost.visible = false;
      scene.add(demoGhost);
      demoRipple = new THREE.Mesh(
        new THREE.RingGeometry(0.25, 0.35, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
      );
      demoRipple.rotation.x = -Math.PI / 2;
      demoRipple.position.y = 0.03;
      demoRipple.visible = false;
      scene.add(demoRipple);

      // ---- 本体タップ時の✗マーク（プール1個・再利用） ----
      xMarkMat = new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0 });
      xMarkGroup = new THREE.Group();
      var xbar1 = new THREE.Mesh(Style.roundedBox(0.9, 0.16, 0.1), xMarkMat);
      xbar1.rotation.z = Math.PI / 4;
      xMarkGroup.add(xbar1);
      var xbar2 = new THREE.Mesh(Style.roundedBox(0.9, 0.16, 0.1), xMarkMat);
      xbar2.rotation.z = -Math.PI / 4;
      xMarkGroup.add(xbar2);
      xMarkGroup.visible = false;
      scene.add(xMarkGroup);

      // ---- 封印演出: 光の柱プール ----
      sealPillars.length = 0;
      for (var sp = 0; sp < 3; sp++) {
        var pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.45, 0.45, 4.5, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xfff59d, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        );
        pillar.visible = false;
        scene.add(pillar);
        sealPillars.push({ mesh: pillar, t: 0 });
      }

      // ---- 画面上部の⛩ライフ表示DOM ----
      lifeDiv = document.createElement('div');
      lifeDiv.style.cssText = [
        'position:fixed;top:10px;left:50%;transform:translateX(-50%);',
        'font-size:26px;letter-spacing:6px;z-index:11;display:none;',
        'pointer-events:none;text-shadow:0 1px 4px #0008;'
      ].join('');
      lifeSpans.length = 0;
      for (var ls = 0; ls < ESCAPE_MAX; ls++) {
        var sp2 = document.createElement('span');
        sp2.textContent = '⛩';
        lifeDiv.appendChild(sp2);
        lifeSpans.push(sp2);
      }
      document.body.appendChild(lifeDiv);

      // ---- カメラ: 真上気味の俯瞰 ----
      ctx.camera.position.set(0, 12, 8);
      ctx.camera.lookAt(0, 0, 0);
    },

    // ------------------------------------------------------
    // start: ゲームリセット
    // ------------------------------------------------------
    start: function (ctx) {
      score        = 0;
      elapsed      = 0;
      sunAngle     = Math.PI * 0.25; // 初期太陽方位
      lanternActive = false;
      escapes      = 0;
      streak       = 0;
      gameEnded    = false;

      // 妖怪を時間差で登場させる（最初は1匹だけ、徐々に増える）
      // 初見でルールを飲み込む猶予のため、序盤の同時数を抑える
      for (var i = 0; i < yokaiList.length; i++) {
        yokaiList[i].respawnTimer = i < 1 ? 0 : i * 2.4;
        if (i < 1) respawnYokai(yokaiList[i]);
        else setYokaiVisible(yokaiList[i], false);
      }

      // 教示デモ: 最初の妖怪の影を指ゴーストがタップして見せる（1回のみ）
      demoActive = true;
      demoT = 0;
      demoGhost.visible = false;
      demoRipple.visible = false;

      // 演出プールのリセット
      xMarkTimer = 0;
      xMarkGroup.visible = false;
      for (var spi = 0; spi < sealPillars.length; spi++) {
        sealPillars[spi].t = 0;
        sealPillars[spi].mesh.visible = false;
      }

      lifeDiv.style.display = '';
      ctx.setScore(0);
      updateLifeHint(ctx);
      ctx.setHint(ctx.t({ en: 'Tap their shadow before they reach the gate!', ja: 'とりいから出る前に かげをふんで封印！', es: '¡Toca su sombra antes de que crucen!', 'pt-BR': 'Toque a sombra antes de cruzar!', fr: 'Touchez l\'ombre avant qu\'ils passent !', de: 'Schatten antippen vor dem Tor!', it: 'Tocca l\'ombra prima del cancello!', ko: '토리이 나가기 전에 그림자를 탭!', 'zh-Hans': '在他们出门前点击影子！', tr: 'Kapıdan geçmeden gölgeye dokun!' }));
    },

    // ------------------------------------------------------
    // update: 毎フレーム処理
    // ------------------------------------------------------
    update: function (ctx, dt) {
      if (gameEnded) return;
      elapsed += dt;

      // ---- 太陽が沈む: 方位角を徐々に回転 ----
      sunAngle += dt * 0.3; // 30秒で約90度回る

      // ---- 30秒後: 提灯フェーズ（灯篭が点灯） ----
      if (elapsed >= 30 && !lanternActive) {
        lanternActive = true;
        for (var lw = 0; lw < lanternWindows.length; lw++) {
          lanternWindows[lw].material.color.setHex(0xffd54f);
        }
        ctx.sfx.bounce();
      }
      // 点灯後はゆらめかせる
      if (lanternActive) {
        var flick = 0.85 + Math.sin(elapsed * 9) * 0.1 + Math.sin(elapsed * 23) * 0.05;
        for (var lw2 = 0; lw2 < lanternWindows.length; lw2++) {
          lanternWindows[lw2].material.opacity = flick;
        }
      }
      var lanternAngle = sunAngle + Math.PI * 0.6; // 提灯は太陽と異方向

      // 時間経過で妖怪の歩行速度が上がる（序盤ゆっくり 0.7 → 1.55 m/s）
      var baseSpeed = 0.7 + Math.min(elapsed / 55, 1) * 0.85;
      // 鳥居ライン（この z を越えると逃走成立）
      var gateZ = -PLAY_HALF + 0.5;

      // ---- 妖怪の移動・影の更新 ----
      for (var i = 0; i < yokaiList.length; i++) {
        var y = yokaiList[i];

        // 封印アニメ中: 渦を巻いて縮んで消える
        if (y.sealing) {
          y.sealT -= dt;
          var sf = Math.max(0, y.sealT / 0.45);
          y.group.rotation.y += 14 * dt;
          y.group.scale.set(sf, sf, sf);
          y.group.position.y = (1 - sf) * 0.9;
          if (y.sealT <= 0) {
            y.sealing = false;
            setYokaiVisible(y, false);
            y.group.scale.set(1, 1, 1);
            y.group.position.y = 0;
            y.respawnTimer = RESPAWN_DELAY;
          }
          continue;
        }

        // リスポーン待ち
        if (y.respawnTimer > 0) {
          y.respawnTimer -= dt;
          if (y.respawnTimer <= 0) {
            respawnYokai(y);
          }
          continue;
        }
        if (!y.visible) continue;

        // 鳥居（奥・-Z 方向）へ歩く。X はふらつきながら鳥居中央へ寄る
        var speed = baseSpeed * y.speedMul;
        var toGateX = (0 - y.group.position.x) * 0.4; // 鳥居中央(x=0)へ緩く寄る
        var wobble = Math.sin(elapsed * 1.8 + y.wobblePhase) * 1.2;
        var vx = (toGateX + wobble) * 0.5;
        var vz = -speed; // 常に奥へ

        var px = y.group.position.x + vx * dt;
        var pz = y.group.position.z + vz * dt;

        // 横の壁だけバウンス（奥はゴール＝鳥居）
        if (px < -PLAY_HALF + 0.5) px = -PLAY_HALF + 0.5;
        if (px > PLAY_HALF - 0.5)  px = PLAY_HALF - 0.5;
        y.group.position.x = px;
        y.group.position.z = pz;

        // 進行方向（奥）に体を向ける
        y.group.rotation.y = Math.atan2(vx, vz);
        // ふわふわ浮遊
        y.body.position.y = 0.62 + Math.sin(elapsed * 3 + i * 1.3) * 0.07;

        // 影の更新
        updateShadow(y, elapsed, sunAngle, lanternAngle);

        // ---- 鳥居をくぐった → 逃走成立 ----
        if (pz <= gateZ && Math.abs(px) <= GATE_HALF) {
          escapes++;
          streak = 0;
          ctx.sfx.fail();
          ctx.vibrate(60);
          setYokaiVisible(y, false);
          y.respawnTimer = RESPAWN_DELAY;
          if (escapes >= ESCAPE_MAX) {
            gameEnded = true;
            ctx.setHint(ctx.t({ en: 'They escaped… Yokai reached the town!', ja: 'にげられた… ようかいが町へ！', es: '¡Escaparon… los yokai llegaron al pueblo!', 'pt-BR': 'Fugiram… os yokai chegaram à cidade!', fr: 'Ils ont fui… les yokai ont atteint la ville !', de: 'Entkommen… Yokai erreichten die Stadt!', it: 'Sono fuggiti… i yokai hanno raggiunto la città!', ko: '도망쳤다… 요괴가 마을로!', 'zh-Hans': '逃跑了……妖怪进入城镇！', tr: 'Kaçtılar… Yokai kasabaya ulaştı!' }));
            ctx.gameOver(score, ctx.t({ en: 'The yokai escaped to town', ja: 'ようかいを解き放ってしまった', es: 'Los yokai escaparon al pueblo', 'pt-BR': 'Os yokai fugiram para a cidade', fr: 'Les yokai ont fui vers la ville', de: 'Die Yokai entkamen in die Stadt', it: 'I yokai sono fuggiti in città', ko: '요괴들이 마을로 도망쳤다', 'zh-Hans': '妖怪逃进了城镇', tr: 'Yokailer kasabaya kaçtı' }));
            return;
          }
          updateLifeHint(ctx);
        } else if (pz < gateZ - 1) {
          // 鳥居の外（横）へ抜けてしまった場合も逃走扱いにせず、端で反射
          setYokaiVisible(y, false);
          y.respawnTimer = RESPAWN_DELAY;
        }
      }
    },

    // ------------------------------------------------------
    // onPointerDown: タップ判定
    //   影タップ → 捕獲 (+1)
    //   本体タップ → 逃亡（しばらく非表示）
    // ------------------------------------------------------
    onPointerDown: function (ctx, p) {
      // NDC座標でレイを設定
      raycaster.setFromCamera({ x: p.nx, y: p.ny }, ctx.camera);

      // ---- 影判定: 地面との交点を求めて影矩形＋指マージンで判定 ----
      // レイと y=0 平面の交点
      rayOrigin.copy(raycaster.ray.origin);
      rayDir.copy(raycaster.ray.direction);
      if (Math.abs(rayDir.y) > 1e-5) {
        var tGround = -rayOrigin.y / rayDir.y;
        if (tGround > 0) {
          var gx = rayOrigin.x + rayDir.x * tGround;
          var gz = rayOrigin.z + rayDir.z * tGround;
          var MARGIN = 0.45; // 指の太さぶんの許容
          for (var si = 0; si < yokaiList.length; si++) {
            var yk = yokaiList[si];
            if (!yk.visible || yk.respawnTimer > 0) continue;
            // 影ローカル座標に変換（中心基準・角度で回転）
            var relX = gx - yk.shadow.position.x;
            var relZ = gz - yk.shadow.position.z;
            var ca = Math.cos(-yk.shadowAngle), sa = Math.sin(-yk.shadowAngle);
            var u = relX * ca - relZ * sa;              // 幅方向
            var v = relX * sa + relZ * ca;              // 長さ方向
            if (Math.abs(u) <= 0.4 + MARGIN && Math.abs(v) <= 0.75 * yk.shadowLen + MARGIN) {
              // 封印！ 影が短いほど高得点（1〜3点）＋連続封印コンボ
              streak++;
              var basePts = yk.shadowFactor < 0.8 ? 3 : (yk.shadowFactor < 1.1 ? 2 : 1);
              var comboBonus = streak >= 5 ? 2 : (streak >= 3 ? 1 : 0);
              var gained = basePts + comboBonus;
              score += gained;
              ctx.setScore(score);
              ctx.sfx.tap();
              ctx.vibrate(30);
              if (streak >= 3) ctx.setHint(ctx.t({ en: 'Sealed! +', ja: 'ふういん！ +', es: '¡Sellado! +', 'pt-BR': 'Selado! +', fr: 'Scellé ! +', de: 'Versiegelt! +', it: 'Sigillato! +', ko: '봉인! +', 'zh-Hans': '封印！+', tr: 'Mühürlendi! +' }) + gained + '  ' + ctx.t({ en: 'Combo', ja: 'コンボ', es: 'Combo', 'pt-BR': 'Combo', fr: 'Combo', de: 'Combo', it: 'Combo', ko: '콤보', 'zh-Hans': '连击', tr: 'Kombo' }) + streak + '！');
              else ctx.setHint(ctx.t({ en: 'Sealed! +', ja: 'ふういん！ +', es: '¡Sellado! +', 'pt-BR': 'Selado! +', fr: 'Scellé ! +', de: 'Versiegelt! +', it: 'Sigillato! +', ko: '봉인! +', 'zh-Hans': '封印！+', tr: 'Mühürlendi! +' }) + gained);
              setYokaiVisible(yk, false);
              yk.respawnTimer = RESPAWN_DELAY;
              return;
            }
          }
        }
      }

      // ---- 本体判定（-1点＋加速して逃げる） ----
      var bodyHits = raycaster.intersectObjects(bodyMeshes, false);
      if (bodyHits.length > 0) {
        var hitBody = bodyHits[0].object;
        var bidx = bodyMeshes.indexOf(hitBody);
        if (bidx >= 0) {
          var yk2 = yokaiList[bidx];
          if (yk2.visible && yk2.respawnTimer <= 0) {
            // 本体タップはお手つき: -1点＋その妖怪が加速して鳥居へ急ぐ
            score = Math.max(0, score - 1);
            streak = 0;
            ctx.setScore(score);
            ctx.sfx.bounce();
            ctx.vibrate(10);
            yk2.speedMul = 1.8; // 加速して逃げ足が速くなる
            ctx.setHint(ctx.t({ en: 'Not the body! -1  Yokai speeds up!', ja: 'ほんたいはダメ！ -1  ようかいがにげる！', es: '¡No el cuerpo! -1  ¡El yokai acelera!', 'pt-BR': 'Não o corpo! -1  O yokai acelera!', fr: 'Pas le corps ! -1  Le yokai accélère !', de: 'Nicht den Körper! -1  Yokai beschleunigt!', it: 'Non il corpo! -1  Il yokai accelera!', ko: '본체는 안돼! -1  요괴가 도망간다!', 'zh-Hans': '别点本体！-1  妖怪加速逃跑！', tr: 'Gövdeye değil! -1  Yokai hızlanıyor!' }));
          }
        }
      }
    }
  });
})();
