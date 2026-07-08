/* =========================================================================
 * TFBalloonPop — ふうせんわり
 * ルール: 下からのぼってくる風船をタップで割る。60秒タイムアタック。
 *        黒い爆弾風船にさわると −10秒！連続ヒットでコンボ倍率アップ。
 * 操作: タップ
 * スコア: 割った数 + コンボボーナス (こ)
 * ========================================================================= */
(function () {
  'use strict';

  var BALLOON_N = 14, FRAG_N = 24, RING_N = 6;
  var balloons = [], bodies = [], frags = [], rings = [];
  var raycaster, pointerV2;
  var palette = [], bombMat;
  var wheel, clouds = [], airBalloon;

  var timeLeft, combo, spawnT, fragCursor, ringCursor, flashT;
  var lastSecs, lastCombo;

  /* 破裂リング（拡散） */
  function spawnRing(pos, colorHex) {
    var r = rings[ringCursor];
    ringCursor = (ringCursor + 1) % RING_N;
    r.active = true;
    r.life = 0.35;
    r.mesh.visible = true;
    r.mesh.material.color.setHex(colorHex);
    r.mesh.material.opacity = 0.9;
    r.mesh.position.copy(pos);
    r.mesh.scale.set(1, 1, 1);
  }

  function spawnFrags(pos, mat) {
    for (var k = 0; k < 6; k++) {
      var f = frags[fragCursor];
      fragCursor = (fragCursor + 1) % FRAG_N;
      f.active = true;
      f.life = 0.55;
      f.mesh.visible = true;
      f.mesh.material = mat;
      f.mesh.position.copy(pos);
      f.vx = (Math.random() - 0.5) * 5;
      f.vy = 1 + Math.random() * 3.5;
      f.vr = (Math.random() - 0.5) * 14;
    }
  }

  function updateHint(ctx) {
    var secs = Math.max(0, Math.ceil(timeLeft));
    if (secs !== lastSecs || combo !== lastCombo) {
      lastSecs = secs; lastCombo = combo;
      ctx.setHint(ctx.t({ en: 'Left: ', ja: 'のこり ', es: 'Quedan: ', 'pt-BR': 'Restam: ', fr: 'Restent : ', de: 'Rest: ', it: 'Rimangono: ', ko: '남은: ', 'zh-Hans': '剩余: ', tr: 'Kalan: ' }) + secs + ctx.t({ en: 's  Combo ', ja: 'びょう　コンボ ', es: 's  Combo ', 'pt-BR': 's  Combo ', fr: 's  Combo ', de: 's  Kombo ', it: 's  Combo ', ko: '초  콤보 ', 'zh-Hans': '秒  连击 ', tr: 's  Kombo ' }) + combo);
    }
  }

  Shell.registerGame({
    id: 'TFBalloonPop',
    title: { en: 'Balloon Pop', ja: 'ふうせんわり', es: 'Revienta Globos', 'pt-BR': 'Estoura Balões', fr: 'Éclate-Ballons', de: 'Ballons Platzen', it: 'Scoppia Palloncini', ko: '풍선 터뜨리기', 'zh-Hans': '戳气球', tr: 'Balon Patlat' },
    howto: { en: 'Tap the rising balloons to pop them!\nBlack bombs = −10 seconds!', ja: 'のぼってくる風船をタップでわろう！\n黒いばくだんは −10びょう！', es: '¡Toca los globos para reventarlos!\n¡La bomba negra = −10 segundos!', 'pt-BR': 'Toque nos balões para estourá-los!\nBomba preta = −10 segundos!', fr: 'Touchez les ballons pour les éclater !\nBombe noire = −10 secondes !', de: 'Tippe auf Ballons zum Platzen!\nSchwarze Bombe = −10 Sekunden!', it: 'Tocca i palloncini per scoppiarlì!\nBomba nera = −10 secondi!', ko: '올라오는 풍선을 탭해서 터뜨려라!\n검은 폭탄 = −10초!', 'zh-Hans': '点击升起的气球来戳破它！\n黑色炸弹 = −10秒！', tr: 'Yükselen balonlara dokun, patlat!\nSiyah bomba = −10 saniye!' },
    scoreLabel: { en: 'pcs', ja: 'こ', es: 'uds', 'pt-BR': 'pçs', fr: 'pcs', de: 'Stk', it: 'pz', ko: '개', 'zh-Hans': '个', tr: 'adet' },
    bg: 0x87ceeb,
    cameraFov: 70,
    cameraPos: [0, 0, 11],
    cameraLookAt: [0, 0, 0],

    init: function (ctx) {
      var THREE = ctx.THREE, i;

      // 風船マテリアル（共有）
      var cols = [0xef5350, 0xffca28, 0x66bb6a, 0x42a5f5, 0xab47bc, 0xff7043];
      for (i = 0; i < cols.length; i++) palette.push(Style.mat(cols[i]));
      bombMat = Style.mat(0x263238);

      // 風船プール
      var bodyGeo = new THREE.SphereGeometry(0.55, 12, 10);
      var knotGeo = new THREE.ConeGeometry(0.1, 0.16, 8);
      var strGeo = Style.roundedBox(0.02, 1.0, 0.02);
      var strMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (i = 0; i < BALLOON_N; i++) {
        var grp = new THREE.Group();
        var body = new THREE.Mesh(bodyGeo, palette[0]);
        body.scale.set(1, 1.15, 1);
        body.userData.i = i;
        var knot = new THREE.Mesh(knotGeo, palette[0]);
        knot.position.y = -0.68;
        var str = new THREE.Mesh(strGeo, strMat);
        str.position.y = -1.3;
        // 爆弾用の導火線＋火花（bomb時のみ表示 → 危険が一目で分かる）
        var fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 6),
          Style.mat(0x6b4c2a));
        fuse.position.y = 0.72;
        fuse.rotation.z = 0.3;
        fuse.visible = false;
        var spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0),
          new THREE.MeshBasicMaterial({ color: 0xffa726 }));
        spark.position.set(-0.05, 0.88, 0);
        spark.visible = false;
        grp.add(body, knot, str, fuse, spark);
        grp.visible = false;
        ctx.scene.add(grp);
        bodies.push(body);
        balloons.push({ grp: grp, body: body, knot: knot, fuse: fuse, spark: spark,
                        active: false, bomb: false,
                        speed: 0, baseX: 0, phase: 0, mat: palette[0] });
      }

      // 破片プール
      var fragGeo = new THREE.PlaneGeometry(0.2, 0.2);
      for (i = 0; i < FRAG_N; i++) {
        var fm = new THREE.Mesh(fragGeo, palette[0]);
        fm.visible = false;
        ctx.scene.add(fm);
        frags.push({ mesh: fm, active: false, life: 0, vx: 0, vy: 0, vr: 0 });
      }

      // 観覧車のシルエット（背景）
      var silMat = new THREE.MeshBasicMaterial({ color: 0x33415e });
      wheel = new THREE.Group();
      var rim = new THREE.Mesh(new THREE.TorusGeometry(7, 0.25, 8, 40), silMat);
      wheel.add(rim);
      for (i = 0; i < 4; i++) {
        var spoke = new THREE.Mesh(Style.roundedBox(0.18, 14, 0.18), silMat);
        spoke.rotation.z = i * Math.PI / 4;
        wheel.add(spoke);
      }
      var hub = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), silMat);
      wheel.add(hub);
      for (i = 0; i < 8; i++) {
        var cab = new THREE.Mesh(Style.roundedBox(0.9, 0.9, 0.4), silMat);
        var a = i * Math.PI / 4;
        cab.position.set(Math.cos(a) * 7, Math.sin(a) * 7 - 0.6, 0);
        wheel.add(cab);
      }
      wheel.position.set(2, 1, -26);
      ctx.scene.add(wheel);
      // 脚と地面のシルエット
      var legL = new THREE.Mesh(Style.roundedBox(0.4, 10, 0.4), silMat);
      legL.position.set(-1, -4, -26.2); legL.rotation.z = 0.25;
      ctx.scene.add(legL);
      var legR = new THREE.Mesh(Style.roundedBox(0.4, 10, 0.4), silMat);
      legR.position.set(5, -4, -26.2); legR.rotation.z = -0.25;
      ctx.scene.add(legR);
      var groundSil = new THREE.Mesh(Style.roundedBox(60, 3, 1), silMat);
      groundSil.position.set(0, -10.5, -26.5);
      ctx.scene.add(groundSil);

      // 破裂リングプール
      var ringGeo = new THREE.RingGeometry(0.55, 0.7, 20);
      for (i = 0; i < RING_N; i++) {
        var rmesh = new THREE.Mesh(ringGeo,
          new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0, side: THREE.DoubleSide }));
        rmesh.visible = false;
        ctx.scene.add(rmesh);
        rings.push({ mesh: rmesh, active: false, life: 0 });
      }

      // 雲（ゆっくり流れる）
      [[-8, 5, -20, 1.6, 0.35], [7, 3, -22, 2.0, 0.25], [-3, 7.5, -24, 1.3, 0.3], [4, -3, -21, 1.5, 0.28]].forEach(function (c) {
        var cloud = new THREE.Group();
        for (var ci = 0; ci < 3; ci++) {
          var puff = new THREE.Mesh(new THREE.SphereGeometry(c[3] * (0.65 + Math.random() * 0.4), 7, 5),
            new THREE.MeshBasicMaterial({ color: 0xffffff }));
          puff.position.set(ci * c[3] * 0.85 - c[3] * 0.85, (Math.random() - 0.5) * 0.35, 0);
          cloud.add(puff);
        }
        cloud.position.set(c[0], c[1], c[2]);
        ctx.scene.add(cloud);
        clouds.push({ g: cloud, sp: c[4] });
      });

      // 遠くの気球（お祭りの空気）
      airBalloon = new THREE.Group();
      var abBody = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), Style.mat(0xe07a5f));
      abBody.scale.set(1, 1.15, 1);
      airBalloon.add(abBody);
      var abStripe = new THREE.Mesh(new THREE.SphereGeometry(1.42, 12, 10), Style.mat(0xf2cc8f));
      abStripe.scale.set(1, 0.35, 1);
      airBalloon.add(abStripe);
      var abBasket = new THREE.Mesh(Style.roundedBox(0.7, 0.55, 0.7), Style.mat(0x8a5a28));
      abBasket.position.y = -2.1;
      airBalloon.add(abBasket);
      airBalloon.position.set(-7, 4, -24);
      ctx.scene.add(airBalloon);

      raycaster = new THREE.Raycaster();
      pointerV2 = new THREE.Vector2();
    },

    start: function (ctx) {
      timeLeft = 60;
      combo = 0;
      spawnT = 0;
      fragCursor = 0;
      ringCursor = 0;
      flashT = 0;
      lastSecs = -1; lastCombo = -1;
      ctx.scene.background.setHex(0x87ceeb);
      for (var i = 0; i < BALLOON_N; i++) {
        balloons[i].active = false;
        balloons[i].grp.visible = false;
      }
      for (i = 0; i < FRAG_N; i++) {
        frags[i].active = false;
        frags[i].mesh.visible = false;
      }
      for (i = 0; i < RING_N; i++) {
        rings[i].active = false;
        rings[i].mesh.visible = false;
      }
      updateHint(ctx);
    },

    onPointerDown: function (ctx, p) {
      pointerV2.set(p.nx, p.ny);
      raycaster.setFromCamera(pointerV2, ctx.camera);
      var hits = raycaster.intersectObjects(bodies);
      var b = null;
      for (var i = 0; i < hits.length; i++) {
        var cand = balloons[hits[i].object.userData.i];
        if (cand.active) { b = cand; break; }
      }
      if (!b) { combo = 0; updateHint(ctx); return; } // 空振りでコンボ切れ

      b.active = false;
      b.grp.visible = false;
      if (b.bomb) {
        // 爆弾！ −10秒
        timeLeft -= 10;
        combo = 0;
        flashT = 0.25;
        ctx.scene.background.setHex(0xe98a8a);
        spawnFrags(b.grp.position, bombMat);
        spawnRing(b.grp.position, 0xff5252);
        ctx.sfx.fail();
        ctx.vibrate(80);
      } else {
        combo++;
        var pts = combo >= 10 ? 3 : (combo >= 5 ? 2 : 1); // コンボ倍率
        ctx.addScore(pts);
        spawnFrags(b.grp.position, b.mat);
        spawnRing(b.grp.position, 0xffd54f);
        ctx.sfx.score();
        ctx.vibrate(10);
        if (combo === 5 || combo === 10) ctx.sfx.success();
      }
      updateHint(ctx);
    },

    update: function (ctx, dt) {
      var i, t = ctx.elapsed;

      timeLeft -= dt;
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) ctx.scene.background.setHex(0x87ceeb);
      }

      // 観覧車ゆっくり回転
      wheel.rotation.z += dt * 0.15;

      // 風船スポーン（だんだん速く）
      spawnT += dt;
      var interval = Math.max(0.4, 0.85 - t * 0.007);
      if (spawnT >= interval) {
        spawnT = 0;
        for (i = 0; i < BALLOON_N; i++) {
          var nb = balloons[i];
          if (!nb.active) {
            nb.active = true;
            nb.bomb = Math.random() < (t > 8 ? 0.17 : 0.06);
            nb.mat = palette[(Math.random() * palette.length) | 0];
            nb.body.material = nb.bomb ? bombMat : nb.mat;
            nb.knot.material = nb.body.material;
            nb.fuse.visible = nb.bomb;
            nb.spark.visible = nb.bomb;
            nb.baseX = Math.random() * 5.2 - 2.6;
            nb.phase = Math.random() * 6.28;
            nb.speed = 2.0 + Math.random() * 0.8 + t * 0.022;
            nb.grp.position.set(nb.baseX, -8, 0);
            nb.grp.visible = true;
            break;
          }
        }
      }

      // 風船の上昇＋ゆらゆら（爆弾は火花が点滅）
      for (i = 0; i < BALLOON_N; i++) {
        var b = balloons[i];
        if (!b.active) continue;
        b.grp.position.y += b.speed * dt;
        b.grp.position.x = b.baseX + Math.sin(t * 1.8 + b.phase) * 0.5;
        if (b.bomb) b.spark.scale.setScalar(0.7 + Math.abs(Math.sin(t * 12 + b.phase)) * 0.8);
        if (b.grp.position.y > 8) { b.active = false; b.grp.visible = false; }
      }

      // 破裂リング拡散
      for (i = 0; i < RING_N; i++) {
        var rg = rings[i];
        if (!rg.active) continue;
        rg.life -= dt;
        if (rg.life <= 0) { rg.active = false; rg.mesh.visible = false; continue; }
        var rr = rg.life / 0.35;
        var rs = 1 + (1 - rr) * 2.2;
        rg.mesh.scale.set(rs, rs, rs);
        rg.mesh.material.opacity = 0.9 * rr;
      }

      // 雲の流れ＋気球の浮遊
      for (i = 0; i < clouds.length; i++) {
        var cl = clouds[i];
        cl.g.position.x += cl.sp * dt;
        if (cl.g.position.x > 14) cl.g.position.x = -14;
      }
      airBalloon.position.y = 4 + Math.sin(t * 0.5) * 0.4;

      // 破片
      for (i = 0; i < FRAG_N; i++) {
        var f = frags[i];
        if (!f.active) continue;
        f.life -= dt;
        if (f.life <= 0) { f.active = false; f.mesh.visible = false; continue; }
        f.vy -= 6 * dt;
        f.mesh.position.x += f.vx * dt;
        f.mesh.position.y += f.vy * dt;
        f.mesh.rotation.z += f.vr * dt;
      }

      updateHint(ctx);

      // タイムアップ
      if (timeLeft <= 0) ctx.endGame(ctx.score);
    }
  });
})();
