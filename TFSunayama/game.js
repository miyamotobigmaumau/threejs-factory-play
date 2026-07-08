/* =========================================================================
 * TFSunayama — すなやまチキンレース
 * ルール: 砂山（積層ブロック）の頂上に旗。砂ブロックをタップで採取して
 *        コインをあつめる。コイン入りブロックは+2〜5。下の段ほど
 *        高リスク・高コイン。抜くたび上が沈み旗がかたむく。
 *        「やめる」タップでスコア確定、旗がたおれたら0点。
 * 操作: 砂ブロックをタップ／「やめる」ボタンで確定
 * スコア: 確定コイン (こいん)
 * ========================================================================= */
(function () {
  'use strict';

  var blocks = [];          // { mesh, layer, baseX, baseY, baseZ, active, flyT, vx, vy, vz, rx, rz, coin }
  var flagG, flagCloth, stopBtn;
  var raycaster, pointerV2;
  var C = null;             // ctx（ボタンのクリックハンドラ用）
  var bunny, bunnyHopT;     // 見物うさぎ（おたからで跳ねる・崩壊でひっくり返る）
  var dangerRing;           // 危険度リング（danger 上昇で赤く脈動）
  var coinPool = [], coinsLive = [];  // コイン飛び出し演出（プール）
  var puffPool = [], puffsLive = []; // 砂煙（プール）

  var LAYERS = [4, 3, 2];   // 各層の一辺の個数（下から）※頂上は旗の台で抜けない
  var BLK = 1.1, GAP = 1.14, BLK_H = 0.85;
  var LAYER_RISK = [0.27, 0.15, 0.08];  // 下の段ほど危険

  // 状態
  var state;                // 'play' | 'collapse'
  var danger, tiltDir, wobT, collapseT, layerSink = [0, 0, 0, 0];

  /* コイン演出スポーン（プールから取得。update内でnewしない） */
  function spawnCoins(x, y, z, n) {
    for (var i = 0; i < n; i++) {
      var c = null;
      for (var j = 0; j < coinPool.length; j++) {
        if (!coinPool[j].visible) { c = coinPool[j]; break; }
      }
      if (!c) return;
      c.userData.vx = (Math.random() - 0.5) * 1.8;
      c.userData.vy = 2.4 + Math.random() * 1.4;
      c.userData.vz = (Math.random() - 0.5) * 1.8;
      c.userData.life = 0.7;
      c.position.set(x, y, z);
      c.scale.set(1, 1, 1);
      c.visible = true;
      coinsLive.push(c);
    }
  }

  /* 砂煙スポーン（プール） */
  function spawnPuffs(x, y, z, n) {
    for (var i = 0; i < n; i++) {
      var d = null;
      for (var j = 0; j < puffPool.length; j++) {
        if (!puffPool[j].visible) { d = puffPool[j]; break; }
      }
      if (!d) return;
      var a = Math.random() * Math.PI * 2;
      d.userData.vx = Math.cos(a) * (1.2 + Math.random());
      d.userData.vz = Math.sin(a) * (1.2 + Math.random());
      d.userData.life = 0.45 + Math.random() * 0.2;
      d.userData.maxLife = d.userData.life;
      d.position.set(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5);
      d.scale.set(1, 1, 1);
      d.visible = true;
      puffsLive.push(d);
    }
  }

  /* 旗（頂上の台ブロック＋ポール＋三角旗） */
  function makeFlag(THREE) {
    var g = new THREE.Group();
    var peak = new THREE.Mesh(
      Style.roundedBox(BLK, BLK_H, BLK, 0.16),
      Style.mat(0xd8b878)
    );
    peak.position.y = BLK_H / 2;
    g.add(peak);
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8),
      new THREE.MeshLambertMaterial({ color: 0xeeeeee })
    );
    pole.position.y = BLK_H + 0.9;
    g.add(pole);
    var clothGeo = new THREE.BufferGeometry();
    clothGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 2.75, 0,   0.85, 2.55, 0,   0, 2.35, 0
    ], 3));
    clothGeo.computeVertexNormals();
    flagCloth = new THREE.Mesh(clothGeo,
      new THREE.MeshBasicMaterial({ color: 0xe53935, side: THREE.DoubleSide }));
    g.add(flagCloth);
    // ポール先端の金玉飾り（主役の差し色パーツ）
    var tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xf2b632 }));
    tip.position.y = BLK_H + 1.9;
    g.add(tip);
    return g;
  }

  /* コイン割り当て: 下の段ほど高コイン・高確率（+2〜5）。ないブロックは+1のみ */
  function assignCoins(ctx) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var r = ctx.random();
      if (b.layer === 0)      b.coin = r < 0.55 ? 3 + ((ctx.random() * 3) | 0) : 0; // +3〜5
      else if (b.layer === 1) b.coin = r < 0.45 ? 2 + ((ctx.random() * 2) | 0) : 0; // +2〜3
      else                    b.coin = r < 0.35 ? 2 : 0;                            // +2
    }
  }

  /* 崩壊開始（旗がたおれて0点） */
  function collapse(ctx) {
    state = 'collapse';
    collapseT = 0;
    stopBtn.style.display = 'none';
    dangerRing.visible = false;
    spawnPuffs(0, 1.2, 0, 8);   // 崩壊の土煙
    ctx.sfx.fail();
    ctx.vibrate(120);
    ctx.setHint(ctx.t({ en: 'The flag fell!', ja: 'はたがたおれた！', es: '¡Cayó la bandera!', 'pt-BR': 'A bandeira caiu!', fr: 'Le drapeau est tombé!', de: 'Die Flagge fiel!', it: 'La bandiera è caduta!', ko: '깃발이 쓰러졌다!', 'zh-Hans': '旗子倒了！', tr: 'Bayrak düştü!' }));
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b.active || b.flyT > 0) continue;
      var a = ctx.random() * Math.PI * 2;
      b.vx = Math.cos(a) * (1 + ctx.random() * 2.5);
      b.vz = Math.sin(a) * (1 + ctx.random() * 2.5);
      b.vy = 1 + ctx.random() * 2;
      b.rx = (ctx.random() - 0.5) * 6;
      b.rz = (ctx.random() - 0.5) * 6;
    }
  }

  Shell.registerGame({
    id: 'TFSunayama',
    title: { en: 'Sand Mountain Challenge', ja: 'すなやまチキンレース', es: 'Desafío de Arena', 'pt-BR': 'Desafio da Montanha de Areia', fr: 'Défi de la Montagne de Sable', de: 'Sandberg-Challenge', it: 'Sfida della Sabbia', ko: '모래산 치킨 레이스', 'zh-Hans': '沙山鸡游戏', tr: 'Kum Dağı Meydan Okuması' },
    howto: { en: 'Tap sand blocks to collect coins!\nGreed too much and the flag falls = 0 pts…\nTap STOP to lock in your score!', ja: 'すなブロックをタップしてコインあつめ！\nよくばりすぎると はたがたおれて0てん…\n「やめる」でスコアかくてい', es: '¡Toca bloques de arena para recoger monedas!\nDemasiada codicia = bandera cae = 0 pts…\n¡Toca PARAR para guardar tu puntuación!', 'pt-BR': 'Toque blocos de areia para coletar moedas!\nAmbição demais = bandeira cai = 0 pts…\nToque PARAR para salvar sua pontuação!', fr: 'Touchez les blocs de sable pour collecter des pièces!\nTrop d\'avidité = drapeau tombe = 0 pts…\nAppuyez sur STOP pour valider!', de: 'Sand-Blöcke antippen und Münzen sammeln!\nZu gierig = Flagge fällt = 0 Punkte…\nSTOP tippen zum Sichern!', it: 'Tocca blocchi di sabbia per raccogliere monete!\nTroppa avidità = bandiera cade = 0 pts…\nTocca STOP per salvare!', ko: '모래 블록을 탭해 코인 수집!\n너무 욕심 부리면 깃발 쓰러져 0점…\n그만 버튼으로 점수 확정!', 'zh-Hans': '点击沙块收集金币！\n太贪心旗子倒 = 0分…\n点击停止来锁定分数！', tr: 'Kum bloklarına dokun ve coin topla!\nÇok açgözlülük = bayrak düşer = 0 puan…\nDURDUR\'a bas ve puanını kaydet!' },
    scoreLabel: { en: 'coin', ja: 'こいん', es: 'moneda', 'pt-BR': 'moeda', fr: 'pièce', de: 'Münze', it: 'moneta', ko: '코인', 'zh-Hans': '金币', tr: 'coin' },
    bg: 0xa5d8f0,
    cameraFov: 55,
    cameraPos: [0, 7.5, 11],
    cameraLookAt: [0, 2, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;
      C = ctx;

      // 砂場の地面と木のわく（地面はやや暗め＝砂山ブロックとの明度差を作る）
      var sand = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.MeshLambertMaterial({ color: 0xd9b671 })
      );
      sand.rotation.x = -Math.PI / 2;
      ctx.scene.add(sand);

      // 砂山の下のしめった砂の輪（プレイエリアの輪郭＋主役の埋没防止）
      var wet = new THREE.Mesh(new THREE.CircleGeometry(3.6, 26), Style.mat(0xba9354));
      wet.rotation.x = -Math.PI / 2;
      wet.position.y = 0.005;
      ctx.scene.add(wet);
      var frameMat = new THREE.MeshLambertMaterial({ color: 0x9a6a3a });
      var frameGeoH = new THREE.BoxGeometry(14, 0.5, 0.6);
      var frameGeoV = new THREE.BoxGeometry(0.6, 0.5, 14);
      var f1 = new THREE.Mesh(frameGeoH, frameMat); f1.position.set(0, 0.25, -6.7);
      var f2 = new THREE.Mesh(frameGeoH, frameMat); f2.position.set(0, 0.25, 6.7);
      var f3 = new THREE.Mesh(frameGeoV, frameMat); f3.position.set(-6.7, 0.25, 0);
      var f4 = new THREE.Mesh(frameGeoV, frameMat); f4.position.set(6.7, 0.25, 0);
      ctx.scene.add(f1, f2, f3, f4);

      // 小道具: バケツとスコップ
      var bucket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.35, 0.7, 12),
        new THREE.MeshLambertMaterial({ color: 0xe05050 })
      );
      bucket.position.set(3.6, 0.35, 3.2);
      ctx.scene.add(bucket);
      var scoop = new THREE.Group();
      var handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8),
        new THREE.MeshLambertMaterial({ color: 0x4a90d9 })
      );
      handle.rotation.z = Math.PI / 2.4;
      handle.position.set(0.4, 0.1, 0);
      scoop.add(handle);
      var blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.06, 0.6),
        new THREE.MeshLambertMaterial({ color: 0x6ab0e8 })
      );
      blade.position.set(-0.3, 0.03, 0);
      scoop.add(blade);
      scoop.position.set(-3.6, 0, 3.4);
      ctx.scene.add(scoop);

      // ミッドプロップ: 貝がら・ビーチボール・小石（砂場の物語）
      var shell = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), Style.mat(0xe8cfae, { flat: true }));
      shell.scale.set(1, 0.45, 0.85);
      shell.position.set(2.9, 0.12, -3.4);
      ctx.scene.add(shell);
      var ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), Style.mat(0x3f7fc0));
      ball.position.set(-4.4, 0.55, -2.6);
      ctx.scene.add(ball);
      var pebbleGeo = new THREE.IcosahedronGeometry(0.18, 0);
      var pebbleMat = Style.mat(0xa89a86, { flat: true });
      [[-2.8, -4.2], [4.9, 1.4], [-5.2, 1.8]].forEach(function (pp) {
        var pb = new THREE.Mesh(pebbleGeo, pebbleMat);
        pb.position.set(pp[0], 0.1, pp[1]);
        pb.rotation.set(Math.random() * 2, Math.random() * 2, 0);
        ctx.scene.add(pb);
      });

      // 遠景: うみ・太陽・雲・島（縦画面上半分の空白を埋める）
      var sea = new THREE.Mesh(new THREE.PlaneGeometry(90, 26),
        new THREE.MeshBasicMaterial({ color: 0x2e6fa3 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(0, 0.02, -42);
      ctx.scene.add(sea);
      var sun = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20),
        new THREE.MeshBasicMaterial({ color: 0xffe082 }));
      sun.position.set(9, 13, -44);
      ctx.scene.add(sun);
      [[-8, 11.5, -40, 1.7], [5, 14, -43, 2.1]].forEach(function (cl) {
        var cloud = new THREE.Group();
        for (var pi = 0; pi < 3; pi++) {
          var puffM = new THREE.Mesh(
            new THREE.SphereGeometry(cl[3] * (0.7 + Math.random() * 0.4), 7, 5),
            new THREE.MeshBasicMaterial({ color: 0xfffdf5 }));
          puffM.position.set(pi * cl[3] * 0.9 - cl[3], (Math.random() - 0.5) * 0.4, 0);
          cloud.add(puffM);
        }
        cloud.position.set(cl[0], cl[1], cl[2]);
        ctx.scene.add(cloud);
      });
      var isle = new THREE.Mesh(new THREE.ConeGeometry(4.5, 2.4, 8), Style.mat(0xc9a86a, { flat: true }));
      isle.position.set(-14, 1.1, -38);
      ctx.scene.add(isle);
      var palm = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.8, 6), Style.mat(0x2d6e1e, { flat: true }));
      palm.position.set(-14, 3.1, -38);
      ctx.scene.add(palm);

      // 見物うさぎ（おたからで跳ねて喜ぶ・崩壊でひっくり返る）＋接地影
      bunny = GameBunny.make(THREE, { scale: 0.85 });
      bunny.group.position.set(5.1, 0, 2.6);
      bunny.group.rotation.y = -2.0;   // 砂山のほうを向く
      ctx.scene.add(bunny.group);
      var bShadow = Style.softShadow(0.75);
      bShadow.position.set(5.1, 0.012, 2.6);
      ctx.scene.add(bShadow);

      // 危険度リング（dangerが高まると赤く脈動して警告）
      dangerRing = new THREE.Mesh(
        new THREE.RingGeometry(3.1, 3.45, 28),
        new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0, side: THREE.DoubleSide })
      );
      dangerRing.rotation.x = -Math.PI / 2;
      dangerRing.position.y = 0.02;
      dangerRing.visible = false;
      ctx.scene.add(dangerRing);

      // 砂山ブロック（色は元のまま・質感だけマット＆角丸のソフトブロックに）
      var sandMats = [
        Style.mat(0xdec080),
        Style.mat(0xd4b370),
        Style.mat(0xe6ca8e)
      ];
      var blkGeo = Style.roundedBox(BLK, BLK_H, BLK, 0.16);
      var mi = 0;
      for (var l = 0; l < LAYERS.length; l++) {
        var n = LAYERS[l];
        var off = -(n - 1) / 2 * GAP;
        for (var ix = 0; ix < n; ix++) {
          for (var iz = 0; iz < n; iz++) {
            var m = new THREE.Mesh(blkGeo, sandMats[mi++ % 3]);
            var bx = off + ix * GAP, bz = off + iz * GAP;
            var by = l * BLK_H + BLK_H / 2;
            m.position.set(bx, by, bz);
            m.userData.idx = blocks.length;
            ctx.scene.add(m);
            blocks.push({
              mesh: m, layer: l, baseX: bx, baseY: by, baseZ: bz,
              active: true, flyT: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, coin: 0
            });
          }
        }
      }

      // 頂上の旗（台ブロックごと。抜けない）
      flagG = makeFlag(THREE);
      ctx.scene.add(flagG);

      // コイン演出（1枚を使い回し）
      coinFx = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16),
        new THREE.MeshPhongMaterial({ color: 0xffd54f, shininess: 100 })
      );
      coinFx.rotation.x = Math.PI / 2;
      coinFx.visible = false;
      ctx.scene.add(coinFx);

      // レイキャスター（1個だけ作って使い回す）
      raycaster = new THREE.Raycaster();
      pointerV2 = new THREE.Vector2();

      // 「やめる」ボタン（DOM）
      stopBtn = document.createElement('button');
      stopBtn.textContent = 'やめる（かくてい）';
      stopBtn.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);' +
        'padding:12px 30px;font-size:18px;font-weight:bold;border:none;border-radius:26px;' +
        'background:#ff9800;color:#fff;z-index:11;box-shadow:0 3px 8px rgba(0,0,0,.3);display:none;';
      document.body.appendChild(stopBtn);
      stopBtn.addEventListener('click', function () {
        if (state !== 'play') return;
        stopBtn.style.display = 'none';
        C.sfx.success();
        C.endGame(C.score);
      });
    },

    start: function (ctx) {
      state = 'play';
      danger = 0;
      tiltDir = ctx.random() * Math.PI * 2;
      wobT = 0; collapseT = 0; coinFxT = 0;
      layerSink[0] = layerSink[1] = layerSink[2] = layerSink[3] = 0;

      // 全ブロック復元（プレイごとの増殖なし・使い回し）
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        b.active = true; b.flyT = 0;
        b.mesh.visible = true;
        b.mesh.position.set(b.baseX, b.baseY, b.baseZ);
        b.mesh.rotation.set(0, 0, 0);
        b.mesh.scale.set(1, 1, 1);
      }
      assignCoins(ctx);

      // 旗を頂上へもどす
      flagG.position.set(0, LAYERS.length * BLK_H, 0);
      flagG.rotation.set(0, 0, 0);
      coinFx.visible = false;
      stopBtn.style.display = '';
      ctx.setHint(ctx.t({ en: 'Lower rows = more coins & more risk!', ja: 'したの段ほど コインおおめ・キケン！', es: '¡Filas inferiores = más monedas y más riesgo!', 'pt-BR': 'Fileiras inferiores = mais moedas e mais risco!', fr: 'Rangs bas = plus de pièces et plus de risque!', de: 'Untere Reihen = mehr Münzen & mehr Risiko!', it: 'File inferiori = più monete e più rischio!', ko: '아래 줄일수록 코인 많고 위험!', 'zh-Hans': '越下层金币越多、风险越大！', tr: 'Alt sıra = daha fazla coin ve risk!' }));
    },

    onPointerDown: function (ctx, p) {
      if (state !== 'play') return;
      pointerV2.set(p.nx, p.ny);
      raycaster.setFromCamera(pointerV2, ctx.camera);
      var hits = raycaster.intersectObjects(ctx.scene.children);
      for (var h = 0; h < hits.length; h++) {
        var idx = hits[h].object.userData.idx;
        if (idx == null) continue;                 // ブロック以外は無視
        var b = blocks[idx];
        if (!b.active || b.flyT > 0) continue;

        // ---- 採取 ----
        b.flyT = 0.001;
        var a = Math.atan2(b.baseX, b.baseZ + 0.01);
        b.vx = Math.sin(a) * 3 + (ctx.random() - 0.5);
        b.vz = Math.cos(a) * 3 + (ctx.random() - 0.5);
        b.vy = 3.5;
        b.rx = (ctx.random() - 0.5) * 8;
        b.rz = (ctx.random() - 0.5) * 8;

        var gain = 1 + b.coin;
        ctx.addScore(gain);
        ctx.sfx.score();
        ctx.vibrate(15);
        ctx.setHint(b.coin > 0 ? '+' + gain + ctx.t({ en: ' coins! Treasure!', ja: ' こいん！ おたから！', es: ' monedas! ¡Tesoro!', 'pt-BR': ' moedas! Tesouro!', fr: ' pièces! Trésor!', de: ' Münzen! Schatz!', it: ' monete! Tesoro!', ko: ' 코인! 보물!', 'zh-Hans': ' 金币！宝藏！', tr: ' coin! Hazine!' }) : '+1' + ctx.t({ en: ' coin', ja: ' こいん', es: ' moneda', 'pt-BR': ' moeda', fr: ' pièce', de: ' Münze', it: ' moneta', ko: ' 코인', 'zh-Hans': ' 金币', tr: ' coin' }));

        // コイン演出
        coinFx.visible = true;
        coinFx.position.set(b.mesh.position.x, b.mesh.position.y + 0.8, b.mesh.position.z);
        coinFx.scale.set(1, 1, 1);
        coinFxT = 0.6;

        // 上の層が沈む
        for (var l = b.layer + 1; l <= LAYERS.length; l++) layerSink[l] += 0.12;

        // 危険度上昇（下の段ほど大きい）→ 閾値で崩壊
        danger += LAYER_RISK[b.layer] * (0.6 + ctx.random() * 0.8);
        wobT = 0.9;
        if (danger >= 1) collapse(ctx);
        break;
      }
    },

    update: function (ctx, dt) {
      var i, b, k;

      // 採取アニメ（飛んでいって消える）
      for (i = 0; i < blocks.length; i++) {
        b = blocks[i];
        if (!b.active || b.flyT <= 0) continue;
        b.flyT += dt;
        b.vy -= 12 * dt;
        b.mesh.position.x += b.vx * dt;
        b.mesh.position.y += b.vy * dt;
        b.mesh.position.z += b.vz * dt;
        b.mesh.rotation.x += b.rx * dt;
        b.mesh.rotation.z += b.rz * dt;
        var sc = Math.max(0, 1 - b.flyT * 1.8);
        b.mesh.scale.set(sc, sc, sc);
        if (b.flyT > 0.55) {
          b.active = false;
          b.mesh.visible = false;
        }
      }

      // コイン演出（上にふわっと）
      if (coinFxT > 0) {
        coinFxT -= dt;
        coinFx.position.y += dt * 2;
        coinFx.rotation.z += dt * 8;
        if (coinFxT <= 0) coinFx.visible = false;
      }

      if (state === 'play') {
        // 残ったブロックが沈下位置へなめらか移動
        for (i = 0; i < blocks.length; i++) {
          b = blocks[i];
          if (!b.active || b.flyT > 0) continue;
          var ty = b.baseY - layerSink[b.layer];
          b.mesh.position.y += (ty - b.mesh.position.y) * 6 * dt;
        }
        // 旗も頂上ごと沈む＋危険度でかたむく（グラッと揺れて telegraph）
        var fty = LAYERS.length * BLK_H - layerSink[LAYERS.length];
        flagG.position.y += (fty - flagG.position.y) * 6 * dt;
        var wob = 0;
        if (wobT > 0) {
          wobT -= dt;
          wob = Math.sin(wobT * 22) * wobT * 0.25;
        }
        var tilt = danger * 0.5 + wob;
        flagG.rotation.x = Math.cos(tiltDir) * tilt;
        flagG.rotation.z = Math.sin(tiltDir) * tilt;
        // 旗はためき
        flagCloth.rotation.y = Math.sin(ctx.elapsed * 3.2) * 0.3;
        return;
      }

      if (state === 'collapse') {
        collapseT += dt;
        // 旗がバタンとたおれる
        k = Math.min(1, collapseT / 0.7);
        var ct = danger * 0.5 + k * (Math.PI / 2 - danger * 0.5);
        flagG.rotation.x = Math.cos(tiltDir) * ct;
        flagG.rotation.z = Math.sin(tiltDir) * ct;
        flagG.position.y = Math.max(0.3, flagG.position.y - k * dt * 3);
        // ブロックが散らばる
        for (i = 0; i < blocks.length; i++) {
          b = blocks[i];
          if (!b.active || b.flyT > 0) continue;
          b.vy -= 10 * dt;
          b.mesh.position.x += b.vx * dt;
          b.mesh.position.y = Math.max(BLK_H / 2, b.mesh.position.y + b.vy * dt);
          b.mesh.position.z += b.vz * dt;
          b.mesh.rotation.x += b.rx * dt;
          b.mesh.rotation.z += b.rz * dt;
        }
        if (collapseT >= 1.4) ctx.gameOver(0);  // よくばりすぎ→0点
      }
    }
  });
})();
