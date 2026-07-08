/* =========================================================================
 * TMHeavySumo — じゅうきずもう
 * ルール: 重機を引っぱって離し、相手重機を円形フィールドの場外へ押し出す。
 * 操作: 引っぱって離す（パチンコ式）。
 * マッシュアップ肝: 車種（ダンプ/ホイールローダー/フォークリフト）で
 *   質量・摩擦係数・最大チャージ力が変わる＝戦略が変わる。
 * スコア: 連勝数（3本勝負を突破するたび+1）
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var ARENA_R = 5.5;        // 土俵半径
  var ARENA_Y = 0.05;       // 地面Y
  var MOVER_Y = 0.45;       // 重機中心Y
  var MAX_CHARGE = 26;      // 最大発射速度（滑走摩擦を dt 基準にしたため再調整）
  var FRICTION_AIR = 0.985; // 空中減速係数
  var BOUNCE = 0.3;         // 壁バウンス（場外判定前なので未使用だが念のため）

  /* ---------- 車種テーブル ---------- */
  var VEHICLES = [
    { label: { en: 'Dump Truck', ja: 'ダンプカー', es: 'Volquete', 'pt-BR': 'Caminhão Basculante', fr: 'Camion-benne', de: 'Kipplaster', it: 'Camion ribaltabile', ko: '덤프트럭', 'zh-Hans': '自卸车', tr: 'Damperli Kamyon' },
      key: 'dump',   mass: 3.0, friction: 0.16, power: 0.7,  color: 0xf4b400 },
    { label: { en: 'Wheel Loader', ja: 'ホイールローダー', es: 'Cargadora', 'pt-BR': 'Carregadeira', fr: 'Chargeuse', de: 'Radlader', it: 'Pala gommata', ko: '휠로더', 'zh-Hans': '装载机', tr: 'Yükleyici' },
      key: 'loader', mass: 1.8, friction: 0.11, power: 1.0,  color: 0xef7d21 },
    { label: { en: 'Forklift', ja: 'フォークリフト', es: 'Montacargas', 'pt-BR': 'Empilhadeira', fr: 'Chariot élévateur', de: 'Gabelstapler', it: 'Muletto', ko: '지게차', 'zh-Hans': '叉车', tr: 'Forklift' },
      key: 'fork',   mass: 1.0, friction: 0.07, power: 1.35, color: 0xd63b2f }
  ];

  /* ---------- AI レベルテーブル ---------- */
  var AI_LEVELS = [
    { accuracy: 0.45, power: 0.6, mass: 1.5, color: 0xd94a38 },
    { accuracy: 0.65, power: 0.8, mass: 2.0, color: 0xc62828 },
    { accuracy: 0.80, power: 1.0, mass: 2.5, color: 0x9f1d1d }
  ];

  /* ---------- Three.js オブジェクト（init で生成、以降再利用） ---------- */
  var arena, arenaEdge;
  var playerMesh, enemyMesh;
  var arrowLine; // 引っぱり方向表示（太矢印グループ）
  var arrowShaft, arrowHead, arrowMat;
  var playerVx, playerVz, enemyVx, enemyVz;
  var playerX, playerZ, enemyX, enemyZ;
  var playerSpec, enemySpec, aiLevel, _THREE;
  var streak;               // 勝ち抜きマッチ数(=スコア)
  var boutWins, aiBoutWins; // 現マッチ内の取得本数(2本先取)
  var gamePhase;   // 'choose' | 'idle' | 'moving' | 'result_bout' | 'ended'
  var dragStartNx, dragStartNy, dragging;
  var aiTimer, aiDelay;
  var boutResult; // 'player' | 'enemy'
  var coneMarkers = []; // 工事コーン（装飾）

  /* ---------- DOM UI ---------- */
  var uiChoose, uiBoutInfo;

  /* ---- 車のミニアイコン（CSS: 色付き矩形＋車輪丸。車種でシルエット差別化） ---- */
  function vehicleIconHTML(key) {
    var parts;
    if (key === 'dump') {
      // キャブ前方＋後ろ上がりの荷台
      parts =
        '<span style="position:absolute;right:2px;bottom:13px;width:10px;height:9px;background:#2b2b2b;border-radius:2px;"></span>' +
        '<span style="position:absolute;left:2px;bottom:13px;width:20px;height:7px;background:#2b2b2b;border-radius:2px;transform:rotate(-8deg);"></span>';
    } else if (key === 'loader') {
      // 後方キャブ＋前方バケット
      parts =
        '<span style="position:absolute;left:4px;bottom:13px;width:11px;height:9px;background:#2b2b2b;border-radius:2px;"></span>' +
        '<span style="position:absolute;right:0;bottom:5px;width:7px;height:10px;background:#2b2b2b;border-radius:1px 1px 3px 1px;"></span>';
    } else {
      // コンパクト車体＋縦マスト＋ツメ
      parts =
        '<span style="position:absolute;left:6px;bottom:13px;width:12px;height:9px;background:#2b2b2b;border-radius:2px;"></span>' +
        '<span style="position:absolute;right:8px;bottom:5px;width:3px;height:17px;background:#2b2b2b;"></span>' +
        '<span style="position:absolute;right:0;bottom:5px;width:9px;height:3px;background:#2b2b2b;"></span>';
    }
    return '<span style="position:relative;display:inline-block;width:38px;height:24px;vertical-align:-5px;margin-right:10px;">' +
      '<span style="position:absolute;left:0;bottom:5px;width:38px;height:9px;background:#2b2b2b;border-radius:3px;"></span>' +
      parts +
      '<span style="position:absolute;left:5px;bottom:0;width:10px;height:10px;background:#111;border:2px solid #444;border-radius:50%;box-sizing:border-box;"></span>' +
      '<span style="position:absolute;right:5px;bottom:0;width:10px;height:10px;background:#111;border:2px solid #444;border-radius:50%;box-sizing:border-box;"></span>' +
      '</span>';
  }

  function makeDom(ctx) {
    // 車種選択オーバーレイ
    uiChoose = document.createElement('div');
    uiChoose.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;',
      'background:rgba(0,0,0,0.72);display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;z-index:50;color:#fff;'
    ].join('');
    var title = document.createElement('div');
    title.textContent = ctx.t({ en: 'Choose your vehicle!', ja: '重機を選べ！', es: '¡Elige tu vehículo!', 'pt-BR': 'Escolha seu veículo!', fr: 'Choisissez votre véhicule!', de: 'Wähle dein Fahrzeug!', it: 'Scegli il tuo veicolo!', ko: '차종을 선택하라!', 'zh-Hans': '选择你的车辆！', tr: 'Aracını seç!' });
    title.style.cssText = 'font-size:1.4em;font-weight:bold;margin-bottom:16px;';
    uiChoose.appendChild(title);
    VEHICLES.forEach(function (v, i) {
      var btn = document.createElement('button');
      btn.innerHTML = vehicleIconHTML(v.key) + '<span>' + ctx.t(v.label) + '</span>';
      btn.style.cssText = [
        'display:flex;align-items:center;margin:6px 0;padding:10px 28px;font-size:1.1em;',
        'border:none;border-radius:8px;background:#', v.color.toString(16).padStart(6, '0'), ';',
        'color:#333;font-weight:bold;cursor:pointer;'
      ].join('');
      btn.dataset.idx = i;
      btn.addEventListener('click', function () {
        playerSpec = VEHICLES[parseInt(btn.dataset.idx)];
        uiChoose.style.display = 'none';
        gamePhase = 'idle';
        updateBoutInfo();
        // 選んだ車種の見た目に作り替える
        buildVehicleInto(_THREE, playerMesh, playerSpec.color, playerSpec.key);
      });
      uiChoose.appendChild(btn);
    });
    document.body.appendChild(uiChoose);
    uiChoose.style.display = 'none';

    // 勝数表示（★ピップ: 2本先取。左=自分(金) / 右=相手(赤)）
    uiBoutInfo = document.createElement('div');
    uiBoutInfo.style.cssText = [
      'position:fixed;top:54px;left:50%;transform:translateX(-50%);',
      'font-size:1.2em;color:#fff;text-shadow:0 1px 3px #000;z-index:11;',
      'pointer-events:none;letter-spacing:2px;'
    ].join('');
    document.body.appendChild(uiBoutInfo);
  }

  function setMeshColor(mesh, color) {
    mesh.traverse(function (child) {
      if (child.isMesh && child.material && child.userData.paint) child.material.color.setHex(color);
    });
  }

  function updateBoutInfo() {
    if (!uiBoutInfo) return;
    if (gamePhase === 'choose') { uiBoutInfo.innerHTML = ''; return; }
    // ★ピップ（2本先取）: テキストなしのノンバーバル表示
    function pips(n) { return ((n >= 1) ? '★' : '☆') + ((n >= 2) ? '★' : '☆'); }
    uiBoutInfo.innerHTML =
      '<span style="color:#ffd21c;">' + pips(boutWins || 0) + '</span>' +
      '<span style="margin:0 12px;opacity:.6;">·</span>' +
      '<span style="color:#ff6b5e;">' + pips(aiBoutWins || 0) + '</span>';
  }

  /* ---------- メッシュ生成（r128 プリミティブのみ） ---------- */
  // 車種ごとに見た目を作り分ける。既存グループ g を空にして作り直す（参照維持）。
  function buildVehicleInto(THREE, g, color, key) {
    for (var c = g.children.length - 1; c >= 0; c--) g.remove(g.children[c]);
    var bodyMat = Style.mat(color);
    var darkMat = Style.mat(0x333333);
    var windowMat = Style.mat(0x8fd3ff);
    var steelMat = Style.mat(0x9aa0a6);
    // 共通: キャタピラ＋転輪
    var trackL = new THREE.Mesh(Style.roundedBox(1.55, 0.26, 0.22), darkMat);
    trackL.position.set(0, 0.06, 0.46);
    var trackR = new THREE.Mesh(Style.roundedBox(1.55, 0.26, 0.22), darkMat);
    trackR.position.set(0, 0.06, -0.46);
    g.add(trackL, trackR);
    var wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10);
    [-0.55, 0, 0.55].forEach(function (wx) {
      [0.58, -0.58].forEach(function (wz) {
        var w = new THREE.Mesh(wheelGeo, Style.mat(0x555555));
        w.position.set(wx, 0.08, wz); w.rotation.x = Math.PI / 2; g.add(w);
      });
    });

    if (key === 'dump') {
      // ダンプカー: 前方に運転席、後方に大きな荷台（後ろ上がり）
      var dCab = new THREE.Mesh(Style.roundedBox(0.55, 0.5, 0.72), bodyMat);
      dCab.userData.paint = true; dCab.position.set(0.5, 0.55, 0); g.add(dCab);
      var dWin = new THREE.Mesh(Style.roundedBox(0.3, 0.26, 0.74), windowMat);
      dWin.position.set(0.62, 0.62, 0); g.add(dWin);
      var bedFloor = new THREE.Mesh(Style.roundedBox(1.0, 0.12, 0.78), darkMat);
      bedFloor.position.set(-0.35, 0.42, 0); bedFloor.rotation.z = 0.08; g.add(bedFloor);
      var bedBack = new THREE.Mesh(Style.roundedBox(0.12, 0.5, 0.78), bodyMat);
      bedBack.userData.paint = true; bedBack.position.set(-0.86, 0.62, 0); g.add(bedBack);
      [0.36, -0.36].forEach(function (bz) {
        var side = new THREE.Mesh(Style.roundedBox(1.0, 0.34, 0.06), bodyMat);
        side.userData.paint = true; side.position.set(-0.35, 0.55, bz); side.rotation.z = 0.08; g.add(side);
      });
      // 積み荷（土）
      var load = new THREE.Mesh(Style.roundedBox(0.8, 0.2, 0.62), Style.mat(0x6b4b1f));
      load.position.set(-0.4, 0.6, 0); g.add(load);

    } else if (key === 'loader') {
      // ホイールローダー: 後方運転席＋前方リフトアーム＋幅広バケット
      var lCab = new THREE.Mesh(Style.roundedBox(0.6, 0.55, 0.7), bodyMat);
      lCab.userData.paint = true; lCab.position.set(-0.45, 0.6, 0); g.add(lCab);
      var lWin = new THREE.Mesh(Style.roundedBox(0.34, 0.3, 0.72), windowMat);
      lWin.position.set(-0.3, 0.7, 0); g.add(lWin);
      var lBody = new THREE.Mesh(Style.roundedBox(0.7, 0.4, 0.72), bodyMat);
      lBody.userData.paint = true; lBody.position.set(0.15, 0.42, 0); g.add(lBody);
      [0.3, -0.3].forEach(function (az) {
        var arm = new THREE.Mesh(Style.roundedBox(0.95, 0.12, 0.1), steelMat);
        arm.position.set(0.6, 0.42, az); arm.rotation.z = -0.12; g.add(arm);
      });
      var lBucket = new THREE.Mesh(Style.roundedBox(0.32, 0.4, 0.9), steelMat);
      lBucket.position.set(1.12, 0.3, 0); g.add(lBucket);
      var lLip = new THREE.Mesh(Style.roundedBox(0.4, 0.08, 0.9), Style.mat(0x6a6f75));
      lLip.position.set(1.28, 0.14, 0); g.add(lLip);

    } else {
      // フォークリフト: コンパクト車体＋縦マスト＋2本のツメ
      var fCab = new THREE.Mesh(Style.roundedBox(0.7, 0.5, 0.66), bodyMat);
      fCab.userData.paint = true; fCab.position.set(-0.2, 0.55, 0); g.add(fCab);
      var fWin = new THREE.Mesh(Style.roundedBox(0.34, 0.3, 0.68), windowMat);
      fWin.position.set(-0.1, 0.68, 0); g.add(fWin);
      var roof = new THREE.Mesh(Style.roundedBox(0.66, 0.06, 0.66), darkMat);
      roof.position.set(-0.2, 0.98, 0); g.add(roof);
      [0.42, -0.42].forEach(function (rz) {
        var pillar = new THREE.Mesh(Style.roundedBox(0.05, 0.5, 0.05), darkMat);
        pillar.position.set(0.05, 0.75, rz); g.add(pillar);
      });
      // 縦マスト（前方）
      [0.18, -0.18].forEach(function (mz) {
        var mast = new THREE.Mesh(Style.roundedBox(0.08, 1.1, 0.08), steelMat);
        mast.position.set(0.5, 0.6, mz); g.add(mast);
      });
      // ツメ（フォーク）
      [0.18, -0.18].forEach(function (fz) {
        var fork = new THREE.Mesh(Style.roundedBox(0.7, 0.05, 0.1), Style.mat(0x2b2b2b));
        fork.position.set(0.85, 0.14, fz); g.add(fork);
      });
    }
    return g;
  }

  function makeVehicleMesh(THREE, color, key) {
    return buildVehicleInto(THREE, new THREE.Group(), color, key);
  }

  function makeCone(THREE) {
    var g = new THREE.Group();
    var orange = Style.mat(0xff6600);
    var white = Style.mat(0xffffff);
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 8), orange);
    cone.position.y = 0.2;
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8), white);
    base.position.y = 0.03;
    g.add(cone, base);
    return g;
  }

  /* ---------- 物理ヘルパー ---------- */
  function applyFriction(vx, vz, retentionPerSec, dt) {
    // dt 基準の指数減衰: 1秒後に retentionPerSec 倍まで減速（fps 非依存）
    var k = Math.pow(retentionPerSec, dt);
    return { vx: vx * k, vz: vz * k };
  }

  function isOutside(x, z) {
    return Math.sqrt(x * x + z * z) > ARENA_R + 0.3;
  }

  function resolveCollision(px, pz, pvx, pvz, pm, ex, ez, evx, evz, em) {
    // 弾性衝突（1D運動量交換 → 2Dベクトル版）
    var dx = ex - px, dz = ez - pz;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) { dx = 1; dz = 0; dist = 1; }
    var nx = dx / dist, nz = dz / dist;
    // 相対速度の法線成分
    var relV = (pvx - evx) * nx + (pvz - evz) * nz;
    if (relV <= 0) return null; // 離れる方向なら無視
    var e = 1.05; // 反発係数
    var impulse = (1 + e) * relV / (1 / pm + 1 / em) * 1.35;
    return {
      pvx: pvx - (impulse / pm) * nx,
      pvz: pvz - (impulse / pm) * nz,
      evx: evx + (impulse / em) * nx,
      evz: evz + (impulse / em) * nz
    };
  }

  /* ---------- AIターン ---------- */
  function triggerAI(ctx, ai) {
    // ターゲット: プレイヤーに向けてショット（accuracy で散布）
    var dx = playerX - enemyX;
    var dz = playerZ - enemyZ;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) { dx = 1; len = 1; }
    var scatter = (1 - ai.accuracy) * (Math.random() - 0.5) * 2;
    var angle = Math.atan2(dz, dx) + scatter * 0.8;
    var speed = MAX_CHARGE * 0.62 * ai.power * (0.55 + Math.random() * 0.4);
    enemyVx = Math.cos(angle) * speed;
    enemyVz = Math.sin(angle) * speed;
    ctx.sfx.tap();
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMHeavySumo',
    title: { en: 'Heavy Sumo', ja: 'じゅうきずもう', es: 'Sumo Pesado', 'pt-BR': 'Sumô Pesado', fr: 'Sumo Lourd', de: 'Schwer-Sumo', it: 'Sumo Pesante', ko: '중장비 스모', 'zh-Hans': '重机相扑', tr: 'Ağır Sumo' },
    howto: { en: 'Drag the arrow and release!\nPush your opponent out of the ring!\nVehicle type changes weight and speed!', ja: '太い矢印を引っぱって離そう。\n重機で相手を場外へ押し出そう。\n車種によって重さと速さが変わるよ。', es: '¡Arrastra la flecha y suelta!\n¡Empuja al oponente fuera del ring!\n¡El tipo de vehículo cambia peso y velocidad!', 'pt-BR': 'Arraste a seta e solte!\nEmpurre seu oponente para fora do ringue!\nO tipo de veículo muda peso e velocidade!', fr: 'Tirez la flèche et relâchez!\nPoussez l\'adversaire hors du ring!\nLe type de véhicule change poids et vitesse!', de: 'Pfeil ziehen und loslassen!\nGegner aus dem Ring drängen!\nFahrzeugtyp ändert Gewicht und Tempo!', it: 'Trascina la freccia e rilascia!\nSpingi l\'avversario fuori dal ring!\nIl tipo di veicolo cambia peso e velocità!', ko: '화살표를 드래그하고 놓아라!\n상대를 링 밖으로 밀어내라!\n차종에 따라 무게와 속도가 다르다!', 'zh-Hans': '拖动箭头并松开！\n把对手推出圈外！\n车型不同重量和速度也不同！', tr: 'Oku sürükle ve bırak!\nRakibini ringden dışarı it!\nAraç tipi ağırlık ve hızı değiştirir!' },
    scoreLabel: { en: 'wins', ja: '連勝', es: 'victorias', 'pt-BR': 'vitórias', fr: 'victoires', de: 'Siege', it: 'vittorie', ko: '연승', 'zh-Hans': '连胜', tr: 'galibiyet' },
    bg: 0xc8b09a,
    cameraFov: 55,
    cameraPos: [0, 10, 10],
    cameraLookAt: [0, 0, 0],
    fitWidth: 12.5,              // 縦画面でも全体が収まる

    init: function (ctx) {
      var THREE = ctx.THREE;

      // ===== 工事現場のフィールド =====
      // 土俵 = コンクリートの丸い基礎スラブ
      arena = new THREE.Mesh(
        new THREE.CylinderGeometry(ARENA_R, ARENA_R, 0.15, 32),
        Style.mat(0xb8b4ac)
      );
      arena.position.y = -0.075;
      ctx.scene.add(arena);

      // 縁 = 黄×黒の危険ストライプ（トラ柄セグメント）
      arenaEdge = new THREE.Mesh(
        new THREE.TorusGeometry(ARENA_R, 0.18, 8, 32),
        Style.mat(0xf4c400)
      );
      arenaEdge.rotation.x = Math.PI / 2;
      ctx.scene.add(arenaEdge);
      for (var st = 0; st < 12; st++) {
        var sa = (st / 12) * Math.PI * 2;
        var stripe = new THREE.Mesh(Style.roundedBox(0.5, 0.14, 0.4), Style.mat(0x222222));
        stripe.position.set(Math.cos(sa) * ARENA_R, 0.02, Math.sin(sa) * ARENA_R);
        stripe.rotation.y = -sa + Math.PI / 2;
        ctx.scene.add(stripe);
      }

      // 地面 = 掘り返した土
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        Style.mat(0x9a7a52)
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.16;
      ctx.scene.add(ground);
      // 轍(わだち)の跡
      for (var rt = 0; rt < 3; rt++) {
        var rut = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 14), Style.mat(0x846642));
        rut.rotation.x = -Math.PI / 2;
        rut.rotation.z = -0.5 + rt * 0.5;
        rut.position.set(-6 + rt * 6.5, -0.15, 7.5);
        ctx.scene.add(rut);
      }

      // バリケード（黄×黒しま板＋脚）×3
      function makeBarricade() {
        var bg = new THREE.Group();
        var board = new THREE.Mesh(Style.roundedBox(1.7, 0.4, 0.1), Style.mat(0xf4c400));
        board.position.y = 0.62;
        bg.add(board);
        for (var bs = 0; bs < 3; bs++) {
          var blk = new THREE.Mesh(Style.roundedBox(0.26, 0.42, 0.12), Style.mat(0x222222));
          blk.position.set(-0.55 + bs * 0.55, 0.62, 0.005);
          blk.rotation.z = 0.5;
          bg.add(blk);
        }
        var legGeo = Style.roundedBox(0.1, 0.66, 0.4);
        var legMat = Style.mat(0x8a8f96);
        var legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.7, 0.33, 0); bg.add(legL);
        var legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.7, 0.33, 0); bg.add(legR);
        return bg;
      }
      var barrAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.5];
      for (var ba = 0; ba < barrAngles.length; ba++) {
        var brc = makeBarricade();
        brc.position.set(Math.cos(barrAngles[ba]) * (ARENA_R + 2.6), 0, Math.sin(barrAngles[ba]) * (ARENA_R + 2.6));
        brc.rotation.y = -barrAngles[ba] + Math.PI / 2;
        ctx.scene.add(brc);
      }

      // 土の山（ダンプの積み荷風）×2
      var moundGeo = new THREE.SphereGeometry(1.2, 10, 8);
      for (var md = 0; md < 2; md++) {
        var mound = new THREE.Mesh(moundGeo, Style.mat(0x7a5c38));
        mound.scale.set(1.4, 0.55, 1.1);
        mound.position.set(md === 0 ? -(ARENA_R + 3.4) : (ARENA_R + 3.8), -0.1, md === 0 ? -3 : 2.4);
        ctx.scene.add(mound);
        // てっぺんにスコップ
        if (md === 0) {
          var shovelH = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 6), Style.mat(0x8a5f38));
          shovelH.position.set(mound.position.x, 0.75, mound.position.z);
          shovelH.rotation.z = 0.5;
          ctx.scene.add(shovelH);
        }
      }

      // 土管の山（3本ピラミッド）
      var pipeGeo = new THREE.CylinderGeometry(0.42, 0.42, 2.4, 14);
      var pipeMat = Style.mat(0x9aa4ae);
      var pipePos = [[-0.5, 0.42], [0.5, 0.42], [0, 1.14]];
      for (var pp = 0; pp < 3; pp++) {
        var pipe = new THREE.Mesh(pipeGeo, pipeMat);
        pipe.rotation.z = Math.PI / 2;
        pipe.rotation.y = Math.PI / 2;
        pipe.position.set((ARENA_R + 3.2) * 0.7 + pipePos[pp][0], pipePos[pp][1], -(ARENA_R + 2.2));
        ctx.scene.add(pipe);
      }

      // 工事コーン（土俵周囲に8個）
      for (var ci = 0; ci < 8; ci++) {
        var ang = (ci / 8) * Math.PI * 2;
        var cone = makeCone(THREE);
        cone.position.set(
          Math.cos(ang) * (ARENA_R + 1.2),
          0,
          Math.sin(ang) * (ARENA_R + 1.2)
        );
        ctx.scene.add(cone);
        coneMarkers.push(cone);
      }

      _THREE = THREE;
      // プレイヤー重機（デフォルトはダンプ、選択後に作り替え）
      playerMesh = makeVehicleMesh(THREE, VEHICLES[0].color, 'dump');
      ctx.scene.add(playerMesh);

      // 敵重機（開始時に車種ランダム化）
      enemyMesh = makeVehicleMesh(THREE, 0x88aacc, 'loader');
      ctx.scene.add(enemyMesh);

      // 引っぱり矢印（太いシャフト + 三角頭）
      arrowLine = new THREE.Group();
      arrowMat = new THREE.MeshBasicMaterial({ color: 0xffd21c, transparent: true, opacity: 0.9 });
      arrowShaft = new THREE.Mesh(Style.roundedBox(0.35, 0.12, 1), arrowMat);
      arrowShaft.position.z = 0.5;
      arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.75, 3), arrowMat);
      arrowHead.rotation.x = Math.PI / 2;
      arrowHead.position.z = 1.1;
      arrowLine.add(arrowShaft);
      arrowLine.add(arrowHead);
      arrowLine.visible = false;
      ctx.scene.add(arrowLine);

      makeDom();
    },

    start: function (ctx) {
      streak = 0; boutWins = 0; aiBoutWins = 0;
      playerSpec = null;
      aiLevel = AI_LEVELS[0];
      gamePhase = 'choose';
      dragging = false;
      dragStartNx = 0;
      dragStartNy = 0;

      // 初期位置
      playerX = 0; playerZ = 2.5;
      enemyX = 0; enemyZ = -2.5;
      playerVx = 0; playerVz = 0;
      enemyVx = 0; enemyVz = 0;
      aiTimer = 0;
      aiDelay = 1.5;
      boutResult = null;

      playerMesh.position.set(playerX, MOVER_Y, playerZ);
      playerMesh.rotation.y = 0;
      enemyMesh.position.set(enemyX, MOVER_Y, enemyZ);
      enemyMesh.rotation.y = Math.PI;
      arrowLine.visible = false;

      // 敵の車種をランダムに作り替え（見た目のバリエーション）
      enemySpec = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];
      buildVehicleInto(_THREE, enemyMesh, aiLevel.color, enemySpec.key);
      setMeshColor(enemyMesh, aiLevel.color);
      ctx.setScore(0);
      updateBoutInfo();

      // 車種選択UI表示
      uiChoose.style.display = 'flex';
      ctx.setHint(ctx.t({ en: 'Choose your vehicle', ja: '車種を選んでください', es: 'Elige tu vehículo', 'pt-BR': 'Escolha seu veículo', fr: 'Choisissez votre véhicule', de: 'Fahrzeug wählen', it: 'Scegli il veicolo', ko: '차종을 선택하세요', 'zh-Hans': '请选择车种', tr: 'Aracını seç' }));
    },

    onPointerDown: function (ctx, p) {
      if (gamePhase !== 'idle') return;
      var speed = Math.sqrt(playerVx * playerVx + playerVz * playerVz);
      if (speed > 0.3) return; // 動いている間は引けない
      dragging = true;
      dragStartNx = p.nx;
      dragStartNy = p.ny;
      arrowLine.visible = true;
    },

    onPointerMove: function (ctx, p) {
      if (!dragging || gamePhase !== 'idle') return;
      // 矢印更新（スクリーン座標→3D方向、地面上）
      var dx = -(p.nx - dragStartNx) * 8;
      var dz = (p.ny - dragStartNy) * 8;   // 下に引く→奥へ（スリングショット）
      var len = Math.sqrt(dx * dx + dz * dz);
      var showLen = Math.min(len * 0.65, 3.2);
      arrowLine.position.set(playerX, MOVER_Y + 0.35, playerZ);
      arrowLine.rotation.y = Math.atan2(dx, dz);
      arrowShaft.scale.z = Math.max(0.2, showLen);
      arrowShaft.position.z = showLen * 0.5;
      arrowHead.position.z = showLen + 0.32;
      var heat = Math.min(len / 3.6, 1);
      arrowMat.color.setRGB(1, 0.82 - heat * 0.55, 0.08);
    },

    onPointerUp: function (ctx, p) {
      if (!dragging || gamePhase !== 'idle') return;
      dragging = false;
      arrowLine.visible = false;
      var dx = -(p.nx - dragStartNx);
      var dz = (p.ny - dragStartNy);       // 下に引く→奥へ（スリングショット）
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.05) return;
      var maxPow = MAX_CHARGE * playerSpec.power;
      var speed = Math.min(len * 30, maxPow);
      playerVx = (dx / len) * speed;
      playerVz = (dz / len) * speed;
      gamePhase = 'moving';
      ctx.sfx.tap();
      ctx.vibrate(20);
    },

    update: function (ctx, dt) {
      if (gamePhase === 'choose' || gamePhase === 'ended') return;

      var playerFric = playerSpec ? playerSpec.friction : 0.12;
      var playerMass = playerSpec ? playerSpec.mass : 1.8;
      var aiMass = aiLevel.mass;

      if (gamePhase === 'idle') {
        // AIターンタイマー（プレイヤーが静止中）
        var pSpeed = Math.sqrt(playerVx * playerVx + playerVz * playerVz);
        if (pSpeed < 0.3) {
          aiTimer += dt;
          if (aiTimer > aiDelay) {
            aiTimer = 0;
            aiDelay = 1.2 + Math.random() * 0.8;
            var eSpeed = Math.sqrt(enemyVx * enemyVx + enemyVz * enemyVz);
            if (eSpeed < 0.3) {
              triggerAI(ctx, aiLevel);
            }
          }
        }
      }

      // 速度更新
      var pf = applyFriction(playerVx, playerVz, playerFric, dt);
      playerVx = pf.vx; playerVz = pf.vz;
      var ef = applyFriction(enemyVx, enemyVz, 0.12, dt);
      enemyVx = ef.vx; enemyVz = ef.vz;

      // 位置更新
      playerX += playerVx * dt;
      playerZ += playerVz * dt;
      enemyX += enemyVx * dt;
      enemyZ += enemyVz * dt;

      // 衝突判定（2体間距離 < 1.4）
      var cdx = enemyX - playerX, cdz = enemyZ - playerZ;
      var cdist = Math.sqrt(cdx * cdx + cdz * cdz);
      if (cdist < 1.4) {
        var res = resolveCollision(
          playerX, playerZ, playerVx, playerVz, playerMass,
          enemyX, enemyZ, enemyVx, enemyVz, aiMass
        );
        if (res) {
          playerVx = res.pvx; playerVz = res.pvz;
          enemyVx = res.evx; enemyVz = res.evz;
          // 分離
          var sep = (1.4 - cdist) / 2;
          var nx = cdx / (cdist || 1), nz = cdz / (cdist || 1);
          playerX -= nx * sep; playerZ -= nz * sep;
          enemyX += nx * sep; enemyZ += nz * sep;
          ctx.sfx.bounce();
          ctx.vibrate(15);
        }
      }

      // メッシュ更新
      playerMesh.position.set(playerX, MOVER_Y, playerZ);
      enemyMesh.position.set(enemyX, MOVER_Y, enemyZ);

      // 向き更新
      var psTotal = Math.sqrt(playerVx * playerVx + playerVz * playerVz);
      if (psTotal > 0.5) playerMesh.rotation.y = -Math.atan2(playerVx, playerVz);
      var esTotal = Math.sqrt(enemyVx * enemyVx + enemyVz * enemyVz);
      if (esTotal > 0.5) enemyMesh.rotation.y = -Math.atan2(enemyVx, enemyVz);

      // 場外判定（result_bout 中は再判定しない: 毎フレーム加算バグ防止）
      var playerOut = isOutside(playerX, playerZ);
      var enemyOut = isOutside(enemyX, enemyZ);
      if (gamePhase !== 'result_bout' && (playerOut || enemyOut)) {
        boutResult = enemyOut ? 'player' : 'enemy';
        gamePhase = 'result_bout';
        ctx.sfx[boutResult === 'player' ? 'score' : 'fail']();
        ctx.vibrate(boutResult === 'player' ? 40 : 80);

        if (boutResult === 'player') boutWins++; else aiBoutWins++;
        updateBoutInfo();

        // 2本先取でマッチ決着
        if (boutWins >= 2) {
          // マッチ勝利 → 連勝+1・次のAIへ
          streak++;
          ctx.setScore(streak);
          var nextIdx = Math.min(AI_LEVELS.indexOf(aiLevel) + 1, AI_LEVELS.length - 1);
          aiLevel = AI_LEVELS[nextIdx];
          setMeshColor(enemyMesh, aiLevel.color);
          boutWins = 0; aiBoutWins = 0;
          ctx.setHint(ctx.t({ en: 'Win streak! Next opponent!', ja: '勝ち抜き！次の相手だ！', es: '¡Racha ganadora! ¡Siguiente rival!', 'pt-BR': 'Sequência de vitórias! Próximo oponente!', fr: 'Série de victoires! Prochain adversaire!', de: 'Siegesserie! Nächster Gegner!', it: 'Serie di vittorie! Prossimo avversario!', ko: '연승! 다음 상대다!', 'zh-Hans': '连胜！下一个对手！', tr: 'Galibiyet serisi! Sonraki rakip!' }));
        } else if (aiBoutWins >= 2) {
          // マッチ敗北 → ゲームオーバー
          ctx.setHint(ctx.t({ en: 'Defeated…', ja: 'まけた…', es: 'Derrotado…', 'pt-BR': 'Derrotado…', fr: 'Défaite…', de: 'Besiegt…', it: 'Sconfitto…', ko: '졌다…', 'zh-Hans': '输了…', tr: 'Yenildin…' }));
          setTimeout(function () { ctx.gameOver(streak); }, 1200);
          gamePhase = 'ended';
          return;
        }

        // 1秒後にリセット
        setTimeout(function () {
          if (gamePhase !== 'ended') {
            playerX = 0; playerZ = 2.5;
            enemyX = 0; enemyZ = -2.5;
            playerVx = 0; playerVz = 0;
            enemyVx = 0; enemyVz = 0;
            aiTimer = 0;
            gamePhase = 'idle';
            ctx.setHint(ctx.t({ en: 'Drag and release!', ja: '引っぱって離す！', es: '¡Arrastra y suelta!', 'pt-BR': 'Arraste e solte!', fr: 'Tirez et relâchez!', de: 'Ziehen und loslassen!', it: 'Trascina e rilascia!', ko: '드래그하고 놓아라!', 'zh-Hans': '拖动并松开！', tr: 'Sürükle ve bırak!' }));
          }
        }, 1000);
        return;
      }

      // 静止したらidleへ
      var totalSpeed = psTotal + Math.sqrt(enemyVx * enemyVx + enemyVz * enemyVz);
      if (gamePhase === 'moving' && totalSpeed < 0.4) {
        gamePhase = 'idle';
        ctx.setHint(ctx.t({ en: 'Pull back & release!', ja: '引っぱって離す！', es: '¡Tira y suelta!', 'pt-BR': 'Puxe e solte!', fr: 'Tirez et lâchez !', de: 'Zurückziehen & loslassen!', it: 'Tira e rilascia!', ko: '당겼다 놓기!', 'zh-Hans': '拉动后松开！', tr: 'Çek ve bırak!' }));
      }
    }
  });
})();
