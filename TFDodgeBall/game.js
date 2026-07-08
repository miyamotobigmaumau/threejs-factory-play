/* =========================================================================
 * TFDodgeBall — ドッジボール
 * ルール: 奥の3人から投げ込まれるボールを左右ドラッグで回避。
 *        着弾予告リング（影マーカー）→ バウンドの2段階で迫ってくる。
 *        時間とともに頻度・速度がアップ。被弾で終了。
 * スコア: 生存秒 (びょう)。コンティニュー可（ボール一掃で再開）。
 * ========================================================================= */
(function () {
  'use strict';

  var player, playerShadow, throwers = [], throwAnim = [0, 0, 0];
  var balls = [];  // {mesh, shadow, target, active, vx, vy, vz, bounced}
  var puffs = [];  // バウンド砂煙プール
  var px, myTime, spawnT, state, hitT, grace;

  var G = 9.8, BALL_R = 0.35, PLAYER_Z = 6, LIMIT_X = 3.6;
  var THROWER_X = [-4, 0, 4], THROWER_Z = -14;

  function makeFloorTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    g.fillStyle = '#c8965a';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#b3824a';
    g.lineWidth = 3;
    for (var x = 0; x <= 128; x += 32) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 1;
    for (var y = 0; y <= 128; y += 16) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    return tex;
  }

  function makePerson(THREE, shirt) {
    var g = new THREE.Group();
    var legs = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.18, 0.5, 8),
      Style.mat(0xffffff)
    );
    legs.position.y = 0.25;
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.3, 0.7, 10),
      Style.mat(shirt)
    );
    body.position.y = 0.85;
    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      Style.mat(0xffd9b0)
    );
    head.position.y = 1.45;
    var cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.29, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
      Style.mat(0xffffff)
    );
    cap.position.y = 1.48;
    g.add(legs, body, head, cap);
    // 顔（黒い点目・こちら向き=+Z）
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    var eyeGeo = new THREE.SphereGeometry(0.045, 6, 5);
    var eL = new THREE.Mesh(eyeGeo, eyeMat);
    eL.position.set(-0.1, 1.48, 0.25);
    var eR = new THREE.Mesh(eyeGeo, eyeMat);
    eR.position.set(0.1, 1.48, 0.25);
    g.add(eL, eR);
    return g;
  }

  function spawnBall(ctx) {
    for (var i = 0; i < balls.length; i++) {
      if (balls[i].active) continue;
      var b = balls[i];
      var ti = Math.floor(Math.random() * 3);
      var sx = THROWER_X[ti], sy = 1.6, sz = THROWER_Z;
      // 着弾点: 65%はプレイヤー狙い
      var tx = Math.random() < 0.65
        ? px + (Math.random() * 1.2 - 0.6)
        : Math.random() * 7 - 3.5;
      tx = Math.max(Math.min(tx, LIMIT_X), -LIMIT_X);
      var tz = 3.5 + Math.random() * 2;
      var T = Math.max(1.5 - myTime * 0.012, 0.75); // だんだん速球に
      b.active = true;
      b.bounced = false;
      b.mesh.visible = true;
      b.shadow.visible = true;
      b.target.visible = true;
      b.mesh.position.set(sx, sy, sz);
      b.vx = (tx - sx) / T;
      b.vz = (tz - sz) / T;
      b.vy = ((BALL_R - sy) + 0.5 * G * T * T) / T;
      b.target.position.set(tx, 0.02, tz);
      throwAnim[ti] = 0.35; // 投げモーション
      return;
    }
  }

  Shell.registerGame({
    id: 'TFDodgeBall',
    title: { en: 'Dodge Ball', ja: 'ドッジボール', es: 'Balón Prisionero', 'pt-BR': 'Queimada', fr: 'Balle au Prisonnier', de: 'Völkerball', it: 'Palla Prigioniera', ko: '피구', 'zh-Hans': '躲避球', tr: 'Dodge Topu' },
    howto: { en: 'Dodge flying balls by dragging left/right!\nRed ring = landing warning!', ja: 'とんでくるボールを 左右ドラッグでよけろ！\n赤いわっかは ちゃくだんよこく', es: '¡Esquiva las pelotas deslizando izquierda/derecha!\n¡El aro rojo = aviso de impacto!', 'pt-BR': 'Desvie das bolas deslizando para os lados!\nAro vermelho = aviso de queda!', fr: 'Évitez les balles en glissant gauche/droite !\nAnneau rouge = avertissement d\'impact !', de: 'Weiche Bällen durch Links/Rechts-Wischen aus!\nRoter Ring = Aufprallwarnung!', it: 'Schiva le palle scivolando a sinistra/destra!\nAnello rosso = avviso impatto!', ko: '날아오는 공을 좌우 드래그로 피해라!\n빨간 링 = 착탄 예고!', 'zh-Hans': '左右滑动躲避飞来的球！\n红色圆圈=落点预告！', tr: 'Uçan toplardan sola/sağa kaydırarak kaç!\nKırmızı halka = çarpma uyarısı!' },
    scoreLabel: { en: 'sec', ja: 'びょう', es: 'seg', 'pt-BR': 'seg', fr: 's', de: 's', it: 's', ko: '초', 'zh-Hans': '秒', tr: 'sn' },
    bg: 0xdce8f0,
    cameraFov: 55,
    cameraPos: [0, 6.0, 13],
    cameraLookAt: [0, 1.2, -2],
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 体育館の床＋コートライン
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 44),
        new THREE.MeshLambertMaterial({ map: makeFloorTexture(THREE) })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.z = -6;
      ctx.scene.add(floor);
      var lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      var lineH = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.12), lineMat);
      lineH.rotation.x = -Math.PI / 2;
      lineH.position.set(0, 0.01, -4);
      ctx.scene.add(lineH);
      var lineGeoV = new THREE.PlaneGeometry(0.12, 28);
      for (var l = 0; l < 2; l++) {
        var lv = new THREE.Mesh(lineGeoV, lineMat);
        lv.rotation.x = -Math.PI / 2;
        lv.position.set(l === 0 ? -8 : 8, 0.01, -4);
        ctx.scene.add(lv);
      }

      // 壁
      var wallMat = Style.mat(0xe8dcc0);
      var back = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), wallMat);
      back.position.set(0, 6, -22);
      ctx.scene.add(back);
      var sideGeo = new THREE.PlaneGeometry(44, 12);
      var wl = new THREE.Mesh(sideGeo, wallMat);
      wl.rotation.y = Math.PI / 2;
      wl.position.set(-12, 6, -6);
      ctx.scene.add(wl);
      var wr = new THREE.Mesh(sideGeo, wallMat);
      wr.rotation.y = -Math.PI / 2;
      wr.position.set(12, 6, -6);
      ctx.scene.add(wr);

      // 体育館の高窓（明るい空色。上部の空白を埋める）
      var winMat = new THREE.MeshBasicMaterial({ color: 0xbfe3f2 });
      var sashMat = Style.mat(0xbcb0a0);
      for (var w = 0; w < 4; w++) {
        var win = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.0), winMat);
        win.position.set(w * 6 - 9, 9.2, -21.8);
        ctx.scene.add(win);
        var sash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 3.0), sashMat);
        sash.position.set(w * 6 - 9, 9.2, -21.75);
        ctx.scene.add(sash);
        var sashH = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.12), sashMat);
        sashH.position.set(w * 6 - 9, 9.2, -21.75);
        ctx.scene.add(sashH);
      }
      // 横断幕（紅白の応援幕）
      var bannerCols = [0xc0392b, 0x2874a6, 0x239b56];
      for (var bn = 0; bn < 3; bn++) {
        var banner = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.9), Style.mat(bannerCols[bn]));
        banner.position.set(bn * 6 - 6, 4.4, -21.7);
        ctx.scene.add(banner);
      }
      // スコアボード
      var board = new THREE.Mesh(Style.roundedBox(3.2, 1.6, 0.2), Style.mat(0x2c3e50));
      board.position.set(0, 6.6, -21.6);
      ctx.scene.add(board);
      var boardFace = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.1), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      boardFace.position.set(0, 6.6, -21.48);
      ctx.scene.add(boardFace);
      for (var dg = 0; dg < 2; dg++) {
        var digit = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), new THREE.MeshBasicMaterial({ color: 0xff6b3d }));
        digit.position.set(dg === 0 ? -0.5 : 0.5, 6.6, -21.44);
        ctx.scene.add(digit);
      }

      // 投げ手3人（奥）
      var shirts = [0xd94f4f, 0x4ea86b, 0xf0a030];
      for (var i = 0; i < 3; i++) {
        var t = makePerson(THREE, shirts[i]);
        t.position.set(THROWER_X[i], 0, THROWER_Z);
        ctx.scene.add(t);
        throwers.push(t);
      }

      // プレイヤー（手前・こちら向き）
      player = makePerson(THREE, 0x3d7bd9);
      player.position.set(0, 0, PLAYER_Z);
      ctx.scene.add(player);
      playerShadow = Style.softShadow(0.7);
      playerShadow.position.set(0, 0.015, PLAYER_Z);
      ctx.scene.add(playerShadow);

      // ボールプール（本体＋移動影＋着弾予告リング）
      var ballGeo = new THREE.SphereGeometry(BALL_R, 12, 10);
      var ballMat = Style.mat(0xd9534f);
      var shadowGeo = new THREE.CircleGeometry(0.36, 14);
      var targetGeo = new THREE.RingGeometry(0.42, 0.58, 20);
      for (var k = 0; k < 10; k++) {
        var mesh = new THREE.Mesh(ballGeo, ballMat);
        var shadow = new THREE.Mesh(shadowGeo,
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
        shadow.rotation.x = -Math.PI / 2;
        var target = new THREE.Mesh(targetGeo,
          new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.6 }));
        target.rotation.x = -Math.PI / 2;
        mesh.visible = shadow.visible = target.visible = false;
        ctx.scene.add(mesh, shadow, target);
        balls.push({ mesh: mesh, shadow: shadow, target: target,
          active: false, vx: 0, vy: 0, vz: 0, bounced: false });
      }

      // バウンド砂煙プール
      var puffGeo = new THREE.SphereGeometry(0.16, 6, 5);
      for (var pf = 0; pf < 12; pf++) {
        var pm = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xf0e6d2, transparent: true, opacity: 0 }));
        pm.visible = false;
        ctx.scene.add(pm);
        puffs.push({ mesh: pm, vx: 0, vy: 0, vz: 0, life: 0 });
      }
    },

    _puff: function (x, z) {
      var n = 0;
      for (var i = 0; i < puffs.length && n < 4; i++) {
        if (puffs[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        puffs[i].life = 0.35;
        puffs[i].vx = Math.cos(a) * 1.3;
        puffs[i].vy = 0.7 + Math.random() * 0.6;
        puffs[i].vz = Math.sin(a) * 1.3;
        puffs[i].mesh.position.set(x, 0.15, z);
        puffs[i].mesh.material.opacity = 0.75;
        puffs[i].mesh.visible = true;
        n++;
      }
    },

    start: function (ctx) {
      px = 0; myTime = 0; spawnT = 1.2; state = 0; hitT = 0; grace = 0;
      player.position.set(0, 0, PLAYER_Z);
      player.rotation.set(0, 0, 0);
      player.visible = true;
      throwAnim[0] = throwAnim[1] = throwAnim[2] = 0;
      for (var i = 0; i < balls.length; i++) {
        balls[i].active = false;
        balls[i].mesh.visible = balls[i].shadow.visible = balls[i].target.visible = false;
      }
      for (var t = 0; t < 3; t++) throwers[t].position.y = 0;
      ctx.setHint(ctx.t({ en: 'Drag sideways to dodge!', ja: 'よこにドラッグで よける！', es: '¡Arrastra hacia los lados para esquivar!', 'pt-BR': 'Arraste para os lados para desviar!', fr: 'Glissez sur le côté pour esquiver !', de: 'Seitwärts ziehen zum Ausweichen!', it: 'Trascina di lato per schivare!', ko: '옆으로 드래그해서 피해!', 'zh-Hans': '横向拖动来躲避！', tr: 'Kaçınmak için yana kaydır!' }));
    },

    onPointerMove: function (ctx, p) {
      if (state !== 0) return;
      // 画面幅に対する割合で移動（機種差を吸収）
      px += p.dx * (10 / ctx.width);
      px = Math.max(Math.min(px, LIMIT_X), -LIMIT_X);
    },

    onContinue: function (ctx) {
      // ボールを一掃して同スコア（生存秒はそのまま）から再開
      state = 0; hitT = 0; grace = 1.5; spawnT = 1.0;
      player.rotation.set(0, 0, 0);
      player.position.y = 0;
      for (var i = 0; i < balls.length; i++) {
        balls[i].active = false;
        balls[i].mesh.visible = balls[i].shadow.visible = balls[i].target.visible = false;
      }
      ctx.setHint(ctx.t({ en: 'Revived!', ja: 'ふっかつ！', es: '¡Revivido!', 'pt-BR': 'Revivido!', fr: 'Revenu !', de: 'Wiederbelebt!', it: 'Rinato!', ko: '부활!', 'zh-Hans': '复活！', tr: 'Dirildim!' }));
    },

    update: function (ctx, dt) {
      if (state === 1) {
        // 被弾して転ぶ演出
        hitT += dt;
        player.rotation.x = Math.min(player.rotation.x + dt * 4, Math.PI / 2);
        if (hitT > 1.0) ctx.gameOver(Math.floor(myTime));
        return;
      }

      myTime += dt;
      var sec = Math.floor(myTime);
      if (sec !== ctx.score) ctx.setScore(sec);

      player.position.x = px;
      playerShadow.position.x = px;

      // 砂煙の更新
      for (var pi = 0; pi < puffs.length; pi++) {
        var pu = puffs[pi];
        if (pu.life <= 0) continue;
        pu.life -= dt;
        pu.mesh.position.x += pu.vx * dt;
        pu.mesh.position.y += pu.vy * dt;
        pu.mesh.position.z += pu.vz * dt;
        pu.vy -= 3 * dt;
        pu.mesh.material.opacity = Math.max(0, pu.life / 0.35) * 0.75;
        if (pu.life <= 0) pu.mesh.visible = false;
      }

      // 投げ手のモーション（投げた直後にぴょこん）
      for (var t = 0; t < 3; t++) {
        if (throwAnim[t] > 0) {
          throwAnim[t] = Math.max(throwAnim[t] - dt, 0);
          throwers[t].position.y = Math.sin((1 - throwAnim[t] / 0.35) * Math.PI) * 0.3;
        }
      }

      // ボール生成（だんだん頻度アップ）
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnBall(ctx);
        spawnT = Math.max(1.7 - myTime * 0.018, 0.55);
      }

      // ボール更新
      for (var i = 0; i < balls.length; i++) {
        var b = balls[i];
        if (!b.active) continue;
        var m = b.mesh.position;
        m.x += b.vx * dt;
        m.y += b.vy * dt;
        m.z += b.vz * dt;
        b.vy -= G * dt;
        if (m.y <= BALL_R && b.vy < 0) {
          // バウンド（1段目の脅威 → 2段目へ）
          m.y = BALL_R;
          b.vy = -b.vy * 0.5;
          if (!b.bounced) {
            b.bounced = true;
            b.target.visible = false;
            if (m.z > -6) { ctx.sfx.bounce(); this._puff(m.x, m.z); }
          }
        }
        // 移動影と予告リング
        b.shadow.position.set(m.x, 0.02, m.z);
        var ss = Math.max(1.2 - m.y * 0.07, 0.5);
        b.shadow.scale.set(ss, ss, 1);
        if (b.target.visible) {
          b.target.material.opacity = 0.35 + 0.3 * Math.sin(myTime * 12);
        }
        // 通り過ぎたら回収
        if (m.z > 12) {
          b.active = false;
          b.mesh.visible = b.shadow.visible = b.target.visible = false;
          continue;
        }
        // 被弾判定
        if (grace <= 0 &&
            Math.abs(m.x - px) < 0.8 &&
            Math.abs(m.z - PLAYER_Z) < 0.9 &&
            m.y < 1.8) {
          state = 1; hitT = 0;
          b.active = false;
          b.mesh.visible = b.shadow.visible = b.target.visible = false;
          ctx.sfx.fail();
          ctx.vibrate(120);
          return;
        }
      }

      // 無敵時間の点滅
      if (grace > 0) {
        grace -= dt;
        player.visible = Math.floor(grace * 10) % 2 === 0;
        if (grace <= 0) player.visible = true;
      }
    }
  });
})();
