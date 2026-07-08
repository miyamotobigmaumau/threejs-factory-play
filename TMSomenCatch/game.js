/* =========================================================================
 * TMSomenCatch — ながしそうめん名人
 * ルール: 画面を斜めに横切る太い半割り竹1本を流れる「そうめんの束」を箸でキャッチ！
 * 操作: タップすると箸が「閉じて挟む」。挟んだ麺はお椀へ運ぶ。
 * マッシュアップ: 給食当番×ながしそうめん
 *   - 太い竹1本×通過タイミングの一致判定が肝
 *   - 金のそうめん=3わん、唐辛子=取ると1秒操作不能
 *   - ミス5回で終了、流速は徐々に上昇
 * スコア: わん数
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 定数 ---- */
  var BAMBOO_TOP    =  4.6;            // 竹の上端Y
  var BAMBOO_BOTTOM = -4.6;            // 竹の下端Y
  var CATCH_ZONE_Y  = -2.8;            // キャッチ判定ゾーンY
  var CATCH_HALF    =  0.7;            // 判定ゾーンの半幅（Y方向・束が大きいので広め）
  var MISS_MAX      = 5;

  /* 竹は画面を斜めに横切る（上手前=右上 → 下=左下）。x = DIAG_K * y */
  var DIAG_K   = 0.34;                             // 斜め勾配 (dx/dy)
  var DIAG_ANG = Math.atan(DIAG_K);                // 傾き角
  function diagX(y) { return DIAG_K * y; }

  var BAMBOO_R = 0.55;                 // 半割り竹の半径（旧レーン幅の約4.5倍の太さ）

  var LANE_COUNT = 1;
  var LANE_XS = [diagX(CATCH_ZONE_Y)]; // 箸のホームX＝キャッチ地点の竹上

  /* 箸のポーズ（rotation.z）: 開き=先が左右に離れる / 閉じ=先が中央で合わさる */
  var STICK_OPEN_L  = -0.30, STICK_OPEN_R  =  0.30;   // 先端が外へ
  var STICK_CLOSE_L =  0.12, STICK_CLOSE_R = -0.12;   // 先端が中央でピタッ

  /* お椀の位置（フォロースルー先） */
  var BOWL_POS = { x: 3.6, y: -4.0, z: 0.5 };

  /* ---- そうめんの種類（束が大きく見えるようサイズ拡大） ---- */
  var NOODLE_TYPES = [
    { pts: 1, color: 0xfafafa, len: 1.0, name: 'そうめん' },
    { pts: 3, color: 0xffd54f, len: 1.0, name: 'きんのそうめん' },
    { pts: -1, color: 0xef5350, len: 0.6, name: 'とうがらし' }
  ];

  /* ---- シーンオブジェクト ---- */
  var bambooGroups = [];
  var waterStrips = [];
  var chopstickGroups = [];   // 箸グループ×3
  var noodlePool = [];        // 麺束グループのプール
  var noodleData = [];        // {active, lane, y, vy, type, caught, wigglePhase}
  var waterParticles = [];
  var missIcons = [];
  var laneGlows = [];         // レーンのキャッチゾーンハイライト
  var splashRings = [];       // キャッチ時の水しぶきリング {mesh, t}
  var carriedNoodles = [];    // 箸が運ぶ麺ビジュアル×3
  var bowl;

  /* ---- 共有ジオメトリ/マテリアル ---- */
  var strandGeo, pepperGeo, pepperStemGeo;
  var highlightGeo, highlightMat;
  var noodleMats, pepperMat, pepperStemMat;
  var waterMat;
  var bambooMat, bambooNodeMat;
  var chopstickMat;

  /* ---- 状態 ---- */
  var misses;
  var flowSpeed;
  var spawnTimers = [];
  var spawnIntervals = [];
  var chopstickState = [];   // {phase:'idle'|'closing'|'carrying'|'returning', t, caughtType}
  var stunTimer;
  var stunLane;              // スタンを食らったレーン（パーティクル発生位置）
  var gameActive;
  var missContainer;
  var stunFlashDom;          // スタン中の画面赤フラッシュ
  var stunParticles = [];    // 炎/汗パーティクルプール {mesh, t, vx, vy}

  /* ---- スタン演出の後片付け ---- */
  function clearStunFx() {
    if (stunFlashDom) { stunFlashDom.style.display = 'none'; stunFlashDom.style.opacity = '0'; }
    for (var i = 0; i < stunParticles.length; i++) {
      stunParticles[i].t = 1;
      stunParticles[i].mesh.visible = false;
    }
    for (var l = 0; l < LANE_COUNT; l++) {
      chopstickGroups[l].rotation.z = 0;
      if (chopstickState[l].phase === 'idle') chopstickGroups[l].position.x = LANE_XS[l];
    }
  }

  /* ---- 終了時の後片付け（箸を定位置・開きポーズへ） ---- */
  function resetSticksHome() {
    clearStunFx();
    for (var l = 0; l < LANE_COUNT; l++) {
      chopstickState[l].phase = 'idle';
      chopstickState[l].t = 0;
      chopstickState[l].caughtType = -1;
      chopstickGroups[l].position.set(LANE_XS[l], CATCH_ZONE_Y, 0.3);
      setStickPose(l, 1);
      carriedNoodles[l].visible = false;
      splashRings[l].t = 1;
      splashRings[l].mesh.material.opacity = 0;
      laneGlows[l].material.opacity = 0;
    }
  }

  /* ---- ミス表示更新 ---- */
  function updateMissIcons() {
    for (var i = 0; i < MISS_MAX; i++) {
      missIcons[i].textContent = i < misses ? '✕' : '〇';
      missIcons[i].style.color = i < misses ? '#ef5350' : '#81c784';
    }
  }

  /* ---- 麺束グループを生成（太い白い束+ハイライト+唐辛子を内包、typeで出し分け） ---- */
  function makeNoodleGroup(THREE) {
    var g = new THREE.Group();
    var strands = [];
    // 太麺5本をまとめた白い塊（大きくはっきり見える束）
    var offsets = [
      [-0.2, 0.0], [-0.1, 0.1], [0, -0.02], [0.1, 0.1], [0.2, 0.0]
    ];
    for (var si = 0; si < offsets.length; si++) {
      var s = new THREE.Mesh(strandGeo, noodleMats[0]);
      s.position.x = offsets[si][0];
      s.position.z = offsets[si][1];
      s.rotation.z = (si - 2) * 0.06; // わずかに広がる＝束感
      g.add(s);
      strands.push(s);
    }
    // ハイライト（束の上に光る白の細筋・視認性アップ）
    var hl = new THREE.Mesh(highlightGeo, highlightMat);
    hl.position.set(-0.08, 0.05, 0.2);
    hl.rotation.z = -0.06;
    g.add(hl);
    // 唐辛子（下すぼみの円錐＋緑のヘタ・赤発光）— 束と同スケールで大きく
    var pepper = new THREE.Group();
    var pepperBody = new THREE.Mesh(pepperGeo, pepperMat);
    pepperBody.rotation.z = Math.PI;   // 先端を下向きに
    pepper.add(pepperBody);
    var pepperStem = new THREE.Mesh(pepperStemGeo, pepperStemMat);
    pepperStem.position.y = 0.4;
    pepper.add(pepperStem);
    pepper.rotation.z = 0.3;           // 少し傾けて実物感
    pepper.visible = false;
    g.add(pepper);
    g.userData.strands = strands;
    g.userData.highlight = hl;
    g.userData.pepper = pepper;
    g.visible = false;
    return g;
  }

  function styleNoodleGroup(g, typeIdx) {
    var isPepper = typeIdx === 2;
    g.userData.strands.forEach(function (s) {
      s.visible = !isPepper;
      s.material = noodleMats[typeIdx === 1 ? 1 : 0];
      s.scale.y = NOODLE_TYPES[typeIdx].len;
    });
    g.userData.highlight.visible = !isPepper;
    g.userData.highlight.scale.y = NOODLE_TYPES[typeIdx].len;
    g.userData.pepper.visible = isPepper;
  }

  /* ---- そうめんをスポーン ---- */
  function spawnNoodle(lane) {
    for (var i = 0; i < noodlePool.length; i++) {
      if (!noodleData[i].active) {
        var r = Math.random();
        var typeIdx = 0;
        if (r < 0.07)       typeIdx = 2;
        else if (r < 0.18)  typeIdx = 1;

        noodleData[i].active = true;
        noodleData[i].lane   = lane;
        noodleData[i].y      = BAMBOO_TOP + 0.2;
        noodleData[i].vy     = -flowSpeed;
        noodleData[i].type   = typeIdx;
        noodleData[i].caught = false;
        noodleData[i].wigglePhase = Math.random() * Math.PI * 2;
        noodlePool[i].position.set(diagX(BAMBOO_TOP + 0.2), BAMBOO_TOP + 0.2, 0.15);
        styleNoodleGroup(noodlePool[i], typeIdx);
        noodlePool[i].visible = true;
        return;
      }
    }
  }

  /* ---- 箸のポーズ適用（open01: 0=閉じ 1=開き） ---- */
  function setStickPose(lane, open01) {
    var cg = chopstickGroups[lane];
    cg.children[0].rotation.z = STICK_CLOSE_L + (STICK_OPEN_L - STICK_CLOSE_L) * open01;
    cg.children[1].rotation.z = STICK_CLOSE_R + (STICK_OPEN_R - STICK_CLOSE_R) * open01;
  }

  /* ---- 箸の状態機械 ---- */
  function updateChopstick(ctx, lane, dt) {
    var cs = chopstickState[lane];
    var cg = chopstickGroups[lane];
    var homeX = LANE_XS[lane];

    if (cs.phase === 'closing') {
      cs.t += dt;
      var k = Math.min(1, cs.t / 0.09);           // 0.09秒でパチン
      setStickPose(lane, 1 - k);
      if (k >= 1) {
        if (cs.caughtType >= 0) {
          // 掴んだ → お椀へ運ぶ
          cs.phase = 'carrying';
          cs.t = 0;
          carriedNoodles[lane].visible = true;
          styleNoodleGroup(carriedNoodles[lane], cs.caughtType);
        } else {
          // 空振り → すぐ開いて戻る
          cs.phase = 'returning';
          cs.t = 0.12; // 開くだけ（位置は動いていない）
        }
      }
    } else if (cs.phase === 'carrying') {
      cs.t += dt;
      var ck = Math.min(1, cs.t / 0.32);
      var e = 1 - (1 - ck) * (1 - ck); // easeOut
      cg.position.x = homeX + (BOWL_POS.x - homeX) * e;
      cg.position.y = CATCH_ZONE_Y + (BOWL_POS.y + 1.0 - CATCH_ZONE_Y) * e;
      cg.position.z = 0.3 + (BOWL_POS.z - 0.3) * e;
      carriedNoodles[lane].position.set(cg.position.x, cg.position.y - 0.5, cg.position.z);
      if (ck >= 1) {
        // お椀へポチャ
        carriedNoodles[lane].visible = false;
        ctx.sfx.score();
        bowl.scale.set(1.15, 0.9, 1.15); // ぷるんと反応
        cs.phase = 'returning';
        cs.t = 0;
      }
    } else if (cs.phase === 'returning') {
      cs.t += dt;
      var rk = Math.min(1, cs.t / 0.22);
      cg.position.x = BOWL_POS.x + (homeX - BOWL_POS.x) * rk;
      cg.position.y = (BOWL_POS.y + 1.0) + (CATCH_ZONE_Y - (BOWL_POS.y + 1.0)) * rk;
      cg.position.z = BOWL_POS.z + (0.3 - BOWL_POS.z) * rk;
      // 空振り時は位置が動いていないので開くだけになる
      if (cs.caughtType < 0) {
        cg.position.set(homeX, CATCH_ZONE_Y, 0.3);
      }
      setStickPose(lane, rk);
      if (rk >= 1) {
        cs.phase = 'idle';
        cs.caughtType = -1;
        cg.position.set(homeX, CATCH_ZONE_Y, 0.3);
        setStickPose(lane, 1);
      }
    }
  }

  /* ---- 太い半割り竹1本を生成（画面を斜めに横切る） ---- */
  function makeBamboo(THREE) {
    var g = new THREE.Group();
    var totalLen = (BAMBOO_TOP - BAMBOO_BOTTOM + 2.5) / Math.cos(DIAG_ANG);
    var segCount = 5;
    var segH = totalLen / segCount;

    // 半割りの樋（開口が手前=カメラ側を向く半円シェル）
    for (var s = 0; s < segCount; s++) {
      var seg = new THREE.Mesh(
        new THREE.CylinderGeometry(BAMBOO_R, BAMBOO_R, segH - 0.06, 14, 1, true, Math.PI / 2, Math.PI),
        bambooMat
      );
      seg.position.y = -totalLen / 2 + segH * s + segH / 2;
      g.add(seg);
      // 節（少し太いリング）
      var node = new THREE.Mesh(
        new THREE.CylinderGeometry(BAMBOO_R + 0.06, BAMBOO_R + 0.06, 0.14, 14, 1, true, Math.PI / 2, Math.PI),
        bambooNodeMat
      );
      node.position.y = -totalLen / 2 + segH * s;
      g.add(node);
    }

    // 縁のふち竹（半割りのシルエットを強調する左右のリップ）
    var lipGeo = new THREE.CylinderGeometry(0.07, 0.07, totalLen, 8);
    var lipL = new THREE.Mesh(lipGeo, bambooNodeMat);
    lipL.position.set(-BAMBOO_R, 0, 0);
    g.add(lipL);
    var lipR = new THREE.Mesh(lipGeo, bambooNodeMat);
    lipR.position.set(BAMBOO_R, 0, 0);
    g.add(lipR);

    // 竹の中を流れる水（幅広の流線を下方向へスクロール・水面感強め）
    var wcv = document.createElement('canvas');
    wcv.width = 32; wcv.height = 128;
    var wc = wcv.getContext('2d');
    wc.fillStyle = 'rgba(140,205,240,0.9)'; wc.fillRect(0, 0, 32, 128);
    wc.fillStyle = 'rgba(255,255,255,0.95)';
    for (var wl = 0; wl < 12; wl++) {
      wc.fillRect(2 + (wl % 5) * 6, wl * 11, 3.5, 8);
    }
    var wtex = new THREE.CanvasTexture(wcv);
    wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping;
    wtex.repeat.set(1, 4);
    var strip = new THREE.Mesh(
      new THREE.PlaneGeometry(BAMBOO_R * 1.6, totalLen),
      new THREE.MeshBasicMaterial({ map: wtex, transparent: true }));
    strip.position.set(0, 0, -0.12);
    g.add(strip);
    waterStrips.push(wtex);

    // 斜めに傾けて配置（x = DIAG_K * y のライン上）＋開口をやや上向きに
    g.rotation.z = -DIAG_ANG;
    g.rotation.x = -0.14;
    g.position.set(diagX((BAMBOO_TOP + BAMBOO_BOTTOM) / 2), (BAMBOO_TOP + BAMBOO_BOTTOM) / 2, -0.25);
    return g;
  }

  /* ---- 箸グループを生成（開いた状態で待機） ---- */
  function makeChopsticks(THREE, laneX) {
    var g = new THREE.Group();
    var left = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.028, 1.1, 5),
      chopstickMat
    );
    left.position.set(-0.16, 0, 0);
    g.add(left);
    var right = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.028, 1.1, 5),
      chopstickMat
    );
    right.position.set(0.16, 0, 0);
    g.add(right);
    g.position.set(laneX, CATCH_ZONE_Y, 0.3);
    return g;
  }

  Shell.registerGame({
    id: 'TMSomenCatch',
    title: { en: 'Somen Master', ja: 'ながしそうめん名人', es: 'Maestro del Somen', 'pt-BR': 'Mestre do Somen', fr: 'Maître du Somen', de: 'Somen-Meister', it: 'Maestro del Somen', ko: '소면 흘리기 명인', 'zh-Hans': '流水面名人', tr: 'Somen Ustası' },
    howto: { en: 'Noodle bundles flow down the big bamboo!\nTap when they reach the chopsticks!\nWatch out for chili peppers!', ja: 'ふとい竹をそうめんの束がながれてくる！\nおはしにきたらタップでキャッチ！\nとうがらしに注意！', es: '¡Los fideos bajan por el gran bambú!\n¡Toca cuando lleguen a los palillos!\n¡Cuidado con los chiles!', 'pt-BR': 'Os feixes de massa descem pelo bambu grande!\nToque quando chegarem aos pauzinhos!\nCuidado com a pimenta!', fr: 'Les nouilles descendent le grand bambou !\nTouchez quand elles atteignent les baguettes !\nAttention au piment !', de: 'Nudelbündel fließen das große Bambusrohr hinab!\nTippe, wenn sie die Stäbchen erreichen!\nVorsicht vor Chili!', it: 'I fasci di spaghetti scendono dal grande bambù!\nTocca quando arrivano alle bacchette!\nAttenzione al peperoncino!', ko: '굵은 대나무로 소면 다발이 흘러온다!\n젓가락에 오면 탭으로 캐치!\n고추 조심!', 'zh-Hans': '面条束顺着大竹子流下来！\n到筷子处时点击夹住！\n注意辣椒！', tr: 'Erişte demetleri büyük bambudan akıyor!\nÇubuklara gelince dokun!\nBibere dikkat!' },
    scoreLabel: { en: 'bowls', ja: 'わん', es: 'cuencos', 'pt-BR': 'tigelas', fr: 'bols', de: 'Schüsseln', it: 'ciotole', ko: '그릇', 'zh-Hans': '碗', tr: 'kase' },
    bg: 0xfff9c4,
    cameraFov: 55,
    cameraPos: [0.4, 1.8, 10.5],    // やや上から見下ろして半割り竹の内側を見せる
    cameraLookAt: [0, -0.5, 0],
    fitWidth: 7.5,                  // 縦持ちでも竹の全景が収まる

    init: function (ctx) {
      var THREE = ctx.THREE;

      bambooMat     = Style.mat(0x558b2f, { side: THREE.DoubleSide });
      bambooNodeMat = Style.mat(0x33691e, { side: THREE.DoubleSide });
      chopstickMat  = Style.mat(0xa1887f);
      waterMat      = new THREE.MeshLambertMaterial({ color: 0x81d4fa, transparent: true, opacity: 0.5 });

      strandGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 6);          // 太麺（束用）
      highlightGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);       // 束のハイライト筋
      highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      pepperGeo = new THREE.ConeGeometry(0.22, 0.65, 8);      // 唐辛子の実（円錐・束と同スケール）
      pepperStemGeo = new THREE.ConeGeometry(0.11, 0.24, 6);  // 緑のヘタ
      noodleMats = [
        Style.mat(0xfafafa),
        new THREE.MeshLambertMaterial({ color: 0xffd54f, emissive: 0xffab00 })
      ];
      pepperMat = new THREE.MeshLambertMaterial({ color: 0xef5350, emissive: 0xd32f2f });
      pepperStemMat = new THREE.MeshLambertMaterial({ color: 0x66bb6a });

      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 12),
        Style.mat(0xd7ccc8)
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -5;
      ctx.scene.add(floor);

      /* 太い半割り竹1本（斜め配置） */
      var bg = makeBamboo(THREE);
      ctx.scene.add(bg);
      bambooGroups.push(bg);

      /* キャッチゾーンのハイライト（麺が接近すると光る） */
      for (var gl = 0; gl < LANE_COUNT; gl++) {
        var glow = new THREE.Mesh(
          new THREE.PlaneGeometry(2.6, 1.7),
          new THREE.MeshBasicMaterial({ color: 0xfff176, transparent: true, opacity: 0.0,
            blending: THREE.AdditiveBlending, depthWrite: false })
        );
        glow.position.set(LANE_XS[gl], CATCH_ZONE_Y, -0.1);
        ctx.scene.add(glow);
        laneGlows.push(glow);
      }

      /* 水流パーティクル（竹に沿って流れる） */
      var waterGeo = new THREE.SphereGeometry(0.09, 5, 4);
      for (var w = 0; w < 24; w++) {
        var wy = BAMBOO_TOP - Math.random() * (BAMBOO_TOP - BAMBOO_BOTTOM);
        var wm = new THREE.Mesh(waterGeo, waterMat);
        wm.position.set(
          diagX(wy) + (Math.random() - 0.5) * 0.5,
          wy,
          0.05
        );
        wm.userData.vy = -(2 + Math.random() * 1.5);
        ctx.scene.add(wm);
        waterParticles.push(wm);
      }

      /* 麺束プール（最大20） */
      var poolSize = 20;
      for (var ni = 0; ni < poolSize; ni++) {
        var ng = makeNoodleGroup(THREE);
        ctx.scene.add(ng);
        noodlePool.push(ng);
        noodleData.push({ active: false, lane: 0, y: 0, vy: 0, type: 0, caught: false, wigglePhase: 0 });
      }

      /* 箸 + 運搬用の麺 */
      for (var ci = 0; ci < LANE_COUNT; ci++) {
        var cg = makeChopsticks(THREE, LANE_XS[ci]);
        ctx.scene.add(cg);
        chopstickGroups.push(cg);
        chopstickState.push({ phase: 'idle', t: 0, caughtType: -1 });
        setStickPose(ci, 1); // 開いて待機

        var cn = makeNoodleGroup(THREE);
        cn.rotation.z = Math.PI / 2 * 0.85; // 横向きにぶら下がる麺
        ctx.scene.add(cn);
        carriedNoodles.push(cn);
      }

      /* お椀（フォロースルーの受け皿） */
      bowl = new THREE.Group();
      var bowlBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.3, 0.45, 12),
        Style.mat(0x4e342e)
      );
      bowl.add(bowlBody);
      var bowlRim = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.05, 6, 14),
        Style.mat(0x6d4c41)
      );
      bowlRim.rotation.x = Math.PI / 2;
      bowlRim.position.y = 0.22;
      bowl.add(bowlRim);
      bowl.position.set(BOWL_POS.x, BOWL_POS.y, BOWL_POS.z);
      ctx.scene.add(bowl);

      /* キャッチ水しぶきリング×レーン */
      for (var sr = 0; sr < LANE_COUNT; sr++) {
        var ring = new THREE.Mesh(
          new THREE.RingGeometry(0.1, 0.2, 14),
          new THREE.MeshBasicMaterial({ color: 0xe1f5fe, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false })
        );
        ring.position.set(LANE_XS[sr], CATCH_ZONE_Y, 0.4);
        ctx.scene.add(ring);
        splashRings.push({ mesh: ring, t: 1 });
      }

      /* ミス表示UI */
      missContainer = document.createElement('div');
      missContainer.style.cssText = 'position:fixed;top:56px;right:10px;z-index:11;' +
        'display:none;font-size:20px;letter-spacing:3px;';
      for (var mi = 0; mi < MISS_MAX; mi++) {
        var ico = document.createElement('span');
        ico.textContent = '〇';
        ico.style.color = '#81c784';
        missContainer.appendChild(ico);
        missIcons.push(ico);
      }
      document.body.appendChild(missContainer);

      /* スタン中の画面赤フラッシュ */
      stunFlashDom = document.createElement('div');
      stunFlashDom.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;' +
        'background:radial-gradient(circle,rgba(244,67,54,0.2),rgba(211,47,47,0.55));' +
        'z-index:10;pointer-events:none;opacity:0;display:none;';
      document.body.appendChild(stunFlashDom);

      /* スタン用 炎/汗パーティクルプール（交互に炎と汗） */
      var flameGeo = new THREE.ConeGeometry(0.09, 0.26, 6);
      var sweatGeo = new THREE.SphereGeometry(0.07, 6, 5);
      for (var sp = 0; sp < 10; sp++) {
        var isFlame = sp % 2 === 0;
        var pmesh = new THREE.Mesh(isFlame ? flameGeo : sweatGeo,
          new THREE.MeshBasicMaterial({ color: isFlame ? 0xff7043 : 0x81d4fa,
            transparent: true, opacity: 0.9, depthWrite: false }));
        pmesh.visible = false;
        ctx.scene.add(pmesh);
        stunParticles.push({ mesh: pmesh, t: 1, vx: 0, vy: 0 });
      }

      /* 風鈴 */
      var furinMat = Style.mat(0x80cbc4);
      var furin = new THREE.Group();
      var bell = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 8, 1, true), furinMat);
      bell.rotation.x = Math.PI;
      furin.add(bell);
      var string = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4),
        Style.mat(0x8d6e63)
      );
      string.position.y = 0.35;
      furin.add(string);
      furin.position.set(4.5, 3.5, 0);
      ctx.scene.add(furin);
    },

    start: function (ctx) {
      misses = 0;
      flowSpeed = 2.8;
      stunTimer = 0;
      stunLane = 0;
      gameActive = true;
      clearStunFx();

      for (var l = 0; l < LANE_COUNT; l++) {
        spawnTimers[l]    = 1.0;
        spawnIntervals[l] = 1.5;
        chopstickState[l].phase = 'idle';
        chopstickState[l].t = 0;
        chopstickState[l].caughtType = -1;
        chopstickGroups[l].position.set(LANE_XS[l], CATCH_ZONE_Y, 0.3);
        setStickPose(l, 1);
        carriedNoodles[l].visible = false;
      }

      for (var ni = 0; ni < noodlePool.length; ni++) {
        noodleData[ni].active = false;
        noodlePool[ni].visible = false;
      }

      updateMissIcons();
      missContainer.style.display = '';
      ctx.setHint(ctx.t({ en: 'Tap when noodles come!\nSnap chopsticks to catch!', ja: 'そうめんがきたらタップ！\nおはしでパチンとはさもう', es: '¡Toca cuando vengan fideos!\n¡Chasquea los palillos!', 'pt-BR': 'Toque quando a massa vir!\nFeche os pauzinhos!', fr: 'Touchez quand les nouilles arrivent !\nFermez les baguettes !', de: 'Tippe wenn Nudeln kommen!\nStäbchen zusnappen!', it: 'Tocca quando arrivano gli spaghetti!\nFai scattare le bacchette!', ko: '소면이 오면 탭!\n젓가락으로 딱 잡아!', 'zh-Hans': '面条来时点击！\n筷子夹住！', tr: 'Erişte gelince dokun!\nYemek çubukları kapat!' }));
    },

    onPointerDown: function (ctx, p) {
      if (!gameActive || stunTimer > 0) return;
      var laneIdx = Math.floor((p.nx + 1) / 2 * LANE_COUNT);
      laneIdx = Math.max(0, Math.min(LANE_COUNT - 1, laneIdx));

      var cs = chopstickState[laneIdx];
      if (cs.phase !== 'idle') return; // 運搬中は打てない（リズム要素）

      // 閉じる（パチン）
      cs.phase = 'closing';
      cs.t = 0;
      cs.caughtType = -1;
      ctx.sfx.tap();

      // キャッチ判定（閉じた瞬間に挟めたか）
      for (var ni = 0; ni < noodlePool.length; ni++) {
        var nd = noodleData[ni];
        if (!nd.active || nd.lane !== laneIdx || nd.caught) continue;
        var dy = Math.abs(nd.y - CATCH_ZONE_Y);
        if (dy <= CATCH_HALF) {
          nd.caught = true;
          nd.active = false;
          noodlePool[ni].visible = false;

          var type = NOODLE_TYPES[nd.type];
          if (nd.type === 2) {
            stunTimer = 1.0;
            stunLane = laneIdx;
            // 画面赤フラッシュ＋炎/汗パーティクルのバースト
            stunFlashDom.style.display = '';
            for (var sp = 0; sp < stunParticles.length; sp++) {
              var pt = stunParticles[sp];
              pt.t = -Math.random() * 0.25;  // 少しずらして連続感
              pt.vx = (Math.random() - 0.5) * 1.8;
              pt.vy = 1.6 + Math.random() * 1.5;
              pt.mesh.position.set(LANE_XS[laneIdx] + (Math.random() - 0.5) * 0.4, CATCH_ZONE_Y + 0.3, 0.5);
              pt.mesh.material.opacity = 0.9;
              pt.mesh.visible = true;
            }
            ctx.sfx.fail();
            ctx.vibrate(30);
            ctx.setHint(ctx.t({ en: 'Hot!! Stunned for 1 sec!', ja: 'からい！！1びょううごけない！', es: '¡Picante!! ¡Paralizado 1 seg!', 'pt-BR': 'Quente!! Paralisado por 1 seg!', fr: 'Piquant !! Paralysé 1 sec !', de: 'Scharf!! 1 Sek. gelähmt!', it: 'Piccante!! Stordito 1 sec!', ko: '매워!! 1초 동안 못 움직여!', 'zh-Hans': '好辣！！1秒动弹不得！', tr: 'Acı!! 1 saniye dondu!' }));
            // 唐辛子は掴まず落とす（空振り扱いで開き直す）
          } else {
            cs.caughtType = nd.type;
            ctx.addScore(type.pts);
            ctx.vibrate(10);
            // 水しぶき
            var srn = splashRings[laneIdx];
            srn.t = 0;
            if (nd.type === 1) ctx.setHint(ctx.t({ en: 'Golden noodle! 3 bowls!', ja: 'きんのそうめん！ 3わん！', es: '¡Fideo dorado! ¡3 cuencos!', 'pt-BR': 'Macarrão dourado! 3 tigelas!', fr: 'Nouille dorée ! 3 bols !', de: 'Goldene Nudel! 3 Schüsseln!', it: 'Spaghetto dorato! 3 ciotole!', ko: '금색 소면! 3그릇!', 'zh-Hans': '金色面条！3碗！', tr: 'Altın erişte! 3 kase!' }));
          }
          break;
        }
      }
    },

    update: function (ctx, dt) {
      for (var ws = 0; ws < waterStrips.length; ws++) waterStrips[ws].offset.y += dt * 1.2;
      if (!gameActive) return;

      var elapsed = ctx.elapsed;

      if (stunTimer > 0) {
        stunTimer -= dt;
        // 画面赤フラッシュ（残り時間に応じて明滅しつつ減衰）
        stunFlashDom.style.opacity = String(Math.min(1, stunTimer * 2.5) * (0.7 + 0.3 * Math.sin(elapsed * 30)));
        // 箸ぶるぶる（アイドル中の箸のみ・運搬アニメは邪魔しない）
        for (var st = 0; st < LANE_COUNT; st++) {
          if (chopstickState[st].phase === 'idle') {
            chopstickGroups[st].position.x = LANE_XS[st] + Math.sin(elapsed * 46 + st * 2.1) * 0.07;
            chopstickGroups[st].rotation.z = Math.sin(elapsed * 40 + st) * 0.09;
          }
        }
        if (stunTimer <= 0) {
          stunTimer = 0;
          ctx.setHint('');
          clearStunFx();
        }
      }

      /* ---- 炎/汗パーティクル（プール再利用・スタン中は再発生） ---- */
      for (var pp = 0; pp < stunParticles.length; pp++) {
        var spt = stunParticles[pp];
        if (spt.t >= 0.7) continue;
        spt.t += dt;
        if (spt.t < 0) continue;              // 発生ディレイ中
        spt.mesh.position.x += spt.vx * dt;
        spt.mesh.position.y += spt.vy * dt;
        spt.mesh.material.opacity = Math.max(0, 1 - spt.t / 0.7) * 0.9;
        if (spt.t >= 0.7) {
          if (stunTimer > 0) {
            // スタン継続中はスタン箇所から再発生
            spt.t = 0;
            spt.vx = (Math.random() - 0.5) * 1.8;
            spt.vy = 1.6 + Math.random() * 1.5;
            spt.mesh.position.set(LANE_XS[stunLane] + (Math.random() - 0.5) * 0.4, CATCH_ZONE_Y + 0.3, 0.5);
            spt.mesh.material.opacity = 0.9;
          } else {
            spt.mesh.visible = false;
          }
        }
      }

      flowSpeed = 2.8 + elapsed * 0.04;

      /* ---- スポーン ---- */
      for (var l = 0; l < LANE_COUNT; l++) {
        spawnTimers[l] -= dt;
        if (spawnTimers[l] <= 0) {
          spawnNoodle(l);
          spawnIntervals[l] = Math.max(0.6, 1.5 - elapsed * 0.012 + (Math.random() - 0.5) * 0.35);
          spawnTimers[l] = spawnIntervals[l];
        }
      }

      /* ---- そうめん更新（束のゆらぎ付き） ---- */
      var laneNear = [0, 0, 0]; // 接近ハイライト強度
      for (var ni = 0; ni < noodlePool.length; ni++) {
        var nd = noodleData[ni];
        if (!nd.active) continue;
        nd.vy = -flowSpeed;
        nd.y += nd.vy * dt;
        var wig = Math.sin(elapsed * 6 + nd.wigglePhase) * 0.06;
        noodlePool[ni].position.set(diagX(nd.y) + wig, nd.y, 0.15);
        noodlePool[ni].rotation.z = -DIAG_ANG + wig * 2; // 竹の傾きに沿って流れる

        // 接近ハイライト（キャッチゾーンの1.6上〜ゾーン内）
        var dyz = nd.y - CATCH_ZONE_Y;
        if (nd.type !== 2 && dyz > -CATCH_HALF && dyz < 1.6) {
          var k = 1 - Math.abs(dyz) / 1.6;
          if (k > laneNear[nd.lane]) laneNear[nd.lane] = k;
        }

        if (nd.y < CATCH_ZONE_Y - CATCH_HALF - 0.5 && !nd.caught) {
          nd.active = false;
          noodlePool[ni].visible = false;
          if (nd.type !== 2) {
            misses++;
            updateMissIcons();
            ctx.sfx.bounce();
            if (misses >= MISS_MAX) {
              gameActive = false;
              resetSticksHome();
              ctx.gameOver(ctx.score);
              return;
            }
          }
        }
        if (nd.y < BAMBOO_BOTTOM - 0.5) {
          nd.active = false;
          noodlePool[ni].visible = false;
        }
      }

      /* ---- レーンハイライト ---- */
      for (var lg = 0; lg < LANE_COUNT; lg++) {
        laneGlows[lg].material.opacity += ((laneNear[lg] * 0.22) - laneGlows[lg].material.opacity) * Math.min(1, dt * 10);
      }

      /* ---- 水しぶきリング ---- */
      for (var sr = 0; sr < LANE_COUNT; sr++) {
        var s = splashRings[sr];
        if (s.t < 1) {
          s.t += dt * 2.6;
          var sk = Math.min(1, s.t);
          s.mesh.scale.setScalar(1 + sk * 3);
          s.mesh.material.opacity = (1 - sk) * 0.8;
        }
      }

      /* ---- 箸アニメ ---- */
      for (var ci = 0; ci < LANE_COUNT; ci++) {
        updateChopstick(ctx, ci, dt);
      }

      /* ---- お椀のぷるん戻り ---- */
      bowl.scale.x += (1 - bowl.scale.x) * Math.min(1, dt * 8);
      bowl.scale.y += (1 - bowl.scale.y) * Math.min(1, dt * 8);
      bowl.scale.z += (1 - bowl.scale.z) * Math.min(1, dt * 8);

      /* ---- 水流パーティクル（竹の斜めに沿って流れる） ---- */
      for (var wi = 0; wi < waterParticles.length; wi++) {
        var wp = waterParticles[wi];
        wp.position.y += wp.userData.vy * dt;
        wp.position.x += wp.userData.vy * dt * DIAG_K;
        if (wp.position.y < BAMBOO_BOTTOM - 0.5) {
          wp.position.y = BAMBOO_TOP;
          wp.position.x = diagX(BAMBOO_TOP) + (Math.random() - 0.5) * 0.5;
        }
      }

      /* ---- 時間制限（60秒） ---- */
      if (elapsed > 60) {
        gameActive = false;
        resetSticksHome();
        ctx.endGame(ctx.score);
      }
    }
  });

})();
