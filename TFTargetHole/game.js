/* =========================================================================
 * TFTargetHole — ねらってポトン
 * ルール: 見下ろしのグリーンでボールを引っぱって離すと転がる（摩擦減速・
 *        壁バウンド）。障害ブロックをかわして旗つきの穴に入れる。
 *        入れるたび障害が増えて穴が遠くなる。持ち球5球。
 *        穴のふちで止まると「おしい！」演出。
 * 操作: 引っぱって離す（パチンコ式・引いた逆方向へ発射）
 * スコア: 入れた数 (ごーる)
 * ========================================================================= */
(function () {
  'use strict';

  var ball, holeG, holeMark, flagCloth, arrowG, arrowShaft, arrowHead;
  var obstacles = [];
  var ballShadow, bunny, bunnyHopT;
  var clouds = [];
  var stars = [], burstRing, ringT, ringDone;
  var resetT, resetNear;

  var BOARD_X = 4;          // 内のり半幅
  var BOARD_Z_MIN = -9, BOARD_Z_MAX = 7;
  var BALL_R = 0.35;
  var HOLE_R = 0.55;
  var START_Z = 5.5;
  var MAX_V = 14;

  // 状態
  var state;                // 'idle' | 'aim' | 'moving' | 'sinking'
  var ballsLeft, level;
  var vx, vz, aimSX, aimSY, launchVX, launchVZ, sinkT;

  /* 芝のしまもよう */
  function makeGrassTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    c.fillStyle = '#3e8e43';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#4a9e4f';
    c.fillRect(0, 0, 128, 64);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    return tex;
  }

  function updateHint(ctx) {
    ctx.setHint(ctx.t({ en: 'Drag & release! Balls left: ', ja: 'ひっぱってはなす！ のこり ', es: '¡Arrastra y suelta! Bolas: ', 'pt-BR': 'Arraste e solte! Bolas: ', fr: 'Glissez et relâchez! Balles: ', de: 'Ziehen & loslassen! Bälle: ', it: 'Trascina e rilascia! Palle: ', ko: '드래그해서 놓기! 남은 공: ', 'zh-Hans': '拖动松手！剩余球: ', tr: 'Sürükle ve bırak! Top: ' }) + ballsLeft);
  }

  function resetBall() {
    ball.position.set(0, BALL_R, START_Z);
    ball.scale.set(1, 1, 1);
    ball.material.opacity = 1;
    ball.visible = true;
    vx = 0; vz = 0;
    state = 'idle';
  }

  /* リング拡散＋星バースト（プール再利用・update内でnewしない） */
  function spawnRing(x, z, hex) {
    burstRing.material.color.setHex(hex);
    burstRing.position.set(x, 0.05, z);
    burstRing.visible = true;
    ringT = 0; ringDone = false;
  }

  function spawnBurst(ctx, x, z) {
    spawnRing(x, z, 0xffd54f);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = (i / stars.length) * Math.PI * 2 + ctx.random() * 0.6;
      s.vx = Math.cos(a) * (1.6 + ctx.random() * 1.4);
      s.vz = Math.sin(a) * (1.6 + ctx.random() * 1.4);
      s.vy = 3 + ctx.random() * 2;
      s.life = 0.55;
      s.mesh.position.set(x, 0.2, z);
      s.mesh.scale.set(1, 1, 1);
      s.mesh.visible = true;
    }
  }

  /* 穴を移動し障害を配置しなおす（レベルに応じて数が増える） */
  function layoutLevel(ctx) {
    holeG.position.x = (ctx.random() * 2 - 1) * 2.5;
    holeG.position.z = -2 - Math.min(level, 5) * 1.1;

    var count = Math.min(obstacles.length, 2 + level);
    for (var i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      ob.mesh.visible = i < count;
      ob.active = i < count;
      if (!ob.active) continue;
      // 穴と発射地点をさけてランダム配置
      var tries = 0;
      do {
        ob.x = (ctx.random() * 2 - 1) * 2.8;
        ob.z = -5.5 + ctx.random() * 8;
        tries++;
      } while (tries < 20 &&
        (Math.abs(ob.x - holeG.position.x) < 1.6 && Math.abs(ob.z - holeG.position.z) < 1.6 ||
         ob.z > 3.8));
      ob.mesh.position.set(ob.x, 0.25, ob.z);
    }
  }

  /* 発射後のショット決着（ゴール or 停止） */
  function resolveShot(ctx, goal) {
    if (goal) {
      ctx.addScore(1);
      ctx.sfx.success();
      ctx.vibrate(50);
      level++;
      layoutLevel(ctx);
    }
    if (ballsLeft <= 0) {
      ctx.endGame(ctx.score);
      return;
    }
    resetBall();
    updateHint(ctx);
  }

  Shell.registerGame({
    id: 'TFTargetHole',
    title: { en: 'Target Hole', ja: 'ねらってポトン', es: 'Tiro al Hoyo', 'pt-BR': 'Mira no Buraco', fr: 'Vise le Trou', de: 'Ziel ins Loch', it: 'Mira al Buco', ko: '구멍 조준', 'zh-Hans': '瞄准洞洞', tr: 'Deliğe Nişan' },
    howto: { en: 'Drag the ball and release to shoot!\nDodge blocks and sink it in the hole (5 balls)!', ja: 'ボールをひっぱってはなす！\nブロックをかわして あなにいれよう（5きゅう）', es: '¡Arrastra el balón y suelta para disparar!\n¡Esquiva bloques y mételo en el hoyo (5 bolas)!', 'pt-BR': 'Arraste a bola e solte para atirar!\nDesvie dos blocos e coloque no buraco (5 bolas)!', fr: 'Glissez la balle et relâchez!\nÉvitez les blocs et mettez dans le trou (5 balles)!', de: 'Ball ziehen und loslassen!\nBlöcke umgehen und ins Loch (5 Bälle)!', it: 'Trascina la palla e rilascia!\nSchiva i blocchi e metti nel buco (5 palle)!', ko: '볼을 드래그해서 놓아 슛!\n블록을 피해 구멍에 넣어라 (5구)!', 'zh-Hans': '拖动球然后松手射击！\n绕过障碍物入洞（5球）！', tr: 'Topu sürükle ve bırak!\nBlokları aş ve deliğe sok (5 top)!' },
    scoreLabel: { en: 'goal', ja: 'ごーる', es: 'gol', 'pt-BR': 'gol', fr: 'but', de: 'Ziel', it: 'gol', ko: '골', 'zh-Hans': '进', tr: 'gol' },
    bg: 0x87ceeb,
    cameraFov: 55,
    cameraPos: [0, 16, 9.5],
    cameraLookAt: [0, 0, -1],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // グリーン（しま模様の芝）
      var green = new THREE.Mesh(
        new THREE.PlaneGeometry(BOARD_X * 2 + 1, BOARD_Z_MAX - BOARD_Z_MIN + 1),
        new THREE.MeshLambertMaterial({ map: makeGrassTexture(THREE) })
      );
      green.rotation.x = -Math.PI / 2;
      green.position.z = (BOARD_Z_MIN + BOARD_Z_MAX) / 2;
      ctx.scene.add(green);
      // ティーマット（打ち出し位置の目印）
      var tee = new THREE.Mesh(Style.roundedBox(1.6, 0.06, 1.2), Style.mat(0x2f6b33));
      tee.position.set(0, 0.03, START_Z);
      ctx.scene.add(tee);
      // まわりの土
      var dirt = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        Style.mat(0x8a6c42)
      );
      dirt.rotation.x = -Math.PI / 2;
      dirt.position.y = -0.05;
      ctx.scene.add(dirt);

      // 外壁（木のふち）
      var wallMat = Style.mat(0x74522c);
      var wallH = 0.55;
      var wallSideGeo = Style.roundedBox(0.5, wallH, BOARD_Z_MAX - BOARD_Z_MIN + 1);
      var wallEndGeo = Style.roundedBox(BOARD_X * 2 + 2, wallH, 0.5);
      var wL = new THREE.Mesh(wallSideGeo, wallMat);
      wL.position.set(-BOARD_X - 0.6, wallH / 2, (BOARD_Z_MIN + BOARD_Z_MAX) / 2);
      var wR = new THREE.Mesh(wallSideGeo, wallMat);
      wR.position.set(BOARD_X + 0.6, wallH / 2, (BOARD_Z_MIN + BOARD_Z_MAX) / 2);
      var wT = new THREE.Mesh(wallEndGeo, wallMat);
      wT.position.set(0, wallH / 2, BOARD_Z_MIN - 0.6);
      var wB = new THREE.Mesh(wallEndGeo, wallMat);
      wB.position.set(0, wallH / 2, BOARD_Z_MAX + 0.6);
      ctx.scene.add(wL, wR, wT, wB);

      // 穴＋旗
      holeG = new THREE.Group();
      holeMark = new THREE.Mesh(
        new THREE.CircleGeometry(HOLE_R, 24),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
      );
      holeMark.rotation.x = -Math.PI / 2;
      holeMark.position.y = 0.012;
      holeG.add(holeMark);
      // カップの白いふち＋フリンジ（刈り込みの輪）で穴を目立たせる
      var lip = new THREE.Mesh(
        new THREE.RingGeometry(HOLE_R, HOLE_R + 0.12, 24),
        new THREE.MeshBasicMaterial({ color: 0xf5f0e6 })
      );
      lip.rotation.x = -Math.PI / 2;
      lip.position.y = 0.014;
      holeG.add(lip);
      var fringe = new THREE.Mesh(
        new THREE.RingGeometry(HOLE_R + 0.12, HOLE_R + 0.55, 24),
        new THREE.MeshLambertMaterial({ color: 0x57ab5c, transparent: true, opacity: 0.65 })
      );
      fringe.rotation.x = -Math.PI / 2;
      fringe.position.y = 0.01;
      holeG.add(fringe);
      var pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8),
        Style.mat(0xeeeeee)
      );
      pole.position.y = 0.8;
      holeG.add(pole);
      var flagGeo = new THREE.BufferGeometry();
      flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 1.6, 0,   0.7, 1.45, 0,   0, 1.3, 0
      ], 3));
      flagGeo.computeVertexNormals();
      flagCloth = new THREE.Mesh(flagGeo,
        new THREE.MeshBasicMaterial({ color: 0xe53935, side: THREE.DoubleSide }));
      holeG.add(flagCloth);
      ctx.scene.add(holeG);

      // ボール（白＋差し色ストライプで転がりが見えるように）
      ball = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_R, 14, 12),
        new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60, transparent: true })
      );
      var stripe = new THREE.Mesh(
        new THREE.TorusGeometry(BALL_R * 0.92, 0.07, 8, 20),
        Style.mat(0xd95f3b)
      );
      ball.add(stripe);
      ctx.scene.add(ball);
      // 接地影（浮いて見える対策）
      ballShadow = Style.softShadow(0.55);
      ballShadow.position.y = 0.02;
      ctx.scene.add(ballShadow);

      // うさぎゴルファー（打点の横で見守り、ゴールでぴょこん）
      bunny = GameBunny.make(THREE, { scale: 0.85 });
      bunny.group.position.set(-5.7, 0, 4.6);
      bunny.group.rotation.y = 0.5;
      ctx.scene.add(bunny.group);
      var bunnyShadow = Style.softShadow(0.7);
      bunnyShadow.position.set(-5.7, 0.02, 4.6);
      ctx.scene.add(bunnyShadow);
      bunnyHopT = 1;

      // ミッドプロップ: 木・ブッシュ・岩（コース外周の土の上）
      function tree(x, z, s) {
        var trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 1.1 * s, 6),
          Style.mat(0x6e4a26)
        );
        trunk.position.set(x, 0.55 * s, z);
        ctx.scene.add(trunk);
        var crown = new THREE.Mesh(
          new THREE.SphereGeometry(0.9 * s, 10, 8),
          Style.mat(0x3f8a2f, { flat: true })
        );
        crown.position.set(x, 1.5 * s, z);
        crown.scale.y = 0.85;
        ctx.scene.add(crown);
      }
      tree(-6.8, -5, 1.3);
      tree(6.5, -8.5, 1.6);
      var bushDefs = [[6.2, 2.5, 0.55], [-6.4, -0.5, 0.6]];
      for (var b = 0; b < bushDefs.length; b++) {
        var bush = new THREE.Mesh(
          new THREE.SphereGeometry(bushDefs[b][2], 8, 6),
          Style.mat(0x4a8a3a, { flat: true })
        );
        bush.position.set(bushDefs[b][0], bushDefs[b][2] * 0.55, bushDefs[b][1]);
        bush.scale.y = 0.7;
        ctx.scene.add(bush);
      }
      var rockDefs = [[5.9, -3], [-6.1, 6.2]];
      for (var r = 0; r < rockDefs.length; r++) {
        var rock = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.45, 0),
          Style.mat(0x8f958f, { flat: true })
        );
        rock.position.set(rockDefs[r][0], 0.25, rockDefs[r][1]);
        rock.rotation.set(r * 1.3, r * 0.7, 0);
        ctx.scene.add(rock);
      }

      // 遠景の丘＋雲（縦画面の上半分を埋める）
      var hillDefs = [[-11, -30, 10, 0.4, 0x6fa05e], [9, -33, 12, 0.35, 0x5f9052]];
      for (var h = 0; h < hillDefs.length; h++) {
        var hill = new THREE.Mesh(
          new THREE.SphereGeometry(hillDefs[h][2], 12, 8),
          Style.mat(hillDefs[h][4], { flat: true })
        );
        hill.position.set(hillDefs[h][0], 0, hillDefs[h][1]);
        hill.scale.y = hillDefs[h][3];
        ctx.scene.add(hill);
      }
      var cloudDefs = [[-6, 8.5, -18, 1.3, 0.35], [5, 10, -24, 1.7, 0.25], [0, 12, -30, 1.1, 0.45]];
      var cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (var cI = 0; cI < cloudDefs.length; cI++) {
        var cd = cloudDefs[cI];
        var cg = new THREE.Group();
        for (var p = 0; p < 3; p++) {
          var puff = new THREE.Mesh(new THREE.SphereGeometry(cd[3] * (p === 1 ? 1 : 0.65), 8, 6), cloudMat);
          puff.position.set((p - 1) * cd[3] * 0.9, (p === 1 ? 0.2 : 0), 0);
          cg.add(puff);
        }
        cg.position.set(cd[0], cd[1], cd[2]);
        ctx.scene.add(cg);
        clouds.push({ g: cg, speed: cd[4] });
      }

      // 成功エフェクトのプール（星6個＋拡散リング1個）
      var starMat = new THREE.MeshBasicMaterial({ color: 0xffd54f });
      for (var sI = 0; sI < 6; sI++) {
        var sm = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), starMat);
        sm.visible = false;
        ctx.scene.add(sm);
        stars.push({ mesh: sm, vx: 0, vy: 0, vz: 0, life: 0 });
      }
      burstRing = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.64, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.9, depthWrite: false })
      );
      burstRing.rotation.x = -Math.PI / 2;
      burstRing.visible = false;
      ctx.scene.add(burstRing);
      ringT = 0; ringDone = true;

      // ねらい矢印（引っぱり中のみ表示）
      arrowG = new THREE.Group();
      var arrowMat = new THREE.MeshBasicMaterial({ color: 0xffee58, transparent: true, opacity: 0.85 });
      arrowShaft = new THREE.Mesh(Style.roundedBox(0.14, 0.05, 1), arrowMat);
      arrowG.add(arrowShaft);
      arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 10), arrowMat);
      arrowHead.rotation.x = Math.PI / 2;
      arrowG.add(arrowHead);
      arrowG.visible = false;
      ctx.scene.add(arrowG);

      // 障害ブロックのプール
      var obMats = [
        Style.mat(0xef6c57),
        Style.mat(0x5b8dd9),
        Style.mat(0xf0b429)
      ];
      for (var i = 0; i < 8; i++) {
        var m = new THREE.Mesh(Style.roundedBox(1.7, 0.5, 0.6), obMats[i % 3]);
        m.visible = false;
        ctx.scene.add(m);
        obstacles.push({ mesh: m, x: 0, z: 0, active: false });
      }
    },

    start: function (ctx) {
      ballsLeft = 5; level = 0; sinkT = 0;
      arrowG.visible = false;
      layoutLevel(ctx);
      resetBall();
      updateHint(ctx);
    },

    onPointerDown: function (ctx, p) {
      if (state !== 'idle' || ballsLeft <= 0) return;
      state = 'aim';
      aimSX = p.x; aimSY = p.y;
      launchVX = 0; launchVZ = 0;
    },

    onPointerMove: function (ctx, p) {
      if (state !== 'aim') return;
      // 引いた逆方向へ（画面下=+z）
      launchVX = -(p.x - aimSX) * 0.045;
      launchVZ = -(p.y - aimSY) * 0.045;
      var sp = Math.sqrt(launchVX * launchVX + launchVZ * launchVZ);
      if (sp > MAX_V) { launchVX *= MAX_V / sp; launchVZ *= MAX_V / sp; sp = MAX_V; }
      if (sp > 0.8) {
        arrowG.visible = true;
        arrowG.position.copy(ball.position);
        arrowG.rotation.y = Math.atan2(launchVX, launchVZ);
        var len = 0.8 + (sp / MAX_V) * 2.6;
        arrowShaft.scale.z = len;
        arrowShaft.position.z = len / 2;
        arrowHead.position.z = len + 0.25;
      } else {
        arrowG.visible = false;
      }
    },

    onPointerUp: function (ctx, p) {
      if (state !== 'aim') return;
      arrowG.visible = false;
      var sp = Math.sqrt(launchVX * launchVX + launchVZ * launchVZ);
      if (sp < 1.2) { state = 'idle'; return; } // 引きが弱すぎ→キャンセル
      vx = launchVX; vz = launchVZ;
      ballsLeft--;
      state = 'moving';
      ctx.sfx.tap();
      ctx.vibrate(15);
      updateHint(ctx);
    },

    update: function (ctx, dt) {
      // 旗をゆらす
      flagCloth.rotation.y = Math.sin(ctx.elapsed * 3) * 0.3;

      if (state === 'sinking') {
        sinkT += dt;
        var k = Math.min(1, sinkT / 0.45);
        ball.position.x += (holeG.position.x - ball.position.x) * 10 * dt;
        ball.position.z += (holeG.position.z - ball.position.z) * 10 * dt;
        ball.position.y = BALL_R - k * 0.9;
        ball.scale.set(1 - k * 0.6, 1 - k * 0.6, 1 - k * 0.6);
        if (k >= 1) {
          ball.visible = false;
          resolveShot(ctx, true);
        }
        return;
      }

      if (state !== 'moving') return;

      ball.position.x += vx * dt;
      ball.position.z += vz * dt;

      // 摩擦減速
      var sp = Math.sqrt(vx * vx + vz * vz);
      if (sp > 0) {
        var ns = Math.max(0, sp - 2.6 * dt);
        vx *= ns / sp; vz *= ns / sp;
        ball.rotation.x += sp * dt / BALL_R * 0.5;
        sp = ns;
      }

      // 外壁バウンド
      if (ball.position.x < -BOARD_X + BALL_R) { ball.position.x = -BOARD_X + BALL_R; vx = -vx * 0.65; ctx.sfx.bounce(); }
      if (ball.position.x > BOARD_X - BALL_R) { ball.position.x = BOARD_X - BALL_R; vx = -vx * 0.65; ctx.sfx.bounce(); }
      if (ball.position.z < BOARD_Z_MIN + BALL_R) { ball.position.z = BOARD_Z_MIN + BALL_R; vz = -vz * 0.65; ctx.sfx.bounce(); }
      if (ball.position.z > BOARD_Z_MAX - BALL_R) { ball.position.z = BOARD_Z_MAX - BALL_R; vz = -vz * 0.65; ctx.sfx.bounce(); }

      // 障害ブロック（AABB を半径ぶんふくらませて判定）
      for (var i = 0; i < obstacles.length; i++) {
        var ob = obstacles[i];
        if (!ob.active) continue;
        var hx = 0.85 + BALL_R, hz = 0.3 + BALL_R;
        var dx = ball.position.x - ob.x, dz = ball.position.z - ob.z;
        if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
          // 浅い側へ押し出して反射
          var px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
          if (px < pz) {
            ball.position.x = ob.x + (dx > 0 ? hx : -hx);
            vx = -vx * 0.6;
          } else {
            ball.position.z = ob.z + (dz > 0 ? hz : -hz);
            vz = -vz * 0.6;
          }
          ctx.sfx.bounce();
          ctx.vibrate(10);
        }
      }

      // 穴の判定（ゆっくり通ると落ちる。速すぎると通過）
      var hdx = ball.position.x - holeG.position.x;
      var hdz = ball.position.z - holeG.position.z;
      var hd = Math.sqrt(hdx * hdx + hdz * hdz);
      if (hd < HOLE_R && sp < 6) {
        state = 'sinking';
        sinkT = 0;
        ctx.sfx.score();
        return;
      }

      // 停止
      if (sp < 0.15) {
        vx = 0; vz = 0;
        var near = hd < HOLE_R + 0.5; // 穴のふちで止まった
        resolveShot(ctx, false);
        if (near && ballsLeft > 0) {
          ctx.setHint(ctx.t({ en: 'So close! Balls left: ', ja: 'おしい！ のこり ', es: '¡Casi! Bolas: ', 'pt-BR': 'Quase! Bolas: ', fr: 'Presque! Balles: ', de: 'Fast! Bälle: ', it: 'Quasi! Palle: ', ko: '아깝다! 남은 공: ', 'zh-Hans': '差一点！剩余球: ', tr: 'Az kaldı! Top: ' }) + ballsLeft);
          ctx.sfx.bounce();
          ctx.vibrate(30);
        }
      }
    }
  });
})();
