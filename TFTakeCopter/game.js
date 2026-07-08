/* =========================================================================
 * TFTakeCopter — タケコプター
 * ルール: タップで上昇インパルス、離すと落下（Flappy縦型）。
 *        キャラは左右にゆらゆら流されるので、張り出す枝と横切る鳥を
 *        タイミングで回避しながら高く上る。カメラは少しずつ上へ進む。
 * スコア: 到達高度 (m)。コンティニューでその高度から再開。
 * ========================================================================= */
(function () {
  'use strict';

  var chara, prop, bunny, groundShadow;
  var branches = [];   // {g, active, y, side, tip}  side: -1=左から 1=右から
  var birds = [];      // {g, active, vx, wingT, wingL, wingR}
  var vyC, charY, swayT, camY, maxAlt, nextBranchY, birdTimer, grace, playT;
  var colTmp, curBand;
  var decos = [];      // 背景の飾り {g, type, baseY, phase, vx}
  var shootStars = []; // 流れ星 {g, active, vx, vy, life}
  var rings = [];      // リングエフェクトのプール {g, active, t, s}
  var debris = [];     // 死亡演出の破片プール {g, active, vx, vy, spin, life}
  var dying, dieT, dieDone, propSpin;

  // 8バンドの高度境界・空色・名前（竹林→町→雲下→雲海→夕焼け→成層圏→宇宙→星雲）
  var BAND_ALT  = [0, 40, 90, 140, 200, 270, 350, 450];
  var BAND_HEX  = [0x9fd6b0, 0xbfe0c4, 0xa9d4ef, 0x87ceeb, 0xf3a860, 0x4a63a8, 0x0d1b3d, 0x1a0f38];
  var BAND_NAME = ['たけばやし', 'まちのうえ', 'くものした', 'くもうみ', 'ゆうやけ', 'せいそうけん', 'うちゅう', 'せいうん'];
  var bandCols = [];

  var G = 13, IMPULSE = 6.6, SWAY_AMP = 1.7;

  // 高度に応じた空色（8バンドを線形補間）
  function bgColorForAlt(alt, out) {
    if (alt <= BAND_ALT[0]) { out.copy(bandCols[0]); return; }
    for (var i = 1; i < BAND_ALT.length; i++) {
      if (alt < BAND_ALT[i]) {
        var t = (alt - BAND_ALT[i - 1]) / (BAND_ALT[i] - BAND_ALT[i - 1]);
        out.copy(bandCols[i - 1]).lerp(bandCols[i], t);
        return;
      }
    }
    out.copy(bandCols[bandCols.length - 1]);
  }

  function bandIndexForAlt(alt) {
    var idx = 0;
    for (var i = 0; i < BAND_ALT.length; i++) { if (alt >= BAND_ALT[i]) idx = i; }
    return idx;
  }

  function makeChara(THREE) {
    var g = new THREE.Group();
    // 共通うさぎ（クリーム色・黒点の目のみ）。旧・のっぺり円柱人形を置き換え
    bunny = GameBunny.make(THREE, { scale: 0.62 });
    g.add(bunny.group);
    // タケコプター（軸＋羽根2枚。白飛び対策で2割暗い黄土色）
    prop = new THREE.Group();
    var axis = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.24, 6),
      Style.mat(0xd9ae2a)
    );
    axis.position.y = 0.12;
    prop.add(axis);
    var bladeMat = Style.mat(0xd9ae2a);
    var bladeGeo = Style.roundedBox(1.0, 0.03, 0.16);
    var b1 = new THREE.Mesh(bladeGeo, bladeMat);
    b1.position.y = 0.24;
    var b2 = new THREE.Mesh(bladeGeo, bladeMat);
    b2.position.y = 0.24;
    b2.rotation.y = Math.PI / 2;
    prop.add(b1, b2);
    prop.position.y = 1.3;
    g.add(prop);
    return g;
  }

  function makeBranch(THREE, scene) {
    var g = new THREE.Group();
    var stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.24, 3.8, 8),
      Style.mat(0x6b4c2a)
    );
    stem.rotation.z = Math.PI / 2;
    g.add(stem);
    // 葉は暗緑に（低高度の淡緑の空に沈まないコントラスト確保）
    var leafMat = Style.mat(0x2f7a34);
    var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 7), leafMat);
    leaf.rotation.z = -Math.PI / 2;
    leaf.position.x = 1.9;
    g.add(leaf);
    g.visible = false;
    scene.add(g);
    return { g: g, active: false, y: 0, side: -1, tip: 0 };
  }

  function makeBird(THREE, scene) {
    var g = new THREE.Group();
    var mat = Style.mat(0x5a6b7a);
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat);
    body.scale.set(1.4, 0.9, 1);
    var beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.3, 6),
      Style.mat(0xf0a030)
    );
    beak.rotation.z = -Math.PI / 2;
    beak.position.x = 0.5;
    var wingGeo = Style.roundedBox(0.34, 0.04, 0.7);
    var wingL = new THREE.Mesh(wingGeo, mat);
    wingL.position.set(-0.05, 0.15, 0.35);
    var wingR = new THREE.Mesh(wingGeo, mat);
    wingR.position.set(-0.05, 0.15, -0.35);
    g.add(body, beak, wingL, wingR);
    g.visible = false;
    scene.add(g);
    return { g: g, active: false, vx: 0, wingT: 0, wingL: wingL, wingR: wingR };
  }

  function spawnBranch(y) {
    for (var i = 0; i < branches.length; i++) {
      if (branches[i].active) continue;
      var b = branches[i];
      b.active = true;
      b.y = y;
      b.side = Math.random() < 0.5 ? -1 : 1;
      // 高度が上がるほど中央へ深く張り出す（先端は±1.05までに制限＝必ず通り道が残る）
      var reach = Math.min(maxAlt * 0.006, 1.4);
      if (b.side === -1) {
        b.tip = Math.min(-0.9 + reach + Math.random() * 0.9, 1.05);
        b.g.position.set(b.tip - 1.9, y, 0);
        b.g.rotation.y = 0;
      } else {
        b.tip = Math.max(0.9 - reach - Math.random() * 0.9, -1.05);
        b.g.position.set(b.tip + 1.9, y, 0);
        b.g.rotation.y = Math.PI;
      }
      b.g.visible = true;
      return;
    }
  }

  function spawnBird(y) {
    for (var i = 0; i < birds.length; i++) {
      if (birds[i].active) continue;
      var b = birds[i];
      b.active = true;
      var dir = Math.random() < 0.5 ? 1 : -1;
      b.vx = dir * (2.5 + Math.random() * 2 + Math.min(maxAlt * 0.004, 2));
      b.g.position.set(dir > 0 ? -9 : 9, y, 0);
      b.g.rotation.y = dir > 0 ? 0 : Math.PI;
      b.g.visible = true;
      b.wingT = 0;
      return;
    }
  }

  function spawnRing(x, y, hex, scale) {
    for (var i = 0; i < rings.length; i++) {
      if (rings[i].active) continue;
      var r = rings[i];
      r.active = true; r.t = 0; r.s = scale || 1;
      r.g.material.color.setHex(hex);
      r.g.material.opacity = 0.85;
      r.g.scale.setScalar(r.s);
      r.g.position.set(x, y, 0.9);
      r.g.visible = true;
      return;
    }
  }

  function updateFx(dt) {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (!r.active) continue;
      r.t += dt;
      var k = r.t / 0.5;
      if (k >= 1) { r.active = false; r.g.visible = false; continue; }
      r.g.scale.setScalar(r.s * (1 + k * 2.6));
      r.g.material.opacity = 0.85 * (1 - k);
    }
    for (var j = 0; j < debris.length; j++) {
      var d = debris[j];
      if (!d.active) continue;
      d.life -= dt;
      d.vy -= 12 * dt;
      d.g.position.x += d.vx * dt;
      d.g.position.y += d.vy * dt;
      d.g.rotation.x += d.spin * dt;
      d.g.rotation.z += d.spin * dt;
      if (d.life <= 0) { d.active = false; d.g.visible = false; }
    }
  }

  // 被弾: 即gameOverせず、きりもみ落下＋破片＋赤リングの0.45秒演出を挟む
  function die(ctx) {
    if (dying) return;
    dying = true; dieT = 0; dieDone = false;
    ctx.sfx.fail();
    ctx.vibrate(80);
    spawnRing(chara.position.x, charY + 0.6, 0xc7362b, 1);
    for (var i = 0; i < debris.length; i++) {
      var d = debris[i];
      var a = (i / debris.length) * Math.PI * 2;
      d.active = true; d.life = 0.9;
      d.vx = Math.cos(a) * (2 + Math.random() * 2);
      d.vy = 2.5 + Math.random() * 2.5;
      d.spin = 5 + Math.random() * 6;
      d.g.position.set(chara.position.x, charY + 0.9, 0.4);
      d.g.visible = true;
    }
    vyC = 1.4; // ふわっと浮いてから落ちる
  }

  Shell.registerGame({
    id: 'TFTakeCopter',
    title: { en: 'Bamboo Copter', ja: 'タケコプター', es: 'Helicóptero de Bambú', 'pt-BR': 'Helicóptero de Bambu', fr: 'Hélicoptère de Bambou', de: 'Bambushubschrauber', it: 'Elicottero di Bambù', ko: '대나무 헬기', 'zh-Hans': '竹蜻蜓', tr: 'Bambu Helikopter' },
    howto: { en: 'Tap rapidly to rise!\nDodge branches and birds to fly higher!', ja: 'タップれんだで じょうしょう！\nえだと とりを よけて たかく のぼろう', es: '¡Toca rápido para subir!\n¡Esquiva ramas y pájaros para volar más alto!', 'pt-BR': 'Toque rapidamente para subir!\nDesvie de galhos e pássaros para voar mais alto!', fr: 'Tapotez vite pour monter!\nÉvitez branches et oiseaux!', de: 'Schnell tippen zum Steigen!\nÄste und Vögel ausweichen!', it: 'Tocca rapidamente per salire!\nSchiva rami e uccelli!', ko: '빠르게 탭해서 상승!\n나뭇가지와 새를 피해 높이 날자!', 'zh-Hans': '快速点击上升！\n躲避树枝和鸟，飞得更高！', tr: 'Hızlıca dokun ve yüksel!\nDalları ve kuşları aşarak daha yüksek uç!' },
    scoreLabel: 'm',
    bg: 0x9fd6b0,
    cameraFov: 60,
    cameraPos: [0, 2.5, 11],
    cameraLookAt: [0, 3.5, 0],
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;

      chara = makeChara(THREE);
      ctx.scene.add(chara);

      // 背景グラデーション用カラー（8バンド）
      bandCols = BAND_HEX.map(function (h) { return new THREE.Color(h); });
      colTmp = new THREE.Color();

      // 地面（空の淡緑と分離するようやや濃い草色）
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        Style.mat(0x5f9c4e)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // 発射地点の土の輪（プレイエリアの輪郭）
      var pad = new THREE.Mesh(new THREE.CircleGeometry(2.3, 28), Style.mat(0x9c7a4a));
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.02;
      ctx.scene.add(pad);
      var padRim = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.85, 28), Style.mat(0x7d5f37));
      padRim.rotation.x = -Math.PI / 2;
      padRim.position.y = 0.015;
      ctx.scene.add(padRim);

      // 草むら・岩（地上の物語小物）
      var tuftMat = Style.mat(0x3f7c36);
      var tx = [-3.6, 3.4, -2.2, 2.8];
      var tz = [1.5, 2.0, -2.6, -2.2];
      for (var tf = 0; tf < 4; tf++) {
        var tuft = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 6), tuftMat);
        tuft.position.set(tx[tf], 0.26, tz[tf]);
        ctx.scene.add(tuft);
      }
      var rockMat = Style.mat(0x8f8778);
      for (var rk = 0; rk < 2; rk++) {
        var rock = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), rockMat);
        rock.scale.set(1.2, 0.6, 0.9);
        rock.position.set(rk === 0 ? -4.6 : 4.2, 0.18, rk === 0 ? -1.2 : 0.8);
        rock.rotation.y = rk * 1.4;
        ctx.scene.add(rock);
      }

      // 主役の接地影（上昇するとフェードアウト）
      groundShadow = Style.softShadow(0.8);
      groundShadow.position.y = 0.03;
      ctx.scene.add(groundShadow);

      // 竹林（低高度の飾り。濃緑＋張り出す笹葉で「竹」を語る）
      var bambooMat = Style.mat(0x4f8f45);
      var bambooGeo = new THREE.CylinderGeometry(0.22, 0.28, 120, 8);
      var bx = [-4.3, 4.5, -5.4, 5.6, -4.8, 5.0];
      var bz = [-3, -3.5, -5, -5.5, -7, -7.5];
      var sasaMat = Style.mat(0x2f7a34);
      for (var i = 0; i < 6; i++) {
        var stalk = new THREE.Mesh(bambooGeo, bambooMat);
        stalk.position.set(bx[i], 60, bz[i]);
        ctx.scene.add(stalk);
        if (i < 4) {
          var sasa = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 6), sasaMat);
          sasa.position.set(bx[i] + (bx[i] < 0 ? 0.7 : -0.7), 3.5 + i * 1.6, bz[i]);
          sasa.rotation.z = bx[i] < 0 ? -1.9 : 1.9;
          ctx.scene.add(sasa);
        }
      }

      // 雲（中高度の飾り）
      var cloudMat = Style.mat(0xffffff);
      for (var c = 0; c < 10; c++) {
        var cg = new THREE.Group();
        for (var j = 0; j < 3; j++) {
          var s = new THREE.Mesh(new THREE.SphereGeometry(1.1 + Math.random(), 8, 6), cloudMat);
          s.position.set(j * 1.6 - 1.6, Math.random() * 0.5, 0);
          cg.add(s);
        }
        cg.position.set((Math.random() * 2 - 1) * 7, 100 + c * 16 + Math.random() * 8, -7 - Math.random() * 4);
        ctx.scene.add(cg);
      }

      // 星（高高度の飾り）
      var starGeo = new THREE.BufferGeometry();
      var pos = [];
      for (var k = 0; k < 180; k++) {
        pos.push((Math.random() * 2 - 1) * 30, 270 + Math.random() * 350, -20 + Math.random() * 15);
      }
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      var stars = new THREE.Points(starGeo,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true }));
      ctx.scene.add(stars);

      // ---- バンド固有の飾り（非当たり・カメラ上昇で流れる） ----
      // 町の屋根（まちのうえ帯 y=42-86）: 暖色シルエット
      var roofMat = Style.mat(0x6b5a7a);
      for (var r = 0; r < 8; r++) {
        var rw = 1.4 + Math.random() * 1.6, rh = 2.0 + Math.random() * 3.2;
        var bldg = new THREE.Mesh(Style.roundedBox(rw, rh, 1.2), roofMat);
        bldg.position.set((Math.random() * 2 - 1) * 9, 42 + Math.random() * 44, -8.5 - Math.random() * 2);
        ctx.scene.add(bldg);
      }
      // 飛行機（くものした帯 y=95-135）: ゆっくり横切る
      for (var pl = 0; pl < 2; pl++) {
        var plane = new THREE.Group();
        var pBody = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.18, 2.2, 8), Style.mat(0xeaeef2));
        pBody.rotation.z = Math.PI / 2;
        var pWing = new THREE.Mesh(Style.roundedBox(0.7, 0.08, 1.9), Style.mat(0xcdd6de));
        var pTail = new THREE.Mesh(Style.roundedBox(0.5, 0.7, 0.08), Style.mat(0xcdd6de));
        pTail.position.x = -1.0;
        plane.add(pBody, pWing, pTail);
        plane.position.set((Math.random() * 2 - 1) * 8, 95 + pl * 22 + Math.random() * 8, -6);
        ctx.scene.add(plane);
        decos.push({ g: plane, type: 'plane', baseY: 0, phase: 0, vx: (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random()) });
      }
      // 気球（くもうみ帯 y=150-198）: ゆらゆら浮遊
      var balloonHues = [0xff6b6b, 0xffd166, 0x6bcB77, 0x5aa9e6];
      for (var bl = 0; bl < 4; bl++) {
        var balloon = new THREE.Group();
        var bag = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), Style.mat(balloonHues[bl % balloonHues.length]));
        bag.scale.y = 1.25;
        var basket = new THREE.Mesh(Style.roundedBox(0.35, 0.32, 0.35), Style.mat(0x8a5a2b));
        basket.position.y = -1.2;
        balloon.add(bag, basket);
        var byY = 150 + bl * 12 + Math.random() * 6;
        balloon.position.set((Math.random() * 2 - 1) * 8, byY, -6 - Math.random() * 2);
        ctx.scene.add(balloon);
        decos.push({ g: balloon, type: 'balloon', baseY: byY, phase: Math.random() * 6.28, vx: 0 });
      }
      // 衛星（うちゅう帯 y=360-440）: ゆっくり自転
      for (var st = 0; st < 2; st++) {
        var sat = new THREE.Group();
        var core = new THREE.Mesh(Style.roundedBox(0.5, 0.5, 0.6), Style.mat(0xd0d0d8));
        var panelMat = Style.mat(0x2b4a8a);
        var panL = new THREE.Mesh(Style.roundedBox(1.1, 0.05, 0.5), panelMat);
        panL.position.x = -0.9;
        var panR = new THREE.Mesh(Style.roundedBox(1.1, 0.05, 0.5), panelMat);
        panR.position.x = 0.9;
        sat.add(core, panL, panR);
        sat.position.set((Math.random() * 2 - 1) * 7, 360 + st * 45 + Math.random() * 20, -9);
        ctx.scene.add(sat);
        decos.push({ g: sat, type: 'sat', baseY: 0, phase: 0, vx: 0 });
      }
      // 流れ星プール（せいうん帯で使用）
      for (var ss = 0; ss < 4; ss++) {
        var streak = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.12, 2.2, 5),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
        );
        streak.visible = false;
        ctx.scene.add(streak);
        shootStars.push({ g: streak, active: false, vx: 0, vy: 0, life: 0 });
      }

      // リングエフェクトプール（タップ波紋・バンド到達・被弾）
      for (var rg = 0; rg < 4; rg++) {
        var ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.3, 0.045, 6, 18),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
        );
        ring.visible = false;
        ctx.scene.add(ring);
        rings.push({ g: ring, active: false, t: 0, s: 1 });
      }
      // 死亡演出の破片プール（羽根の欠片＋うさぎの毛）
      for (var db = 0; db < 6; db++) {
        var chip = new THREE.Mesh(
          Style.roundedBox(0.16, 0.16, 0.16),
          new THREE.MeshBasicMaterial({ color: db % 2 ? 0xd9ae2a : 0xf2e0c8 })
        );
        chip.visible = false;
        ctx.scene.add(chip);
        debris.push({ g: chip, active: false, vx: 0, vy: 0, spin: 0, life: 0 });
      }

      // 障害物プール
      for (var m = 0; m < 16; m++) branches.push(makeBranch(THREE, ctx.scene));
      for (var n = 0; n < 4; n++) birds.push(makeBird(THREE, ctx.scene));
    },

    start: function (ctx) {
      charY = 3; vyC = 0; swayT = 0; camY = 2.5;
      maxAlt = 0; nextBranchY = 14; birdTimer = 7; grace = 0; playT = 0;
      curBand = 0;
      chara.position.set(0, charY, 0);
      chara.rotation.set(0, 0, 0);
      chara.visible = true;
      for (var i = 0; i < branches.length; i++) { branches[i].active = false; branches[i].g.visible = false; }
      for (var j = 0; j < birds.length; j++) { birds[j].active = false; birds[j].g.visible = false; }
      for (var s = 0; s < shootStars.length; s++) { shootStars[s].active = false; shootStars[s].g.visible = false; }
      ctx.scene.background.copy(bandCols[0]);
      ctx.camera.position.set(0, camY, 11);
      ctx.camera.lookAt(0, camY + 1, 0);
      ctx.setHint(ctx.t({ en: 'Tap to rise!', ja: 'タップで じょうしょう！', es: '¡Toca para subir!', 'pt-BR': 'Toque para subir!', fr: 'Tapotez pour monter!', de: 'Tippen zum Steigen!', it: 'Tocca per salire!', ko: '탭해서 상승!', 'zh-Hans': '点击上升！', tr: 'Yükselmek için dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      vyC = IMPULSE;
      ctx.sfx.tap();
    },

    onContinue: function (ctx) {
      // その高度から再開: 近くの障害物を一掃して無敵時間を付与
      grace = 2.5;
      vyC = 1.5;
      charY = camY + 1.5;
      for (var i = 0; i < branches.length; i++) {
        if (branches[i].active && Math.abs(branches[i].y - charY) < 12) {
          branches[i].active = false;
          branches[i].g.visible = false;
        }
      }
      for (var j = 0; j < birds.length; j++) { birds[j].active = false; birds[j].g.visible = false; }
      ctx.setHint(ctx.t({ en: 'Revived!', ja: 'ふっかつ！', es: '¡Revivido!', 'pt-BR': 'Revivido!', fr: 'Revenu!', de: 'Wiederbelebt!', it: 'Rinato!', ko: '부활!', 'zh-Hans': '复活！', tr: 'Canlandı!' }));
    },

    update: function (ctx, dt) {
      playT += dt;

      // 物理: 重力とタップインパルス
      vyC = Math.max(Math.min(vyC - G * dt, 8), -9);
      charY += vyC * dt;
      if (charY < 0.6) { charY = 0.6; vyC = Math.max(vyC, 0); } // 地面すれすれは救済

      // 左右のゆらゆら（高度が上がるほど速い）
      swayT += dt * (1.1 + Math.min(maxAlt * 0.002, 0.7));
      var charX = Math.sin(swayT) * SWAY_AMP;
      chara.position.set(charX, charY, 0);
      chara.rotation.z = -Math.cos(swayT) * 0.15;
      prop.rotation.y += dt * 20;

      // カメラ: キャラ追従＋じわじわ強制上昇
      camY = Math.max(camY, charY - 2);
      if (playT > 3) camY += (0.3 + Math.min(maxAlt * 0.003, 1.0)) * dt;
      ctx.camera.position.set(0, camY, 11);
      ctx.camera.lookAt(0, camY + 1, 0);

      // スコア = 最高到達高度
      if (charY > maxAlt) {
        maxAlt = charY;
        var s = Math.floor(maxAlt);
        if (s > ctx.score) ctx.setScore(s);
      }

      // 背景色: 8バンドを高度で補間（竹林→町→雲下→雲海→夕焼け→成層圏→宇宙→星雲）
      bgColorForAlt(maxAlt, colTmp);
      ctx.scene.background.copy(colTmp);

      // バンド到達マイルストーン演出
      var bi = bandIndexForAlt(maxAlt);
      if (bi > curBand) {
        curBand = bi;
        ctx.sfx.success();
        ctx.setHint(ctx.t({ en: 'Altitude ', ja: 'たかさ ', es: 'Altitud ', 'pt-BR': 'Altitude ', fr: 'Altitude ', de: 'Höhe ', it: 'Altitudine ', ko: '고도 ', 'zh-Hans': '高度 ', tr: 'İrtifa ' }) + BAND_ALT[bi] + 'm! ' + BAND_NAME[bi]);
      }

      // 飾りアニメ（飛行機は横切り、気球はゆらゆら、衛星は自転）
      for (var d = 0; d < decos.length; d++) {
        var dc = decos[d];
        if (dc.type === 'plane') {
          dc.g.position.x += dc.vx * dt;
          if (dc.g.position.x > 10) dc.g.position.x = -10;
          else if (dc.g.position.x < -10) dc.g.position.x = 10;
          dc.g.rotation.y = dc.vx > 0 ? 0 : Math.PI;
        } else if (dc.type === 'balloon') {
          dc.phase += dt * 0.8;
          dc.g.position.y = dc.baseY + Math.sin(dc.phase) * 1.2;
          dc.g.position.x += Math.sin(dc.phase * 0.5) * dt * 0.4;
          dc.g.rotation.z = Math.sin(dc.phase) * 0.08;
        } else if (dc.type === 'sat') {
          dc.g.rotation.y += dt * 0.5;
          dc.g.rotation.x += dt * 0.2;
        }
      }

      // 流れ星（せいうん帯 350m以上でたまに流れる）
      if (maxAlt > 340 && Math.random() < dt * 0.6) {
        for (var sp = 0; sp < shootStars.length; sp++) {
          if (shootStars[sp].active) continue;
          var ssr = shootStars[sp];
          ssr.active = true;
          ssr.life = 1.0;
          ssr.vx = -(6 + Math.random() * 4);
          ssr.vy = -(3 + Math.random() * 2);
          ssr.g.position.set(6 + Math.random() * 3, camY + 5 + Math.random() * 6, -11);
          ssr.g.rotation.z = Math.atan2(ssr.vy, ssr.vx) + Math.PI / 2;
          ssr.g.visible = true;
          break;
        }
      }
      for (var sq = 0; sq < shootStars.length; sq++) {
        var ss2 = shootStars[sq];
        if (!ss2.active) continue;
        ss2.life -= dt * 1.4;
        ss2.g.position.x += ss2.vx * dt;
        ss2.g.position.y += ss2.vy * dt;
        ss2.g.material.opacity = Math.max(0, ss2.life * 0.9);
        if (ss2.life <= 0) { ss2.active = false; ss2.g.visible = false; }
      }

      // 枝の生成と回収
      while (nextBranchY < camY + 16) {
        spawnBranch(nextBranchY);
        nextBranchY += Math.max(8 + Math.random() * 6 - Math.min(maxAlt * 0.008, 3), 5.5);
      }
      for (var i = 0; i < branches.length; i++) {
        var b = branches[i];
        if (!b.active) continue;
        if (b.y < camY - 12) { b.active = false; b.g.visible = false; continue; }
        // 衝突: 枝の高さ帯にいて先端より内側
        if (grace <= 0 && Math.abs(charY - b.y) < 0.55) {
          if ((b.side === -1 && charX - 0.35 < b.tip) ||
              (b.side === 1 && charX + 0.35 > b.tip)) { die(ctx); return; }
        }
      }

      // 鳥の生成と移動
      birdTimer -= dt;
      if (birdTimer <= 0 && camY > 30) {
        spawnBird(camY + 8 + Math.random() * 4);
        birdTimer = Math.max(6 - Math.min(maxAlt * 0.01, 3), 2.5) + Math.random() * 2;
      }
      for (var j = 0; j < birds.length; j++) {
        var bd = birds[j];
        if (!bd.active) continue;
        bd.g.position.x += bd.vx * dt;
        bd.wingT += dt * 10;
        bd.wingL.rotation.x = Math.sin(bd.wingT) * 0.6;
        bd.wingR.rotation.x = -Math.sin(bd.wingT) * 0.6;
        if (Math.abs(bd.g.position.x) > 10 || bd.g.position.y < camY - 12) {
          bd.active = false; bd.g.visible = false; continue;
        }
        if (grace <= 0) {
          var dx = bd.g.position.x - charX;
          var dy = bd.g.position.y - (charY + 0.6);
          if (dx * dx + dy * dy < 0.81) { die(ctx); return; }
        }
      }

      // 画面下に落ちたら終了
      if (charY < camY - 7.5) { die(ctx); return; }

      // 無敵時間の点滅
      if (grace > 0) {
        grace -= dt;
        chara.visible = Math.floor(grace * 10) % 2 === 0;
        if (grace <= 0) chara.visible = true;
      }
    }
  });
})();
