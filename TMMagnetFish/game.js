/* =========================================================================
 * TMMagnetFish — ちんぼつ船サルベージ（旧：じしゃくつり）
 * 設定: 横視点の海。サルベージ船のクレーンから磁石を海中へ降ろし、
 *       海底の沈没船まわりのお宝（ガラクタ・錨・宝箱・金庫）に吸着して
 *       引き上げる。ワイヤー・磁石・お宝・水面が常に1画面で見える。
 * ルール: 吸着後は「張力ゲージ」が揺れ続け、緑ゾーンの間だけ長押しで
 *         巻き上げできる。赤で握ると落とす。重い物ほど高得点だが
 *         ゲージが激しく暴れる。金庫は「大物チャンス」の一発逆転枠。
 * 操作: タップで磁石を投下 → 吸着後は長押しで巻き上げ（緑ゾーン中のみ）
 * スコア: 点数（60秒）
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  var PLAY_TIME = 60;      // プレイ時間(秒)
  var CRANE_X = 0;         // クレーン固定X
  var CRANE_Y = 6;         // クレーン高さ
  var CABLE_MAX = 7;       // ケーブル最大長
  var GREEN_MIN = 0.35;    // ゲージ緑ゾーン下限
  var GREEN_MAX = 0.65;    // ゲージ緑ゾーン上限

  /* ---- ゲームオブジェクト参照 ---- */
  var craneMesh, magnetMesh, cableMesh;
  var riverMesh, bridgeMesh;
  var itemMeshes = []; // プール
  var itemData = [];   // 各アイテムの状態
  var foamMeshes = []; // 水面の泡（うねり予兆の波立ち演出用）

  /* ---- DOM UI ---- */
  var tensionBg, tensionBar, tensionMarker, timerDiv;

  /* ---- 状態変数 ---- */
  var phase;       // 'idle' | 'falling' | 'attached' | 'lifting' | 'done'
  var cableLen;    // 現在のケーブル長
  var magnetY;     // 磁石Y位置
  var attachedIdx; // 吸着中アイテムのインデックス(-1=なし)
  var tension;     // 糸の張力 0..1（1.0で切れる。低い＝安全）
  var tensionVel;  // （旧・未使用）
  var surgeTimer;  // 潮のうねり周期タイマー
  var isHolding;   // 長押し中フラグ
  var timeLeft;    // 残り時間
  var liftProgress; // 巻き上げ進捗 0..1
  var animT;       // 演出用経過時間
  var surgeAmp;    // うねり演出の強さ 0..1（0=なし）
  var dropIdx;     // 糸切れで落下中のアイテム(-1=なし)
  var dropT;       // 落下経過時間
  var cableSwingT; // 糸切れ後のケーブルぶらぶら残り時間

  /* ---- アイテム定義(重さ=得点=ゲージ暴れ量) ---- */
  var ITEM_DEFS = [
    { name: 'ガラクタ', pts: 10,  wobble: 0.5, big: false },
    { name: 'いかり',   pts: 30,  wobble: 1.0, big: false },
    { name: 'たからばこ', pts: 60, wobble: 1.4, big: false },
    { name: 'きんこ',   pts: 120, wobble: 2.0, big: true }  // 大物チャンス（一発逆転）
  ];

  /* ---- アイテム4種の造形（1グループ=4バリアント切替） ---- */
  function buildItemVariants(THREE, group) {
    // [0] 鍋: 銀の胴 + 縁 + 両取っ手 + 蓋つまみ
    var pot = new THREE.Group();
    var potBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 0.42, 14), Style.mat(0x9aa2aa));
    pot.add(potBody);
    var potRim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 8, 16), Style.mat(0x7a828a));
    potRim.rotation.x = Math.PI / 2; potRim.position.y = 0.21; pot.add(potRim);
    var hL = new THREE.Mesh(Style.roundedBox(0.16, 0.08, 0.3), Style.mat(0x555c62));
    hL.position.set(-0.5, 0.08, 0); pot.add(hL);
    var hR = new THREE.Mesh(Style.roundedBox(0.16, 0.08, 0.3), Style.mat(0x555c62));
    hR.position.set(0.5, 0.08, 0); pot.add(hR);
    var knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), Style.mat(0x555c62));
    knob.position.y = 0.3; pot.add(knob);
    group.add(pot);

    // [1] 錨（いかり）: 鉄色のシャンク + 上部リング + ストック横木 + 両フルーク
    var anchor = new THREE.Group();
    var ironMat = Style.mat(0x475059);
    var shank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 10), ironMat);
    shank.position.y = 0.02; anchor.add(shank);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 8, 14), ironMat);
    ring.position.y = 0.42; anchor.add(ring);
    var stock = new THREE.Mesh(Style.roundedBox(0.5, 0.06, 0.06), ironMat);
    stock.position.y = 0.24; anchor.add(stock);
    // フルーク（下部の湾曲した爪）＝半トーラスの下半分を左右に
    var crown = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.06, 8, 16, Math.PI), ironMat);
    crown.rotation.z = Math.PI;               // 下向きの弧
    crown.position.y = -0.33; anchor.add(crown);
    var flukeL = new THREE.Mesh(Style.roundedBox(0.16, 0.06, 0.08), ironMat);
    flukeL.position.set(-0.26, -0.28, 0); flukeL.rotation.z = 0.7; anchor.add(flukeL);
    var flukeR = new THREE.Mesh(Style.roundedBox(0.16, 0.06, 0.08), ironMat);
    flukeR.position.set(0.26, -0.28, 0); flukeR.rotation.z = -0.7; anchor.add(flukeR);
    group.add(anchor);

    // [2] 宝箱: 茶の箱 + 金帯 + 金の錠前
    var chest = new THREE.Group();
    var cBody = new THREE.Mesh(Style.roundedBox(0.8, 0.5, 0.55), Style.mat(0x8a5a2a));
    chest.add(cBody);
    var cLid = new THREE.Mesh(Style.roundedBox(0.82, 0.2, 0.57), Style.mat(0x9a6a36));
    cLid.position.y = 0.33; chest.add(cLid);
    var cBand = new THREE.Mesh(Style.roundedBox(0.2, 0.72, 0.58),
      new THREE.MeshPhongMaterial({ color: 0xd8b64a, shininess: 80 }));
    cBand.position.y = 0.05; chest.add(cBand);
    var cLock = new THREE.Mesh(Style.roundedBox(0.16, 0.18, 0.1),
      new THREE.MeshPhongMaterial({ color: 0xffd21c, shininess: 90 }));
    cLock.position.set(0, 0.05, 0.32); chest.add(cLock);
    group.add(chest);

    // [3] 金庫: 黒鉄の箱 + 銀ダイヤル + ハンドル
    var safe = new THREE.Group();
    var sBody = new THREE.Mesh(Style.roundedBox(0.85, 0.85, 0.7), Style.mat(0x3c4046));
    safe.add(sBody);
    var dial = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12),
      new THREE.MeshPhongMaterial({ color: 0xc4cad2, shininess: 90 }));
    dial.rotation.x = Math.PI / 2; dial.position.set(-0.15, 0.08, 0.38); safe.add(dial);
    var handle = new THREE.Mesh(Style.roundedBox(0.06, 0.3, 0.06), Style.mat(0xc4cad2));
    handle.position.set(0.22, 0, 0.38); safe.add(handle);
    group.add(safe);
  }

  /* ---- アイテムプール初期化 ---- */
  function initItems(THREE, scene) {
    var N = 8;
    for (var i = 0; i < N; i++) {
      var g = new THREE.Group();
      buildItemVariants(THREE, g);
      g.visible = false;
      scene.add(g);
      itemMeshes.push(g);
      itemData.push({ defIdx: 0, x: 0, y: 0, speed: 0, visible: false, lifted: false });
    }
  }

  /* ---- アイテムを川にスポーン ---- */
  function spawnItem(idx) {
    var defIdx = Math.floor(Math.random() * ITEM_DEFS.length);
    var def = ITEM_DEFS[defIdx];
    var d = itemData[idx];
    d.defIdx = defIdx;
    d.x = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 4); // 左右から流入
    d.y = -1.25 - Math.random() * 0.25; // 海底付近（磁石の届く範囲）
    d.speed = (d.x < 0 ? 1 : -1) * (0.35 + Math.random() * 0.7);      // ゆるい潮の流れ
    d.lifted = false;
    d.visible = true;

    var mesh = itemMeshes[idx];
    for (var v = 0; v < mesh.children.length; v++) mesh.children[v].visible = (v === defIdx);
    mesh.visible = true;
    mesh.position.set(d.x, d.y, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
  }

  /* ---- ケーブル更新（LineSegments的なもの → BoxGeometry で代替） ---- */
  function updateCable(THREE) {
    // ケーブルは細いBoxを伸縮させる
    var len = Math.max(0.01, CRANE_Y - magnetY);
    cableMesh.scale.y = len;
    cableMesh.position.y = CRANE_Y - len / 2;
    magnetMesh.position.y = magnetY;
  }

  /* ---- DOM UI 作成 ---- */
  function buildDOM() {
    // 張力ゲージ背景
    tensionBg = document.createElement('div');
    tensionBg.style.cssText = [
      'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);',
      'width:60vw;height:18px;background:rgba(0,0,0,.3);border-radius:9px;',
      'z-index:11;display:none;overflow:hidden;'
    ].join('');

    // 赤ゾーン（全体）
    var redLeft = document.createElement('div');
    redLeft.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;background:#e53935;';
    tensionBg.appendChild(redLeft);

    // 緑ゾーン（左＝低張力＝安全。右へ行くほど危険＝糸が切れる）
    var greenZone = document.createElement('div');
    greenZone.style.cssText = [
      'position:absolute;top:0;left:0;height:100%;width:62%;',
      'background:linear-gradient(90deg,#43a047,#8fce46);'
    ].join('');
    tensionBg.appendChild(greenZone);

    // テンションマーカー（三角マーカー）
    tensionMarker = document.createElement('div');
    tensionMarker.style.cssText = [
      'position:absolute;top:-4px;width:8px;height:26px;',
      'background:#fff;border-radius:2px;transform:translateX(-50%);',
      'transition:none;'
    ].join('');
    tensionBg.appendChild(tensionMarker);

    document.body.appendChild(tensionBg);

    // タイマー
    timerDiv = document.createElement('div');
    timerDiv.style.cssText = [
      'position:fixed;top:12px;right:16px;font-size:22px;font-weight:bold;',
      'color:#fff;text-shadow:0 1px 4px #000;z-index:11;display:none;'
    ].join('');
    document.body.appendChild(timerDiv);
  }

  /* ---- テンションゲージ表示 ---- */
  function updateTensionUI() {
    tensionMarker.style.left = (tension * 100) + '%';
  }

  Shell.registerGame({
    id: 'TMMagnetFish',
    title: { en: 'Salvage Ship', ja: 'ちんぼつ船サルベージ', es: 'Barco Rescatador', 'pt-BR': 'Salvamento Naval', fr: 'Navire Salvage', de: 'Bergungsschiff', it: 'Nave Salvataggio', ko: '해저 인양선', 'zh-Hans': '打捞船', tr: 'Kurtarma Gemisi' },
    howto: { en: 'Drop the magnet from the crane!\nHold while gauge is green to lift!\nHeavier treasure = more points!', ja: 'サルベージ船から じしゃくを 海へおろす！\nゲージが みどりの間 長おしで まきあげ！\nおもい おたからほど 高とくてん・金庫は大物！', es: '¡Suelta el imán desde la grúa!\n¡Mantén pulsado en verde para subir!\n¡Más pesado = más puntos!', 'pt-BR': 'Solte o ímã da grua!\nSegure com o medidor verde para içar!\nMais pesado = mais pontos!', fr: 'Lâchez l\'aimant depuis la grue !\nMaintenez en vert pour remonter !\nPlus lourd = plus de points !', de: 'Lass den Magneten fallen!\nHalte bei Grün zum Hochziehen!\nSchwerer = mehr Punkte!', it: 'Lascia cadere la calamita!\nTieni premuto nel verde per sollevare!\nPiù pesante = più punti!', ko: '크레인에서 자석을 내려!\n게이지 초록일 때 길게 눌러 인양!\n무거울수록 고득점!', 'zh-Hans': '从起重机放下磁铁！\n表盘绿色时长按提升！\n越重越高分！', tr: 'Vinci den mıknatısı bırak!\nYeşil gösterge sırasında basılı tut!\nAğır = yüksek puan!' },
    scoreLabel: { en: 'pts', ja: 'てん', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pti', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0x9ecbe8,
    cameraFov: 55,
    cameraPos: [0, 3, 14],
    cameraLookAt: [0, 0.8, 0],
    fitWidth: 9,

    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;

      /* ---- 背景：横視点の海（空 / 水面 / 深い海 / 海底） ---- */
      var seaTop = 2.6, seaBottom = -7.4;
      // 水中グラデーション（上=明るい浅瀬 / 下=暗い深海）を1枚の縦板で表現
      var wcv = document.createElement('canvas');
      wcv.width = 8; wcv.height = 256;
      var wc = wcv.getContext('2d');
      var wgrd = wc.createLinearGradient(0, 0, 0, 256);
      wgrd.addColorStop(0, '#6fc4e0');    // 水面直下（明るい）
      wgrd.addColorStop(0.45, '#2f7fb8');
      wgrd.addColorStop(1, '#0f3a5f');    // 深海（暗い）
      wc.fillStyle = wgrd; wc.fillRect(0, 0, 8, 256);
      riverMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(44, seaTop - seaBottom),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(wcv) })
      );
      riverMesh.position.set(0, (seaTop + seaBottom) / 2, -1.4);
      scene.add(riverMesh);

      // 水面ライン（明るい帯＋泡のふくらみ）
      var surf = new THREE.Mesh(
        new THREE.PlaneGeometry(44, 0.5),
        new THREE.MeshBasicMaterial({ color: 0xbfeefb, transparent: true, opacity: 0.85 })
      );
      surf.position.set(0, seaTop, -1.3);
      scene.add(surf);
      var foamMat = new THREE.MeshBasicMaterial({ color: 0xecfaff });
      for (var wv = 0; wv < 13; wv++) {
        var foam = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), foamMat);
        foam.scale.set(1, 0.5, 0.5);
        foam.position.set(-10.5 + wv * 1.75, seaTop + 0.02, -1.25);
        scene.add(foam);
        foamMeshes.push({ mesh: foam, baseY: seaTop + 0.02 });
      }

      // 海底（砂）＋小石・海藻
      var seabed = new THREE.Mesh(Style.roundedBox(44, 1.4, 3, 0.2), Style.mat(0xe0cd94));
      seabed.position.set(0, -2.35, -0.6);
      scene.add(seabed);
      var rockMat = Style.mat(0x8f9aa0);
      for (var rk2 = 0; rk2 < 5; rk2++) {
        var rock = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), rockMat);
        rock.scale.set(1, 0.6, 0.8);
        rock.position.set(-8 + rk2 * 4 + (rk2 % 2), -1.78, -0.35);
        scene.add(rock);
      }
      var weedMat = Style.mat(0x2f9e6a);
      for (var wd = 0; wd < 3; wd++) {
        var weed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 1.1, 6), weedMat);
        weed.position.set(-6.5 + wd * 6, -1.35, -0.45);
        scene.add(weed);
      }

      // 沈没船（海底に横たわる壊れた木の船体）
      var wreck = new THREE.Group();
      var wreckMat = Style.mat(0x6a4a2c);
      var wreckDark = Style.mat(0x4e3620);
      var hull = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 0.6, 4.2, 14, 1, false, 0, Math.PI), wreckMat);
      hull.rotation.z = Math.PI / 2;            // 横倒しの半円筒＝船腹
      wreck.add(hull);
      var deck = new THREE.Mesh(Style.roundedBox(4.2, 0.25, 1.6), wreckDark);
      deck.position.y = 0.02; wreck.add(deck);
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.2, 8), wreckDark);
      mast.position.set(-0.5, 0.95, 0); mast.rotation.z = 0.5; wreck.add(mast);  // 折れたマスト
      for (var ph = 0; ph < 3; ph++) {          // 舷側の穴
        var hole = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), Style.mat(0x160f08));
        hole.position.set(-1.2 + ph * 1.1, 0.05, 0.82);
        wreck.add(hole);
      }
      wreck.position.set(-1.4, -1.55, -1.9);
      wreck.rotation.z = 0.12;                  // 少し傾けて座礁感
      scene.add(wreck);

      /* ---- サルベージ船（水面に浮かぶ本体＋クレーン） ---- */
      var woodMat = Style.mat(0xb0562f);        // 船体（赤茶）
      var steelMat = Style.mat(0xf0a13a);       // クレーン鉄骨（黄）
      bridgeMesh = new THREE.Group();
      var shipHull = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.0, 4.6, 16, 1, false, 0, Math.PI), woodMat);
      shipHull.rotation.z = -Math.PI / 2;       // 船腹（下向きの半円筒）
      shipHull.position.set(-0.6, 2.35, 0);
      bridgeMesh.add(shipHull);
      var shipDeck = new THREE.Mesh(Style.roundedBox(4.8, 0.3, 2.0), Style.mat(0xd8703f));
      shipDeck.position.set(-0.6, 2.72, 0); bridgeMesh.add(shipDeck);
      var cabin = new THREE.Mesh(Style.roundedBox(1.2, 0.9, 1.2), Style.mat(0xf2f2f2));
      cabin.position.set(-2.1, 3.32, 0); bridgeMesh.add(cabin);
      var cabinWin = new THREE.Mesh(Style.roundedBox(0.7, 0.4, 0.06), Style.mat(0x2c4a63));
      cabinWin.position.set(-2.1, 3.42, 0.62); bridgeMesh.add(cabinWin);
      // クレーン：垂直支柱＋水平ブーム（先端が x=0 の真上）＋すじかい
      var mastV = new THREE.Mesh(Style.roundedBox(0.32, 3.7, 0.32), steelMat);
      mastV.position.set(-1.5, 4.7, 0); bridgeMesh.add(mastV);
      var boom = new THREE.Mesh(Style.roundedBox(2.7, 0.3, 0.3), steelMat);
      boom.position.set(-0.35, 6.1, 0); bridgeMesh.add(boom);
      var brace = new THREE.Mesh(Style.roundedBox(0.16, 2.0, 0.16), steelMat);
      brace.rotation.z = -0.7; brace.position.set(-0.95, 5.5, 0); bridgeMesh.add(brace);
      scene.add(bridgeMesh);

      // クレーン先端の梁＋滑車（ケーブルが出る所, x=0 の真上）
      craneMesh = new THREE.Mesh(Style.roundedBox(0.5, 0.3, 0.36), steelMat);
      craneMesh.position.set(CRANE_X, CRANE_Y, 0);
      scene.add(craneMesh);
      var pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 14),
        new THREE.MeshPhongMaterial({ color: 0xe05050, shininess: 60 }));
      pulley.rotation.x = Math.PI / 2;
      pulley.position.set(CRANE_X, CRANE_Y - 0.24, 0);
      scene.add(pulley);

      // 操作うさぎ（船の甲板で見守る）
      if (window.GameBunny) {
        var bunny = GameBunny.make(THREE, { scale: 0.8 });
        bunny.group.position.set(1.1, 2.95, 0.4);
        bunny.group.rotation.y = -0.4;
        scene.add(bunny.group);
      }

      // 前面の水中トーン（うっすら青みで水中感・深度演出。海面より下だけ）
      var tint = new THREE.Mesh(
        new THREE.PlaneGeometry(44, seaTop - seaBottom),
        new THREE.MeshBasicMaterial({ color: 0x2a8fce, transparent: true, opacity: 0.13, depthWrite: false })
      );
      tint.position.set(0, (seaTop + seaBottom) / 2, 2.2);
      scene.add(tint);

      // ケーブル（細いBox）
      cableMesh = new THREE.Mesh(
        Style.roundedBox(0.08, 1, 0.08),
        Style.mat(0x222222)
      );
      cableMesh.position.set(CRANE_X, CRANE_Y - 0.5, 0);
      scene.add(cableMesh);

      // 磁石: 馬蹄形（半トーラスの曲がり＋赤い腕＋白い先端）
      magnetMesh = new THREE.Group();
      var magMat = new THREE.MeshPhongMaterial({ color: 0xd83a2e, shininess: 55 });
      var bend = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.13, 10, 14, Math.PI), magMat);
      bend.position.y = 0.05;
      magnetMesh.add(bend);
      var armGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.4, 10);
      var armL = new THREE.Mesh(armGeo, magMat);
      armL.position.set(-0.32, -0.15, 0); magnetMesh.add(armL);
      var armR = new THREE.Mesh(armGeo, magMat);
      armR.position.set(0.32, -0.15, 0); magnetMesh.add(armR);
      var tipGeo = new THREE.CylinderGeometry(0.135, 0.135, 0.16, 10);
      var tipMat = new THREE.MeshPhongMaterial({ color: 0xf2f2f2, shininess: 70 });
      var tipL = new THREE.Mesh(tipGeo, tipMat);
      tipL.position.set(-0.32, -0.42, 0); magnetMesh.add(tipL);
      var tipR = new THREE.Mesh(tipGeo, tipMat);
      tipR.position.set(0.32, -0.42, 0); magnetMesh.add(tipR);
      magnetMesh.position.set(CRANE_X, CRANE_Y, 0);
      scene.add(magnetMesh);

      // アイテムプール
      initItems(THREE, scene);

      // DOM UI
      buildDOM();
    },

    start: function (ctx) {
      phase = 'idle';
      cableLen = 0;
      magnetY = CRANE_Y;
      attachedIdx = -1;
      tension = 0.5;
      tensionVel = 0;
      isHolding = false;
      timeLeft = PLAY_TIME;
      liftProgress = 0;
      animT = 0;
      surgeAmp = 0;
      dropIdx = -1;
      dropT = 0;
      cableSwingT = 0;
      cableMesh.rotation.z = 0;
      cableMesh.position.x = CRANE_X;
      magnetMesh.position.x = CRANE_X;

      // アイテム初期化
      for (var i = 0; i < itemMeshes.length; i++) {
        itemMeshes[i].visible = false;
        itemData[i].visible = false;
        itemData[i].lifted = false;
      }
      // 最初の数個をスポーン
      for (var j = 0; j < 5; j++) spawnItem(j);

      magnetMesh.position.set(CRANE_X, CRANE_Y, 0);
      cableMesh.position.set(CRANE_X, CRANE_Y - 0.01, 0);
      cableMesh.scale.y = 0.01;

      tensionBg.style.display = 'none';
      timerDiv.style.display = '';
      timerDiv.textContent = String(PLAY_TIME); // 数字のみ（言語非依存）

      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Tap to drop the magnet!', ja: 'タップで磁石をおとそう！', es: '¡Toca para soltar el imán!', 'pt-BR': 'Toque para soltar o ímã!', fr: 'Touchez pour lâcher l\'aimant !', de: 'Tippe zum Fallen lassen!', it: 'Tocca per far cadere la calamita!', ko: '탭해서 자석을 내려！', 'zh-Hans': '点击放下磁铁！', tr: 'Mıknatısı bırakmak için dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (phase === 'idle') {
        // 磁石を投下（ケーブル長をリセットしてから伸ばす）
        phase = 'falling';
        cableLen = 0;
        magnetY = CRANE_Y;
        ctx.sfx.tap();
        ctx.setHint(ctx.t({ en: 'Get the magnet close to treasure!', ja: 'お宝に磁石を近づけろ！', es: '¡Acerca el imán al tesoro!', 'pt-BR': 'Aproxime o ímã do tesouro!', fr: 'Approchez l\'aimant du trésor !', de: 'Magnet nah am Schatz!', it: 'Avvicina la calamita al tesoro!', ko: '자석을 보물에 가까이!', 'zh-Hans': '让磁铁靠近宝物！', tr: 'Mıknatısı hazineye yaklaştır!' }));
        tensionBg.style.display = 'none';
      } else if (phase === 'attached') {
        // 長押し開始→巻き上げ試みフラグ
        isHolding = true;
      }
    },

    onPointerUp: function (ctx, p) {
      isHolding = false;
    },

    update: function (ctx, dt) {
      // タイマー
      timeLeft -= dt;
      animT += dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        timerDiv.textContent = '0';
        tensionBg.style.display = 'none';
        ctx.endGame(ctx.score);
        return;
      }
      timerDiv.textContent = String(Math.ceil(timeLeft));

      // アイテムを川で流す
      for (var i = 0; i < itemData.length; i++) {
        var d = itemData[i];
        if (!d.visible || d.lifted) continue;
        d.x += d.speed * dt;
        // 画面外に出たら反対側から再スポーン
        if (Math.abs(d.x) > 9) {
          spawnItem(i);
        } else {
          itemMeshes[i].position.x = d.x;
        }
      }

      // アイテムが少ない場合スポーン補充
      var visCount = 0;
      for (var vi = 0; vi < itemData.length; vi++) {
        if (itemData[vi].visible && !itemData[vi].lifted) visCount++;
      }
      if (visCount < 3) {
        for (var si = 0; si < itemData.length; si++) {
          if (!itemData[si].visible) { spawnItem(si); break; }
        }
      }

      surgeAmp = 0; // attached フェーズ以外はうねり演出なし

      /* ---- フェーズ処理 ---- */
      if (phase === 'falling') {
        // 磁石を下降
        cableLen = Math.min(cableLen + dt * 3.5, CABLE_MAX);
        magnetY = CRANE_Y - cableLen;
        updateCable(ctx.THREE);

        // 吸着判定
        var bestDist = 0.9, bestIdx = -1;
        for (var ci = 0; ci < itemData.length; ci++) {
          var cd = itemData[ci];
          if (!cd.visible || cd.lifted) continue;
          var dx = cd.x - CRANE_X;
          var dy = cd.y - magnetY;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestDist) { bestDist = dist; bestIdx = ci; }
        }
        if (bestIdx >= 0) {
          attachedIdx = bestIdx;
          itemData[bestIdx].lifted = true;
          phase = 'attached';
          tension = 0.2;                 // 低張力（安全）から開始
          surgeTimer = 2.4 + Math.random() * 1.8;
          var def = ITEM_DEFS[itemData[bestIdx].defIdx];
          tensionBg.style.display = '';
          ctx.sfx.bounce(); // ガチン音の代わり
          if (def.big) {
            ctx.sfx.success();
            ctx.vibrate([40, 40, 60]);
            ctx.setHint(ctx.t({ en: '★Big catch! Safe is super heavy! Watch the line!', ja: '★大物チャンス！金庫は超重量！糸に注意！', es: '★¡Gran captura! ¡La caja fuerte pesa mucho! ¡Cuidado!', 'pt-BR': '★Grande captura! Cofre muito pesado! Cuidado!', fr: '★Grosse prise ! Le coffre est très lourd ! Attention !', de: '★Große Beute! Der Safe ist schwer! Vorsicht!', it: '★Grande preda! La cassaforte è pesante! Attenzione!', ko: '★대물 찬스! 금고는 초중량! 줄 조심!', 'zh-Hans': '★大物机会！保险箱超重！注意线！', tr: '★Büyük av! Kasa çok ağır! İple dikkat!' }));
          } else {
            ctx.vibrate(30);
            ctx.setHint(ctx.t({ en: 'Hold to reel up! Red gauge = line breaks!', ja: '長おしで巻き上げ！張力が赤で切れる！', es: '¡Mantén para subir! ¡Rojo = se rompe!', 'pt-BR': 'Segure para içar! Vermelho = cabo parte!', fr: 'Maintenez pour remonter ! Rouge = ça casse !', de: 'Halten zum Hochziehen! Rot = Leine reißt!', it: 'Tieni premuto per issare! Rosso = si rompe!', ko: '길게 눌러 감아올려! 빨강이면 끊어져!', 'zh-Hans': '长按收线！红色表盘线会断！', tr: 'Basılı tut çekmek için! Kırmızı = kopuyor!' }));
          }
        }

        // 最下点まで伸びたのに吸着なし→戻る
        if (cableLen >= CABLE_MAX && phase === 'falling') {
          phase = 'lifting';
          liftProgress = 0;
          tensionBg.style.display = 'none';
          ctx.setHint(ctx.t({ en: 'Tap to drop the magnet!', ja: 'タップで磁石をおとそう！', es: '¡Toca para soltar el imán!', 'pt-BR': 'Toque para soltar o ímã!', fr: 'Touchez pour lâcher l\'aimant !', de: 'Tippe zum Fallen lassen!', it: 'Tocca per far cadere la calamita!', ko: '탭해서 자석을 내려！', 'zh-Hans': '点击放下磁铁！', tr: 'Mıknatısı bırakmak için dokun!' }));
        }
      }

      else if (phase === 'attached') {
        var def = ITEM_DEFS[itemData[attachedIdx].defIdx];
        var wobble = def.wobble;

        // 潮のうねり（障害）: 周期的に予兆→張力ジョルト。来たら手を離して耐える
        surgeTimer -= dt;
        var surgeWarn = surgeTimer < 0.7 && surgeTimer > 0.35;
        var surgeHit = surgeTimer <= 0.35 && surgeTimer > 0;
        if (surgeTimer <= 0) surgeTimer = 2.4 + Math.random() * 2.0;

        // うねり演出の強さ（予兆=中 / 本番=強、視覚が主のフィードバック）
        surgeAmp = surgeHit ? 1.0 : (surgeWarn ? 0.6 : 0);

        // 張力ダイナミクス: 巻く(長押し)と張力↑、離すと↓。重い物ほど張る。
        if (isHolding) {
          tension += (0.17 + wobble * 0.13) * dt;   // 巻くと糸が張る
          cableLen = Math.max(0, cableLen - dt * 2.4);
          magnetY = CRANE_Y - cableLen;
          itemMeshes[attachedIdx].position.y = magnetY - 0.5;
          updateCable(ctx.THREE);
        } else {
          tension -= 0.42 * dt;                     // 離すと張力が戻る
        }
        tension += (Math.random() - 0.5) * wobble * 0.05;  // 乱れ
        if (surgeHit) tension += 1.0 * dt;                 // うねりで急上昇
        tension = Math.max(0.02, Math.min(1, tension));
        updateTensionUI();
        // 危険域で色を変える
        tensionMarker.style.background = tension > 0.82 ? '#ff5252' : (tension > 0.62 ? '#ffca28' : '#fff');

        if (surgeWarn) ctx.setHint(ctx.t({ en: '⚠ Surge coming! Release!', ja: '⚠ うねりが来る！手をはなせ！', es: '⚠ ¡Oleada! ¡Suelta!', 'pt-BR': '⚠ Corrente! Solte!', fr: '⚠ Houle ! Relâchez !', de: '⚠ Welle kommt! Loslassen!', it: '⚠ Ondata! Rilascia!', ko: '⚠ 파도가 온다! 놓아!', 'zh-Hans': '⚠ 浪涌来了！松开！', tr: '⚠ Dalgalanma! Bırak!' }));

        // 回収完了
        if (cableLen <= 0.05) {
          ctx.addScore(def.pts);
          ctx.sfx.score();
          ctx.vibrate(40);
          itemMeshes[attachedIdx].visible = false;
          itemData[attachedIdx].visible = false;
          itemData[attachedIdx].lifted = false;
          attachedIdx = -1;
          phase = 'idle';
          tensionBg.style.display = 'none';
          ctx.setHint(def.big ? ctx.t({ en: 'Big catch! Amazing!', ja: '大物ゲット！すごい！', es: '¡Gran captura! ¡Increíble!', 'pt-BR': 'Grande captura! Incrível!', fr: 'Grosse prise ! Incroyable !', de: 'Große Beute! Toll!', it: 'Grande preda! Incredibile!', ko: '대물 획득! 대박!', 'zh-Hans': '大物到手！厉害！', tr: 'Büyük av! Harika!' }) : ctx.t({ en: 'Reeled in!', ja: 'ひきあげ成功！', es: '¡Subido con éxito!', 'pt-BR': 'Içado com sucesso!', fr: 'Remonté !', de: 'Hochgezogen!', it: 'Issato con successo!', ko: '인양 성공!', 'zh-Hans': '打捞成功！', tr: 'Çekildi!' }));
        } else if (tension >= 1.0) {
          // 張力オーバー → 糸が切れて落とす
          ctx.sfx.fail();
          ctx.vibrate([60, 40, 60]);
          // お宝は瞬間消滅させず、回転しながら海底へ落下フェード
          dropIdx = attachedIdx;
          dropT = 0;
          // ケーブルは反動でぶらぶら
          cableSwingT = 1.0;
          surgeAmp = 0;
          attachedIdx = -1;
          phase = 'idle';
          tensionBg.style.display = 'none';
          cableLen = CABLE_MAX;
          magnetY = CRANE_Y - cableLen;
          updateCable(ctx.THREE);
          ctx.setHint(ctx.t({ en: 'Line snapped! Don\'t pull too hard!', ja: '糸が切れた…！引きすぎ注意', es: '¡Cuerda rota! No tires demasiado', 'pt-BR': 'Cabo partido! Não puxe demais', fr: 'Corde cassée ! Ne tirez pas trop !', de: 'Leine gerissen! Nicht zu stark ziehen!', it: 'Fune spezzata! Non tirare troppo!', ko: '줄이 끊어졌어! 너무 당기지 마!', 'zh-Hans': '线断了！别拉太猛！', tr: 'İp koptu! Çok fazla çekme!' }));
        }
      }

      else if (phase === 'lifting') {
        // 空ケーブルを巻き戻す
        cableLen = Math.max(0, cableLen - dt * 4);
        magnetY = CRANE_Y - cableLen;
        updateCable(ctx.THREE);
        if (cableLen <= 0.05) {
          phase = 'idle';
        }
      }

      /* ---- うねり演出（予兆〜本番）: 泡の波立ち＋ケーブル揺れ＋磁石/お宝の振動 ---- */
      for (var fi = 0; fi < foamMeshes.length; fi++) {
        var fm = foamMeshes[fi];
        var fs = 1 + surgeAmp * (0.7 + 0.5 * Math.sin(animT * 12 + fi * 1.7));
        fm.mesh.scale.set(fs, 0.5 * fs, 0.5);
        fm.mesh.position.y = fm.baseY + surgeAmp * 0.22 * Math.sin(animT * 10 + fi * 2.1);
      }
      var magOffX = 0;
      if (surgeAmp > 0) {
        magOffX = Math.sin(animT * 38) * 0.11 * surgeAmp;           // 磁石の振動
        cableMesh.rotation.z = Math.sin(animT * 16) * 0.07 * surgeAmp; // ケーブルの左右揺れ
        if (attachedIdx >= 0) {
          itemMeshes[attachedIdx].position.x = itemData[attachedIdx].x + Math.sin(animT * 33) * 0.09 * surgeAmp; // お宝の振動
        }
      } else if (attachedIdx >= 0) {
        itemMeshes[attachedIdx].position.x = itemData[attachedIdx].x;
      }

      /* ---- 糸切れ後のケーブルぶらぶら（減衰振り子） ---- */
      if (cableSwingT > 0) {
        cableSwingT -= dt;
        if (cableSwingT <= 0) {
          cableSwingT = 0;
          cableMesh.rotation.z = 0;
          cableMesh.position.x = CRANE_X;
        } else {
          var decay = cableSwingT / 1.0;
          var swing = Math.sin((1.0 - cableSwingT) * 14) * 0.9 * decay;
          var cLen = Math.max(0.01, CRANE_Y - magnetY);
          magOffX += swing;
          cableMesh.position.x = CRANE_X + swing * 0.5;
          cableMesh.rotation.z = -Math.atan2(swing, cLen);
        }
      } else if (surgeAmp <= 0) {
        cableMesh.rotation.z = 0;
        cableMesh.position.x = CRANE_X;
      }
      magnetMesh.position.x = CRANE_X + magOffX;

      /* ---- 糸切れで落としたお宝: 回転しながら海底へ落下フェード ---- */
      if (dropIdx >= 0) {
        dropT += dt;
        var dm = itemMeshes[dropIdx];
        dm.position.y -= (1.2 + dropT * 3.0) * dt; // 水中なのでゆるく加速
        dm.rotation.z += 4.5 * dt;
        var ds = Math.max(0.12, 1 - dropT * 0.55); // 縮小でフェード表現
        dm.scale.set(ds, ds, ds);
        if (dm.position.y < -2.1 || dropT > 1.6) {
          dm.visible = false;
          itemData[dropIdx].visible = false;
          itemData[dropIdx].lifted = false;
          spawnItem(dropIdx);
          dropIdx = -1;
        }
      }

      // 磁石位置を反映
      magnetMesh.position.y = magnetY;
    }
  });
})();
