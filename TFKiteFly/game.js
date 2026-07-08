/* =========================================================================
 * TFKiteFly — たこあげ
 * ルール: 横視点のたこあげ。長押しで風を受けて上昇＋右へ進み、
 *         離すと失速して下降。上空ほど風が強く得点/秒が高いが、
 *         突風に揺さぶられる(時間とともに強く)。地面に落ちたら終了。
 * 操作: 長押し / 離す
 * スコア: 高度×滞空の累積点 (てん)  / コンティニュー可
 * ========================================================================= */
(function () {
  'use strict';

  var GROUND_Y = 0.6;      // これ以下で墜落
  var G = 6.5;             // 下向きの重さ
  var LIFT = 11.5;         // 長押し中の揚力

  var kite, tail = [], stringLine, stringPos;
  var clouds = [], houses = [], kadomatsu = [];
  var birds = [], stormClouds = [], windLines = [];
  var holding, vx, vy, gustTimer, gustVy, scoreAcc, ended, hazardTimer, windT;

  /* 背景(家・雲・太陽)を開始位置に並べ直す。start のたびに呼ぶ */
  function resetBackground(random) {
    for (var h = 0; h < houses.length; h++) {
      houses[h].position.x = h * 12 + random() * 5;
    }
    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c];
      if (cl.userData.isSun) cl.position.x = 6;
      else cl.position.x = random() * 60 - 10;
    }
  }

  /* 奴凧の絵を Canvas で描いて CanvasTexture にする */
  function makeKiteTexture() {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var c = cv.getContext('2d');
    // 地の色
    c.fillStyle = '#e8412c';
    c.fillRect(0, 0, 128, 128);
    // ふち
    c.strokeStyle = '#7a1408';
    c.lineWidth = 10;
    c.strokeRect(5, 5, 118, 118);
    // 顔(奴さん)
    c.fillStyle = '#ffe3c0';
    c.beginPath(); c.arc(64, 58, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#222';
    c.beginPath(); c.arc(52, 52, 4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(76, 52, 4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(64, 68, 7, 0, Math.PI); c.fill(); // 口
    // まゆ
    c.fillRect(44, 40, 14, 4);
    c.fillRect(70, 40, 14, 4);
    // 「凧」ふうのかざり
    c.fillStyle = '#1c3f94';
    c.fillRect(20, 96, 88, 16);
    return cv;
  }

  function makeBird(THREE) {
    var g = new THREE.Group();
    var mat = Style.mat(0x4a4a4a);
    var body = new THREE.Mesh(Style.roundedBox(0.42, 0.18, 0.16), mat);
    var wingL = new THREE.Mesh(Style.roundedBox(0.55, 0.05, 0.12), mat);
    var wingR = new THREE.Mesh(Style.roundedBox(0.55, 0.05, 0.12), mat);
    wingL.position.set(-0.36, 0, 0);
    wingR.position.set(0.36, 0, 0);
    g.add(body, wingL, wingR);
    g.userData = { active: false, vx: 0, phase: 0, radius: 0.75 };
    g.visible = false;
    return g;
  }

  function makeStormCloud(THREE) {
    var g = new THREE.Group();
    var mat = Style.mat(0x5d6470);
    for (var i = 0; i < 4; i++) {
      var s = new THREE.Mesh(new THREE.SphereGeometry(0.8 + i * 0.12, 8, 6), mat);
      s.position.set(i * 0.75 - 1.1, Math.sin(i) * 0.2, 0);
      g.add(s);
    }
    var bolt = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 3), Style.mat(0xffeb3b));
    bolt.position.y = -0.9;
    bolt.rotation.z = Math.PI;
    g.add(bolt);
    g.userData = { active: false, vx: 0, phase: 0, radius: 1.75 };
    g.visible = false;
    return g;
  }

  function spawnHazard(ctx, y) {
    var useStorm = y > 10 && ctx.random() < 0.35;
    var pool = useStorm ? stormClouds : birds;
    for (var i = 0; i < pool.length; i++) {
      var h = pool[i];
      if (h.userData.active) continue;
      var dir = ctx.random() < 0.5 ? 1 : -1;
      h.position.set(kite.position.x - dir * (18 + ctx.random() * 8),
        Math.max(3, Math.min(28, y + (ctx.random() - 0.5) * 8)),
        useStorm ? -0.6 : 0.2);
      h.userData.active = true;
      h.userData.vx = dir * (useStorm ? 1.0 + ctx.random() * 0.7 : 3.2 + ctx.random() * 1.8);
      h.userData.phase = ctx.random() * Math.PI * 2;
      h.visible = true;
      return;
    }
  }

  Shell.registerGame({
    id: 'TFKiteFly',
    title: { en: 'Kite Flying', ja: 'たこあげ', es: 'Vuela la Cometa', 'pt-BR': 'Voe a Pipa', fr: 'Cerf-Volant', de: 'Drachensteigen', it: 'Aquilone', ko: '연날리기', 'zh-Hans': '放风筝', tr: 'Uçurtma Uç' },
    howto: { en: 'Hold to rise!\nWatch the edges!\nAvoid birds & storm clouds', ja: 'ながおしで じょうしょう！\nはしに でたら アウト！\nとりと かみなりぐもに きをつけて', es: '¡Mantén pulsado para subir!\n¡No salgas del borde!\nEvita pájaros y nubes de tormenta', 'pt-BR': 'Segure para subir!\nCuidado com as bordas!\nEvite pássaros e nuvens de tempestade', fr: 'Maintenez pour monter !\nGare aux bords !\nÉvitez les oiseaux et les nuages d\'orage', de: 'Halten zum Steigen!\nAus dem Rand bleiben!\nVögel & Gewitterwolken meiden', it: 'Tieni premuto per salire!\nAttenzione ai bordi!\nEvita uccelli e nuvole temporalesche', ko: '길게 눌러 상승!\n경계를 벗어나면 아웃!\n새와 뇌우구름 조심', 'zh-Hans': '长按上升！\n不要超出边界！\n躲避鸟和雷云', tr: 'Yükselmek için basılı tut!\nSınırdan çıkma!\nKuşlardan ve fırtına bulutlarından kaçın' },
    scoreLabel: { en: 'pts', ja: 'てん', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pt', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0xbfe3f7,
    cameraFov: 60,
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 凧本体(ひし形に見えるよう45°回転した板)
      var tex = new THREE.CanvasTexture(makeKiteTexture());
      kite = new THREE.Group();
      var sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 1.7),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      );
      sheet.rotation.z = Math.PI / 4;
      kite.add(sheet);
      ctx.scene.add(kite);

      // しっぽ(小さな板を連ねる)
      var tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      var tailGeo = new THREE.PlaneGeometry(0.28, 0.42);
      for (var i = 0; i < 5; i++) {
        var t = new THREE.Mesh(tailGeo, tailMat);
        ctx.scene.add(t);
        tail.push(t);
      }

      // 凧糸(下へ伸びる線。毎フレーム頂点だけ更新)
      stringPos = new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3);
      stringPos.setUsage(THREE.DynamicDrawUsage);
      var lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', stringPos);
      stringLine = new THREE.Line(lineGeo,
        new THREE.LineBasicMaterial({ color: 0x666666 }));
      ctx.scene.add(stringLine);

      // 地面(雪まじりの正月の野原)
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(600, 30),
        Style.mat(0xeef4e8)
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(200, 0, 0);
      ctx.scene.add(ground);

      // 家のシルエット(使い回してループさせる)
      var houseMat = Style.mat(0x8d7f70);
      var roofMat = Style.mat(0x5c4a3a);
      for (var h = 0; h < 6; h++) {
        var g = new THREE.Group();
        var body = new THREE.Mesh(Style.roundedBox(2.2, 1.4, 1.6), houseMat);
        body.position.y = 0.7;
        var roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.0, 4), roofMat);
        roof.position.y = 1.9;
        roof.rotation.y = Math.PI / 4;
        g.add(body, roof);
        g.position.set(h * 12 + Math.random() * 5, 0, -6 - Math.random() * 4);
        ctx.scene.add(g);
        houses.push(g);
      }

      // 雲(使い回してループさせる)
      var cloudMat = Style.mat(0xffffff);
      for (var cI = 0; cI < 10; cI++) {
        var c = new THREE.Group();
        for (var j = 0; j < 3; j++) {
          var s = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random(), 8, 6), cloudMat);
          s.position.set(j * 1.8 - 1.8, Math.random() * 0.5, 0);
          c.add(s);
        }
        c.position.set(Math.random() * 60 - 10, 6 + Math.random() * 18, -10 - Math.random() * 8);
        ctx.scene.add(c);
        clouds.push(c);
      }

      // お正月の太陽
      var sun = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 24),
        new THREE.MeshBasicMaterial({ color: 0xffb347 })
      );
      sun.position.set(6, 22, -20);
      ctx.scene.add(sun);
      sun.userData.isSun = true;
      clouds.push(sun); // 雲と同じくX方向ループに乗せる

      // 門松（お正月の地上プロップ。家と同じくX方向ループ）
      for (var km = 0; km < 4; km++) {
        var kg = new THREE.Group();
        var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.5, 10), Style.mat(0x5a4632));
        pot.position.y = 0.25;
        kg.add(pot);
        for (var bamboo = 0; bamboo < 3; bamboo++) {
          var bh = 0.9 + bamboo * 0.25;
          var bam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, bh, 6), Style.mat(0x6f9c3a));
          bam.position.set((bamboo - 1) * 0.14, 0.5 + bh / 2, 0);
          var tip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.02, 0.14, 6), Style.mat(0xd8c9a8));
          tip.position.set((bamboo - 1) * 0.14, 0.5 + bh + 0.02, 0);
          kg.add(bam, tip);
        }
        kg.position.set(km * 14 + 4, 0, -3.5);
        ctx.scene.add(kg);
        kadomatsu.push(kg);
      }

      // 風の筋（長押し中に凧の背後を流れる。上昇の手応えを可視化）
      var windMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
      for (var wl = 0; wl < 8; wl++) {
        var wm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.06), windMat.clone());
        wm.visible = false;
        ctx.scene.add(wm);
        windLines.push({ mesh: wm, x: 0, y: 0, life: 0 });
      }

      for (var bi = 0; bi < 3; bi++) {
        var bird = makeBird(THREE);
        ctx.scene.add(bird);
        birds.push(bird);
      }
      for (var si = 0; si < 2; si++) {
        var storm = makeStormCloud(THREE);
        ctx.scene.add(storm);
        stormClouds.push(storm);
      }
    },

    start: function (ctx) {
      holding = false;
      vx = 2.0; vy = 0;
      gustTimer = 2.0; gustVy = 0;
      scoreAcc = 0;
      ended = false;
      hazardTimer = 1.6;
      windT = 0;
      for (var wi = 0; wi < windLines.length; wi++) { windLines[wi].life = 0; windLines[wi].mesh.visible = false; }
      kite.position.set(0, 4, 0);
      kite.rotation.set(0, 0, 0);
      for (var i = 0; i < tail.length; i++) {
        tail[i].position.set(-0.5 - i * 0.4, 3.2, 0);
      }
      resetBackground(ctx.random);
      for (var b = 0; b < birds.length; b++) {
        birds[b].userData.active = false;
        birds[b].visible = false;
      }
      for (var s = 0; s < stormClouds.length; s++) {
        stormClouds[s].userData.active = false;
        stormClouds[s].visible = false;
      }
      // カメラを初期位置へスナップ(前回プレイの位置から飛ばないように)
      ctx.camera.position.set(1.5, 4.5, 13);
      ctx.camera.lookAt(1.5, 3.5, 0);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Hold to rise!', ja: 'ながおしで じょうしょう！', es: '¡Mantén pulsado para subir!', 'pt-BR': 'Segure para subir!', fr: 'Maintenez pour monter !', de: 'Halten zum Steigen!', it: 'Tieni premuto per salire!', ko: '길게 누르기로 상승!', 'zh-Hans': '长按上升！', tr: 'Yükselmek için basılı tut!' }));
    },

    onContinue: function (ctx) {
      // 中くらいの高さから再開(スコアはそのまま)
      ended = false;
      holding = false;
      vx = 2.0; vy = 0; gustVy = 0; gustTimer = 2.0;
      hazardTimer = 1.4;
      kite.position.y = 8;
      kite.rotation.set(0, 0, 0);
      ctx.setHint(ctx.t({ en: 'Continue!', ja: 'つづきから！', es: '¡Continúa!', 'pt-BR': 'Continuar!', fr: 'On continue !', de: 'Weiter!', it: 'Continua!', ko: '계속!', 'zh-Hans': '继续！', tr: 'Devam!' }));
    },

    onPointerDown: function (ctx, p) { holding = true; },
    onPointerUp: function (ctx, p) { holding = false; },

    update: function (ctx, dt) {
      if (ended) return;
      var y = kite.position.y;
      var time = ctx.elapsed;

      // 風: 上空ほど強い
      var windPower = 1 + y * 0.06;

      // 上下の力
      if (holding) {
        vy += (LIFT * Math.min(windPower, 2.2) - G) * dt;
        vx += (2.5 * windPower - vx) * dt * 1.2; // 風に乗って右へ
      } else {
        vy -= G * dt;
        vx += (1.0 - vx) * dt * 1.5; // 失速
      }

      // 突風(時間と高度でどんどん強く・間隔も短く)
      gustTimer -= dt;
      if (gustTimer <= 0) {
        var strength = (0.8 + time * 0.045) * (0.6 + y * 0.05);
        gustVy = (ctx.random() < 0.65 ? -1 : 0.6) * strength * (0.7 + ctx.random() * 0.6);
        gustTimer = Math.max(0.7, 2.2 - time * 0.02) * (0.6 + ctx.random() * 0.8);
        if (gustVy < -1.5) ctx.setHint(ctx.t({ en: 'Gust!', ja: 'とっぷう！', es: '¡Ráfaga!', 'pt-BR': 'Rajada!', fr: 'Bourrasque !', de: 'Windböe!', it: 'Raffica!', ko: '돌풍!', 'zh-Hans': '突风！', tr: 'Rüzgar!' }));
      }
      vy += gustVy * dt * 2.2;
      gustVy *= Math.max(0, 1 - dt * 1.8); // 突風は減衰

      // 上下速度制限と移動
      vy = Math.max(-7, Math.min(6, vy));
      kite.position.y += vy * dt;
      kite.position.x += vx * dt;

      // 揺れ(見た目)
      kite.rotation.z = Math.max(-0.6, Math.min(0.6, -vy * 0.06)) + Math.sin(time * 3.1) * 0.06;

      // しっぽ: 先頭は凧、後ろは前をゆっくり追う
      var px = kite.position.x - 0.7, py = kite.position.y - 0.8;
      for (var i = 0; i < tail.length; i++) {
        var t = tail[i];
        t.position.x += (px - t.position.x) * Math.min(dt * 9, 1);
        t.position.y += (py - t.position.y) * Math.min(dt * 9, 1);
        t.rotation.z = Math.sin(time * 5 + i) * 0.4;
        px = t.position.x - 0.34;
        py = t.position.y - 0.3;
      }

      // 凧糸: 凧から左下(あげている子のいる地面)へ
      stringPos.setXYZ(0, kite.position.x, kite.position.y - 0.6, 0);
      stringPos.setXYZ(1, kite.position.x - 6, 0.4, 0);
      stringPos.needsUpdate = true;

      // 得点: 高いほど加算が速い
      scoreAcc += (1 + y * 0.45) * dt;
      ctx.setScore(Math.floor(scoreAcc));
      if (!holding && y > 3) ctx.setHint('');
      if (holding && y > 14) ctx.setHint(ctx.t({ en: 'Strong wind!', ja: 'かぜが つよいぞ！', es: '¡Viento fuerte!', 'pt-BR': 'Vento forte!', fr: 'Vent fort !', de: 'Starker Wind!', it: 'Vento forte!', ko: '강한 바람!', 'zh-Hans': '强风！', tr: 'Güçlü rüzgar!' }));

      // 背景ループ(雲・家はカメラの左に出たら右へ回す)
      var camX = kite.position.x;
      for (var c = 0; c < clouds.length; c++) {
        var cl = clouds[c];
        cl.position.x -= dt * (cl.userData.isSun ? 0.3 : 1.2); // 風で左へ流れる
        if (cl.position.x < camX - 25) cl.position.x += 60 + Math.random() * 10;
      }
      for (var h = 0; h < houses.length; h++) {
        if (houses[h].position.x < camX - 20) houses[h].position.x += 72;
      }
      for (var km2 = 0; km2 < kadomatsu.length; km2++) {
        if (kadomatsu[km2].position.x < camX - 22) kadomatsu[km2].position.x += 56;
      }

      // 風の筋（長押し中に発生・凧の背後から流れる）
      if (holding) {
        windT -= dt;
        if (windT <= 0) {
          windT = 0.09;
          for (var ws = 0; ws < windLines.length; ws++) {
            if (windLines[ws].life > 0) continue;
            windLines[ws].life = 0.5;
            windLines[ws].x = kite.position.x - 1.5;
            windLines[ws].y = kite.position.y + (Math.random() - 0.5) * 2.4;
            windLines[ws].mesh.visible = true;
            break;
          }
        }
      }
      for (var wu = 0; wu < windLines.length; wu++) {
        var w = windLines[wu];
        if (w.life <= 0) continue;
        w.life -= dt;
        w.x -= dt * 9;   // 左後方へ流れる
        w.y += dt * 1.2; // 少し上へ
        w.mesh.position.set(w.x, w.y, 0.3);
        w.mesh.material.opacity = Math.max(0, w.life / 0.5) * 0.55;
        if (w.life <= 0) w.mesh.visible = false;
      }

      // カメラ追従
      ctx.camera.position.x += (camX + 1.5 - ctx.camera.position.x) * Math.min(dt * 4, 1);
      var cy = Math.max(4, kite.position.y * 0.75 + 1.5);
      ctx.camera.position.y += (cy - ctx.camera.position.y) * Math.min(dt * 4, 1);
      ctx.camera.position.z = 13;
      ctx.camera.lookAt(camX + 1.5, Math.max(3, kite.position.y * 0.8), 0);

      // 鳥と雷雲。高く上がるほど出現間隔が短くなる
      hazardTimer -= dt;
      if (hazardTimer <= 0) {
        spawnHazard(ctx, y);
        hazardTimer = Math.max(0.75, 3.0 - y * 0.07) * (0.75 + ctx.random() * 0.65);
      }
      var pools = [birds, stormClouds];
      for (var pi = 0; pi < pools.length; pi++) {
        for (var hi = 0; hi < pools[pi].length; hi++) {
          var hz = pools[pi][hi];
          if (!hz.userData.active) continue;
          hz.position.x += hz.userData.vx * dt;
          hz.position.y += Math.sin(ctx.elapsed * 2.3 + hz.userData.phase) * dt * (pi === 0 ? 0.8 : 0.25);
          hz.rotation.z = Math.sin(ctx.elapsed * 5 + hz.userData.phase) * (pi === 0 ? 0.18 : 0.04);
          var hdx = hz.position.x - kite.position.x;
          var hdy = hz.position.y - kite.position.y;
          if (hdx * hdx + hdy * hdy < hz.userData.radius * hz.userData.radius) {
            ended = true;
            ctx.sfx.fail();
            ctx.vibrate(90);
            ctx.gameOver(Math.floor(scoreAcc));
            return;
          }
          if (Math.abs(hz.position.x - camX) > 32) {
            hz.userData.active = false;
            hz.visible = false;
          }
        }
      }

      // 視界外OUT。完全に出る前に警告ヒントを出す
      var worldH = 2 * Math.tan(60 / 2 * Math.PI / 180) * 13;
      var worldW = worldH * ctx.width / ctx.height;
      var relX = kite.position.x - ctx.camera.position.x;
      var relY = kite.position.y - ctx.camera.position.y;
      var warn = Math.abs(relX) > worldW * 0.55 || relY > worldH * 0.55;
      if (warn) ctx.setHint(ctx.t({ en: 'Come back!', ja: 'もどれ〜！', es: '¡Vuelve!', 'pt-BR': 'Volte!', fr: 'Revenez !', de: 'Zurück!', it: 'Torna indietro!', ko: '돌아와!', 'zh-Hans': '回来！', tr: 'Geri dön!' }));
      if (Math.abs(relX) > worldW * 0.75 || relY > worldH * 0.75) {
        ended = true;
        ctx.sfx.fail();
        ctx.vibrate(90);
        ctx.gameOver(Math.floor(scoreAcc));
        return;
      }

      // 墜落判定
      if (kite.position.y <= GROUND_Y) {
        ended = true;
        kite.position.y = GROUND_Y;
        ctx.sfx.fail();
        ctx.vibrate(80);
        ctx.gameOver(Math.floor(scoreAcc));
      }
    }
  });
})();
