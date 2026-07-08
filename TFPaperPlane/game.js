/* =========================================================================
 * TFPaperPlane — かみひこうき
 * ルール: スワイプで投げて、どこまで遠くへ飛ばせるか。
 * 操作: 上へスワイプして発射。飛行中は 長押しで機首上げ（グライド）、
 *       離すと降下して加速。パワーは使うと減る。
 * スコア: 飛距離 (m)
 * ========================================================================= */
(function () {
  'use strict';

  var plane, ground, powerBar, powerBarBg;
  var clouds = [], markers = [];
  var gates = [], nextCpIdx = 0, gateBurstT = -1, burstGate = null;
  var windReady = false, windTimer = 0, flickY = null, flickT = 0; // 風に乗るチャンス
  var flying, launched, vx, vy, power, dist, holdTime;
  var swipeStartY = null, swipeStartT = 0;
  // ビジュアルディテール
  var planeShadow, sun, mountains = [], hills = [], props = [], patches = [];
  var speedLines = [], gustRing, gustT = -1, dustPool = [], flapT = 0;
  var landing = false, landT = 0, finalDist = 0, slideVx = 0;

  var G = 9.8, DRAG = 0.12;
  var CP_PRESET = [100, 300, 500, 800, 1200, 1700, 2300, 3000];
  function cpDist(i) { return i < CP_PRESET.length ? CP_PRESET[i] : 3000 + (i - CP_PRESET.length + 1) * 800; }

  /* チェックポイントゲート: 金のリング + 距離ラベル */
  function makeGate(THREE) {
    var g = new THREE.Group();
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.3, 0.22, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd21c, transparent: true, opacity: 0.92 }));
    ring.rotation.y = Math.PI / 2; // 進行方向(+X)に正対
    ring.position.y = 3.2;
    g.add(ring);
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 96;
    var tex = new THREE.CanvasTexture(cv);
    var label = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.25),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    label.rotation.y = -Math.PI / 2;
    label.position.y = 6.4;
    g.add(label);
    g.userData.ring = ring;
    g.userData.setLabel = function (d) {
      var c = cv.getContext('2d');
      c.clearRect(0, 0, 256, 96);
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      if (c.roundRect) { c.roundRect(6, 6, 244, 84, 20); } else { c.rect(6, 6, 244, 84); }
      c.fill();
      c.fillStyle = '#e8940c';
      c.font = 'bold 52px sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(d + 'm', 128, 50);
      tex.needsUpdate = true;
    };
    return g;
  }

  function makePlane(THREE) {
    var g = new THREE.Group();
    var mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    var matFold = new THREE.MeshLambertMaterial({ color: 0xe0e6ee, side: THREE.DoubleSide });
    // 紙飛行機: 三角形の翼2枚＋中央の折り目
    var wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,   -2.4, 0.15, 1.4,   -2.4, 0.15, 0.25
    ], 3));
    wingGeo.computeVertexNormals();
    var wL = new THREE.Mesh(wingGeo, mat);
    var wR = new THREE.Mesh(wingGeo.clone(), mat);
    wR.scale.z = -1;
    var bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,   -2.4, 0.15, 0.12,   -2.4, -0.55, 0
    ], 3));
    bodyGeo.computeVertexNormals();
    var bL = new THREE.Mesh(bodyGeo, matFold);
    var bR = new THREE.Mesh(bodyGeo.clone(), matFold);
    bR.scale.z = -1;
    g.add(wL, wR, bL, bR);
    // 差し色: 背骨の赤ストライプ（折り目に沿う細板）＋翼端の青チップ
    var stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.04, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xc23434 }));
    stripe.position.set(-1.18, 0.14, 0);
    stripe.rotation.z = -0.02;
    g.add(stripe);
    var tipGeo = new THREE.BufferGeometry();
    tipGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -1.9, 0.16, 1.1,   -2.4, 0.16, 1.4,   -2.4, 0.16, 0.95
    ], 3));
    tipGeo.computeVertexNormals();
    var tipMat = new THREE.MeshLambertMaterial({ color: 0x3572b0, side: THREE.DoubleSide });
    var tL = new THREE.Mesh(tipGeo, tipMat);
    var tR = new THREE.Mesh(tipGeo.clone(), tipMat);
    tR.scale.z = -1;
    g.add(tL, tR);
    return g;
  }

  /* ---- 舞台プロップ生成（ミッドプロップは使い回しプール） ---- */
  function makeTree(THREE) {
    var g = new THREE.Group();
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6), Style.mat(0x8a6242));
    trunk.position.y = 0.7;
    g.add(trunk);
    var c1 = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.4, 7), Style.mat(0x4e9a3f, { flat: true }));
    c1.position.y = 2.4;
    g.add(c1);
    var c2 = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.8, 7), Style.mat(0x5fae4b, { flat: true }));
    c2.position.y = 3.6;
    g.add(c2);
    return g;
  }
  function makeHouse(THREE) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2), Style.mat(0xf0e3c8));
    body.position.y = 0.8;
    g.add(body);
    var roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.3, 4), Style.mat(0xb0523c, { flat: true }));
    roof.position.y = 2.2;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    var chim = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 0.35), Style.mat(0x9a7a5a));
    chim.position.set(0.6, 2.4, 0.4);
    g.add(chim);
    return g;
  }
  function makeRock(THREE) {
    var r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 + Math.random() * 0.5, 0), Style.mat(0x9aa0a6, { flat: true }));
    r.position.y = 0.4;
    r.rotation.set(Math.random(), Math.random(), 0);
    var g = new THREE.Group();
    g.add(r);
    return g;
  }
  function makeFlowerBed(THREE) {
    var g = new THREE.Group();
    var cols = [0xe06a8a, 0xe8c33c, 0xd4d4ec];
    for (var i = 0; i < 4; i++) {
      var f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5),
        new THREE.MeshLambertMaterial({ color: cols[i % 3] }));
      f.position.set((Math.random() - 0.5) * 1.6, 0.34, (Math.random() - 0.5) * 1.6);
      g.add(f);
      var st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 4), Style.mat(0x4e9a3f));
      st.position.set(f.position.x, 0.16, f.position.z);
      g.add(st);
    }
    return g;
  }

  Shell.registerGame({
    id: 'TFPaperPlane',
    title: {
      en: 'Paper Plane',
      ja: 'かみひこうき',
      es: 'Avión de Papel',
      'pt-BR': 'Avião de Papel',
      fr: 'Avion en Papier',
      de: 'Papierflieger',
      it: 'Aereo di Carta',
      ko: '종이비행기',
      'zh-Hans': '纸飞机',
      tr: 'Kağıt Uçak'
    },
    howto: {
      en: 'Swipe up to launch!\nHold during flight to glide up',
      ja: '上にスワイプでとばす！\nとんでいる間は 長おしでふわっと上しょう',
      es: '¡Desliza arriba para lanzar!\nMantén pulsado en vuelo para planear',
      'pt-BR': 'Deslize para cima para lançar!\nSegure durante o voo para planar',
      fr: 'Glissez vers le haut pour lancer !\nMaintenez en vol pour planer',
      de: 'Wische nach oben zum Starten!\nHalten während des Flugs zum Gleiten',
      it: 'Scorri su per lanciare!\nTieni premuto in volo per planare',
      ko: '위로 스와이프해서 날리자!\n비행 중 길게 누르기로 상승',
      'zh-Hans': '向上滑动来发射！\n飞行中长按以滑翔上升',
      tr: 'Yukarı kaydır ve fırlat!\nUçuşta basılı tut ve süzül'
    },
    scoreLabel: 'm',
    bg: 0x8ecdf0,
    fogNear: 60, fogFar: 220,
    cameraFov: 65,

    init: function (ctx) {
      var THREE = ctx.THREE;

      plane = makePlane(THREE);
      ctx.scene.add(plane);

      // 地面: 草原 + 10mごとの白線
      ground = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 60),
        new THREE.MeshLambertMaterial({ color: 0x7ec850 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(1900, 0, 0);
      ctx.scene.add(ground);
      for (var m = 10; m <= 3000; m += 10) {
        var line = new THREE.Mesh(
          new THREE.PlaneGeometry(0.3, 60),
          new THREE.MeshBasicMaterial({ color: m % 100 === 0 ? 0xffee58 : 0xffffff })
        );
        line.rotation.x = -Math.PI / 2;
        line.position.set(m, 0.02, 0);
        ctx.scene.add(line);
        markers.push(line);
      }

      // 地面ディテール: 濃い草パッチ（色むら）を使い回し
      var patchMat = new THREE.MeshLambertMaterial({ color: 0x6cb545 });
      for (var pt = 0; pt < 14; pt++) {
        var patch = new THREE.Mesh(new THREE.CircleGeometry(2.5 + Math.random() * 3.5, 10), patchMat);
        patch.rotation.x = -Math.PI / 2;
        patch.position.set(10 + Math.random() * 300, 0.01, (Math.random() - 0.5) * 44);
        ctx.scene.add(patch);
        patches.push(patch);
      }

      // 雲（高度・大きさに幅を持たせ、飛行中は前方へ使い回す）
      var cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      for (var i = 0; i < 24; i++) {
        var c = new THREE.Group();
        for (var j = 0; j < 3; j++) {
          var s = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 1.2, 8, 6), cloudMat);
          s.position.set(j * 2 - 2, Math.random() * 0.6, Math.random() * 0.8);
          c.add(s);
        }
        var ck = 0.7 + Math.random() * 1.3;
        c.scale.set(ck, ck * 0.8, ck);
        c.position.set(20 + Math.random() * 600, 8 + Math.random() * 26, -14 - Math.random() * 40);
        ctx.scene.add(c);
        clouds.push(c);
      }

      // ミッドプロップ: 木・家・岩・花壇（飛行コースの左右に、通過後は前方へ再配置）
      for (var pi = 0; pi < 26; pi++) {
        var kind = pi % 8;
        var prop = (kind < 4) ? makeTree(THREE)
          : (kind < 5) ? makeHouse(THREE)
          : (kind < 7) ? makeRock(THREE)
          : makeFlowerBed(THREE);
        var side = (pi % 2 === 0) ? 1 : -1;
        prop.position.set(8 + Math.random() * 340, 0, side * (7 + Math.random() * 18));
        prop.rotation.y = Math.random() * Math.PI * 2;
        ctx.scene.add(prop);
        props.push(prop);
      }

      // 遠景: 山並み（青灰の雪山）＋丘（緑）で地平線を埋める
      for (var mi = 0; mi < 8; mi++) {
        var mg = new THREE.Group();
        var mh = 16 + Math.random() * 18;
        var mw = mh * (0.9 + Math.random() * 0.5);
        var mtn = new THREE.Mesh(new THREE.ConeGeometry(mw, mh, 7),
          Style.mat(mi % 2 === 0 ? 0x7fa3c0 : 0x6d94b4, { flat: true }));
        mtn.position.y = mh / 2;
        mg.add(mtn);
        var cap = new THREE.Mesh(new THREE.ConeGeometry(mw * 0.34, mh * 0.3, 7),
          Style.mat(0xf4f7fa, { flat: true }));
        cap.position.y = mh * 0.86;
        mg.add(cap);
        // カメラは+X方向を見る → 画面の左右=Z軸。両サイドに山並みを立てる
        var mside = (mi % 2 === 0) ? 1 : -1;
        mg.position.set(mi * 85 + Math.random() * 40 - 60, 0, mside * (52 + Math.random() * 22));
        ctx.scene.add(mg);
        mountains.push(mg);
      }
      for (var hi = 0; hi < 6; hi++) {
        var hill = new THREE.Mesh(new THREE.SphereGeometry(10 + Math.random() * 8, 10, 7), Style.mat(0x74b356));
        hill.scale.y = 0.42;
        var hside = (hi % 2 === 0) ? 1 : -1;
        hill.position.set(hi * 110 + Math.random() * 50 - 40, 0, hside * (38 + Math.random() * 10));
        ctx.scene.add(hill);
        hills.push(hill);
      }

      // 太陽（カメラ相対で固定表示）
      sun = new THREE.Group();
      var sunCore = new THREE.Mesh(new THREE.CircleGeometry(7, 20),
        new THREE.MeshBasicMaterial({ color: 0xffe17a, fog: false }));
      var sunGlow = new THREE.Mesh(new THREE.CircleGeometry(11, 20),
        new THREE.MeshBasicMaterial({ color: 0xffefad, transparent: true, opacity: 0.35, fog: false }));
      sunGlow.position.z = -0.5;
      sun.add(sunCore, sunGlow);
      sun.rotation.y = -Math.PI / 2; // カメラ(-X側)に正対
      ctx.scene.add(sun);

      // 主役の接地影（高度が上がるほど小さく薄く → 高度感）
      planeShadow = Style.softShadow(2.4);
      planeShadow.material.transparent = true;
      ctx.scene.add(planeShadow);

      // スピードライン（風の線・プール）: 速いほど濃く流れる
      var slMat0 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      for (var sl = 0; sl < 10; sl++) {
        var line2 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.06), slMat0.clone());
        line2.visible = false;
        ctx.scene.add(line2);
        speedLines.push(line2);
      }

      // 突風リング（発射・風乗りの因果表示、使い回し1個）
      gustRing = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.1, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      gustRing.rotation.y = Math.PI / 2;
      gustRing.visible = false;
      ctx.scene.add(gustRing);

      // 着地の土ぼこり（プール）
      for (var dp = 0; dp < 10; dp++) {
        var d = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5),
          new THREE.MeshLambertMaterial({ color: 0xcbb98e, transparent: true, opacity: 0 }));
        d.visible = false;
        ctx.scene.add(d);
        dustPool.push(d);
      }

      // チェックポイントゲート（2基を使い回し）
      for (var gi = 0; gi < 2; gi++) {
        var gate = makeGate(THREE);
        ctx.scene.add(gate);
        gates.push(gate);
      }

      // パワーバー（DOM）
      powerBarBg = document.createElement('div');
      powerBarBg.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
        'width:56vw;height:12px;background:rgba(0,0,0,.25);border-radius:6px;z-index:11;display:none;';
      powerBar = document.createElement('div');
      powerBar.style.cssText = 'height:100%;width:100%;background:#ffee58;border-radius:6px;';
      powerBarBg.appendChild(powerBar);
      document.body.appendChild(powerBarBg);
    },

    start: function (ctx) {
      flying = false; launched = false;
      vx = 0; vy = 0; power = 1; dist = 0; holdTime = 0;
      swipeStartY = null;
      landing = false; landT = 0; gustT = -1; flapT = 0;
      plane.position.set(0, 1.6, 0);
      plane.rotation.set(0, 0, 0);
      planeShadow.position.set(0, 0.03, 0);
      planeShadow.scale.set(1, 1, 1);
      var rs;
      for (rs = 0; rs < speedLines.length; rs++) speedLines[rs].visible = false;
      for (rs = 0; rs < dustPool.length; rs++) dustPool[rs].visible = false;
      gustRing.visible = false;
      // 舞台プールを初期区間に戻す
      for (rs = 0; rs < props.length; rs++) props[rs].position.x = 8 + Math.random() * 340;
      for (rs = 0; rs < patches.length; rs++) patches[rs].position.x = 10 + Math.random() * 300;
      for (rs = 0; rs < clouds.length; rs++) clouds[rs].position.x = 20 + Math.random() * 600;
      for (rs = 0; rs < mountains.length; rs++) mountains[rs].position.x = rs * 85 + Math.random() * 40 - 60;
      for (rs = 0; rs < hills.length; rs++) hills[rs].position.x = rs * 110 + Math.random() * 50 - 40;
      // 手前から奥へ飛ばす視点: カメラは機体の真後ろ(進行軸 -X 側・Z中央)から
      // 奥(+X)を見下ろす。横視点より飛距離が分かりやすい。
      ctx.camera.position.set(-9, 4, 0);
      ctx.camera.lookAt(30, 2, 0);
      powerBar.style.width = '100%';
      powerBarBg.style.display = 'none';
      nextCpIdx = 0; gateBurstT = -1; burstGate = null;
      windReady = false; windTimer = 0; flickY = null;
      for (var gi = 0; gi < gates.length; gi++) {
        gates[gi].visible = true;
        gates[gi].scale.set(1, 1, 1);
        gates[gi].userData.ring.material.opacity = 0.92;
        gates[gi].position.set(cpDist(gi), 0, 0);
        gates[gi].userData.setLabel(cpDist(gi));
      }
      ctx.setHint(ctx.t({ en: 'Swipe up!', ja: '上にスワイプ！', es: '¡Desliza arriba!', 'pt-BR': 'Deslize para cima!', fr: 'Glissez vers le haut !', de: 'Wische nach oben!', it: 'Scorri su!', ko: '위로 스와이프!', 'zh-Hans': '向上滑动！', tr: 'Yukarı kaydır!' }));
    },

    onPointerDown: function (ctx, p) {
      if (!launched) { swipeStartY = p.y; swipeStartT = performance.now(); }
      else {
        holdTime = 0.001; // 押している間グライド
        flickY = p.y; flickT = performance.now(); // 風乗りフリック判定用
      }
    },

    onPointerUp: function (ctx, p) {
      if (!launched && swipeStartY != null) {
        var dy = swipeStartY - p.y; // 上向きスワイプ量(px)
        var dt = Math.max((performance.now() - swipeStartT) / 1000, 0.05);
        if (dy > 30) {
          var speed = Math.min(10 + (dy / dt) * 0.02, 42);
          vx = speed; vy = speed * 0.45;
          launched = true; flying = true;
          gustT = 0; // 発射リング
          gustRing.position.copy(plane.position);
          powerBarBg.style.display = '';
          ctx.setHint(ctx.t({ en: 'Hold to glide!', ja: '長おしでふわっ！', es: '¡Mantén pulsado para planear!', 'pt-BR': 'Segure para planar!', fr: 'Maintenez pour planer !', de: 'Halten zum Gleiten!', it: 'Tieni premuto per planare!', ko: '길게 누르기로 활공!', 'zh-Hans': '长按以滑翔！', tr: 'Basılı tut ve süzül!' }));
          ctx.sfx.tap();
          ctx.vibrate(20);
        }
        swipeStartY = null;
      }
      // 風に乗る: チェックポイント直後3秒間、素早い上フリックでひと伸び
      if (launched && flying && windReady && flickY != null) {
        var fdy = flickY - p.y;
        var fdur = (performance.now() - flickT) / 1000;
        if (fdy > 40 && fdur < 0.45) {
          vy = Math.max(vy, 0) + 7;
          vx += 2;
          gustT = 0; // 風乗りリング
          gustRing.position.copy(plane.position);
          windReady = false; windTimer = 0;
          ctx.sfx.score();
          ctx.vibrate(25);
          ctx.setHint(ctx.t({ en: '🌬 Riding the wind!', ja: '🌬 かぜに のった！', es: '🌬 ¡Con el viento!', 'pt-BR': '🌬 Pegou o vento!', fr: '🌬 Dans le vent !', de: '🌬 Im Wind!', it: '🌬 Sul vento!', ko: '🌬 바람을 탔다!', 'zh-Hans': '🌬 乘风而上！', tr: '🌬 Rüzgarda!' }));
        }
      }
      flickY = null;
      holdTime = 0;
    },

    update: function (ctx, dt) {
      var camX = ctx.camera.position.x;
      var i;
      // 雲をゆっくり流す＋通過したら前方へ使い回し
      for (i = 0; i < clouds.length; i++) {
        clouds[i].position.x -= dt * 0.5;
        if (clouds[i].position.x < camX - 40) {
          clouds[i].position.x = camX + 220 + Math.random() * 120;
          clouds[i].position.y = 8 + Math.random() * 26;
          clouds[i].position.z = -14 - Math.random() * 40;
        }
      }
      // ミッドプロップ・草パッチ・遠景の使い回し（無限にディテールが続く）
      for (i = 0; i < props.length; i++) {
        if (props[i].position.x < camX - 25) {
          props[i].position.x = camX + 260 + Math.random() * 120;
          var side = Math.random() < 0.5 ? 1 : -1;
          props[i].position.z = side * (7 + Math.random() * 18);
          props[i].rotation.y = Math.random() * Math.PI * 2;
        }
      }
      for (i = 0; i < patches.length; i++) {
        if (patches[i].position.x < camX - 25) {
          patches[i].position.x = camX + 240 + Math.random() * 100;
          patches[i].position.z = (Math.random() - 0.5) * 44;
        }
      }
      for (i = 0; i < mountains.length; i++) {
        if (mountains[i].position.x < camX - 120) mountains[i].position.x += 8 * 85;
      }
      for (i = 0; i < hills.length; i++) {
        if (hills[i].position.x < camX - 90) hills[i].position.x += 6 * 110;
      }
      // 太陽はカメラ相対で固定（空の目印）
      sun.position.set(camX + 150, 58, -28);

      // 突風リング（発射・風乗り）
      if (gustT >= 0) {
        gustT += dt;
        var gk = 1 + gustT * 9;
        gustRing.visible = true;
        gustRing.scale.set(gk, gk, gk);
        gustRing.material.opacity = Math.max(0, 0.8 - gustT * 2);
        if (gustT > 0.45) { gustT = -1; gustRing.visible = false; }
      }
      // 着地の土ぼこり
      for (i = 0; i < dustPool.length; i++) {
        var du = dustPool[i];
        if (!du.visible) continue;
        du.userData.t += dt;
        du.position.x += du.userData.vx * dt;
        du.position.y += du.userData.vy * dt;
        du.userData.vy -= 4 * dt;
        du.material.opacity = Math.max(0, 0.75 - du.userData.t * 1.4);
        if (du.material.opacity <= 0) du.visible = false;
      }

      // 着地演出: 瞬間終了せず 0.75秒 すべって止まる → endGame
      if (landing) {
        landT += dt;
        slideVx = Math.max(0, slideVx - slideVx * 3.2 * dt);
        plane.position.x += slideVx * dt;
        plane.position.y = 0.15 + Math.abs(Math.sin(landT * 14)) * Math.max(0, 0.3 - landT * 0.6);
        plane.rotation.z *= Math.max(0, 1 - dt * 6);
        planeShadow.position.x = plane.position.x;
        planeShadow.material.opacity = 1;
        ctx.camera.position.x = plane.position.x - 9;
        ctx.camera.position.y = Math.max(plane.position.y + 3, 4);
        ctx.camera.lookAt(plane.position.x + 30, plane.position.y * 0.6, 0);
        if (landT >= 0.75) {
          landing = false;
          ctx.endGame(finalDist);
        }
        return;
      }

      if (!flying) return;

      // 物理: 重力・空気抵抗・グライド（長押しで揚力、パワー消費）
      var gliding = holdTime > 0 && power > 0;
      if (gliding) {
        holdTime += dt;
        power = Math.max(0, power - dt * 0.45);
        vy += (G * 0.92) * dt;      // ほぼ重力を打ち消す
        vx -= vx * DRAG * 1.6 * dt; // グライド中は減速大きめ
      } else {
        vx -= vx * DRAG * dt;
      }
      vy -= G * dt;
      // 降下中は位置エネルギー→速度（ダイブ加速）
      if (vy < 0 && !gliding) vx += -vy * 0.06;

      plane.position.x += vx * dt;
      plane.position.y += vy * dt;
      plane.rotation.z = Math.atan2(vy, Math.max(vx, 0.1)) * 0.7;
      // 紙らしい生っぽさ: ゆるい横揺れ（グライド中は強め）
      flapT += dt * (gliding ? 6 : 3);
      plane.rotation.x = Math.sin(flapT) * (gliding ? 0.12 : 0.05);

      // 接地影: 高度が上がるほど小さく・薄く（高度感の演出）
      planeShadow.position.x = plane.position.x;
      var alt = Math.max(0, plane.position.y);
      var shk = Math.max(0.25, 1.4 - alt * 0.05);
      planeShadow.scale.set(shk, shk, shk);
      planeShadow.material.opacity = Math.max(0.1, 1 - alt * 0.035);

      // スピードライン: 速いほど濃く長く流れる（風を切る爽快感）
      var spd01 = Math.max(0, Math.min(1, (vx - 14) / 26));
      for (i = 0; i < speedLines.length; i++) {
        var ln = speedLines[i];
        if (!ln.visible || ln.position.x < plane.position.x - 14) {
          ln.visible = true;
          ln.position.set(plane.position.x + 14 + Math.random() * 22,
            plane.position.y + (Math.random() - 0.5) * 7,
            (Math.random() - 0.5) * 9);
        }
        ln.position.x -= vx * 1.35 * dt;
        ln.scale.x = 0.6 + spd01 * 1.6;
        ln.material.opacity = spd01 * 0.55;
      }

      dist = plane.position.x;
      ctx.setScore(Math.max(0, dist));
      powerBar.style.width = (power * 100) + '%';

      // チェックポイント通過 → パワー全回復（ながおし継続で大飛距離へ）
      if (dist >= cpDist(nextCpIdx)) {
        power = 1;
        windReady = true; windTimer = 3.0;
        ctx.sfx.success();
        ctx.vibrate(35);
        ctx.setHint('⚡' + cpDist(nextCpIdx) + 'm ' + ctx.t({ en: 'cleared!\nFlick up to ride the wind!', ja: 'とっぱ！\n上フリックで かぜに のれ！', es: '¡superado!\nDesliza arriba para el viento!', 'pt-BR': 'ultrapassado!\nDeslize para cima para o vento!', fr: 'franchi !\nGlissez vers le haut pour le vent !', de: 'geschafft!\nWische hoch für den Wind!', it: 'superato!\nScorti su per il vento!', ko: '돌파!\n위 플릭으로 바람을 타라!', 'zh-Hans': '突破！\n向上滑动乘风！', tr: 'geçildi!\nRüzgar için yukarı fırlat!' }));
        burstGate = gates[nextCpIdx % 2];
        gateBurstT = 0;
        nextCpIdx++;
        // 通過したゲートを2つ先へ回す（バースト演出後に位置変更）
      }
      if (gateBurstT >= 0 && burstGate) {
        gateBurstT += dt;
        var bk = 1 + gateBurstT * 2.2;
        burstGate.scale.set(bk, bk, bk);
        burstGate.userData.ring.material.opacity = Math.max(0, 0.92 - gateBurstT * 2.2);
        if (gateBurstT > 0.45) {
          burstGate.scale.set(1, 1, 1);
          burstGate.userData.ring.material.opacity = 0.92;
          burstGate.position.x = cpDist(nextCpIdx + 1);
          burstGate.userData.setLabel(cpDist(nextCpIdx + 1));
          gateBurstT = -1; burstGate = null;
        }
      }
      // 風チャンスの時間切れ
      if (windReady) {
        windTimer -= dt;
        if (windTimer <= 0) { windReady = false; ctx.setHint(''); }
      }

      // ゲートの待機パルス
      for (var gp = 0; gp < gates.length; gp++) {
        if (gates[gp] !== burstGate) {
          var pk2 = 1 + Math.sin(performance.now() * 0.004 + gp) * 0.05;
          gates[gp].userData.ring.scale.set(pk2, pk2, 1);
        }
      }

      // カメラ追従（真後ろから奥を見るチェイスカメラ）
      ctx.camera.position.x = plane.position.x - 9;
      ctx.camera.position.y = Math.max(plane.position.y + 3, 4);
      ctx.camera.position.z = 0;
      ctx.camera.lookAt(plane.position.x + 30, plane.position.y * 0.6, 0);

      // 接地判定（スコアは接地時点で確定。以降はすべって止まる演出のみ）
      if (plane.position.y <= 0.15) {
        flying = false;
        landing = true; landT = 0;
        finalDist = Math.max(0, dist);
        slideVx = Math.max(2, vx * 0.5);
        plane.position.y = 0.15;
        powerBarBg.style.display = 'none';
        for (i = 0; i < speedLines.length; i++) speedLines[i].visible = false;
        // 土ぼこりを巻き上げる
        for (i = 0; i < dustPool.length; i++) {
          var dd = dustPool[i];
          dd.visible = true;
          dd.userData = { t: 0, vx: 1 + Math.random() * 3, vy: 1.5 + Math.random() * 2 };
          dd.position.set(plane.position.x - Math.random() * 2, 0.3, (Math.random() - 0.5) * 1.6);
          dd.material.opacity = 0.75;
        }
        ctx.vibrate(40);
        ctx.sfx.bounce();
      }
    }
  });
})();
