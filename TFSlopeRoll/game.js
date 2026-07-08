/* =========================================================================
 * TFSlopeRoll — さかみちコロコロ
 * ルール: 空に浮かぶ下り坂レーン（ゆるいS字）をボールが自動で転がり加速。
 *        穴とブロックをよけ、ジャンプ台で跳んでどこまで行けるか。
 * 操作: 左右ドラッグで横移動。レーンから外れる/穴/ブロックで終了。
 * スコア: 距離 (m) / コンティニュー可
 * ========================================================================= */
(function () {
  'use strict';

  var SLOPE = 0.32;             // 下り勾配 (y/距離)
  var SEG = 2;                  // リボンのサンプル間隔
  var TILE_N = 70;              // リボンのサンプル数
  var LANE_EDGE = 2.85;         // これを超えると横落ち
  var OBS_N = 12;               // 障害物プール数
  var GRAV = 22;

  var ball, laneMesh, guideMesh, markers = [], trails = [], obstacles = [], puffs = [];
  var dist, lateral, speed, jumpY, vy, grounded;
  var falling, fallT, dead, invT;
  var nextSpawnD;
  var camX, camY, lookV;

  // レーン中心のS字カーブ
  function laneX(d) { return Math.sin(d * 0.045) * 4; }
  function laneY(d) { return -d * SLOPE; }

  function makeRibbonGeometry(THREE) {
    var verts = [];
    var uvs = [];
    var idx = [];
    for (var i = 0; i <= TILE_N; i++) {
      verts.push(0, 0, 0, 0, 0, 0);
      uvs.push(0, i / 4, 1, i / 4);
    }
    for (i = 0; i < TILE_N; i++) {
      var a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  }

  function guideTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 256;
    var c = cv.getContext('2d');
    c.clearRect(0, 0, 64, 256);
    c.fillStyle = 'rgba(255,255,255,.75)';
    for (var y = 0; y < 256; y += 46) {
      c.fillRect(27, y + 6, 10, 24);
      c.beginPath();
      c.moveTo(32, y + 36); c.lineTo(21, y + 24); c.lineTo(43, y + 24);
      c.closePath(); c.fill();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    return tex;
  }

  function updateRibbon(mesh, width, yLift) {
    var pos = mesh.geometry.attributes.position;
    var startD = Math.max(0, dist - 10);
    for (var i = 0; i <= TILE_N; i++) {
      var d = startD + i * SEG;
      var cx = laneX(d), cy = laneY(d) + yLift, cz = -d;
      var tx = laneX(d + 1) - laneX(d - 1);
      var tz = -2;
      var len = Math.sqrt(tx * tx + tz * tz) || 1;
      var px = -tz / len, pz = tx / len;
      pos.setXYZ(i * 2, cx - px * width * 0.5, cy, cz - pz * width * 0.5);
      pos.setXYZ(i * 2 + 1, cx + px * width * 0.5, cy, cz + pz * width * 0.5);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }

  // 障害物を新しい距離へ再配置
  function respawnObstacle(o, ctx) {
    var r = ctx.random();
    o.type = r < 0.38 ? 0 : (r < 0.68 ? 1 : 2); // 0=ブロック 1=穴 2=ジャンプ台
    o.d = nextSpawnD;
    o.lat = (ctx.random() - 0.5) * 4.4;
    // 距離が伸びるほど間隔が詰まる（難度曲線）
    nextSpawnD += Math.max(7, 15 - dist * 0.015) + ctx.random() * 8;
    o.active = true;
    o.block.visible = o.type === 0;
    o.hole.visible = o.type === 1;
    o.jump.visible = o.type === 2;
    var x = laneX(o.d) + o.lat, y = laneY(o.d), z = -o.d;
    o.block.position.set(x, y + 0.6, z);
    o.hole.position.set(x, y + 0.04, z);
    o.hole.rotation.x = -Math.PI / 2 + Math.atan(SLOPE);
    o.jump.position.set(x, y + 0.15, z);
    o.jump.rotation.x = Math.atan(SLOPE) - 0.3;
  }

  Shell.registerGame({
    id: 'TFSlopeRoll',
    title: { en: 'Slope Roll', ja: 'さかみちコロコロ', es: 'Cuesta Rodante', 'pt-BR': 'Rolando na Ladeira', fr: 'Pente Roulante', de: 'Rollhang', it: 'Rotolo in Discesa', ko: '경사 굴리기', 'zh-Hans': '滑坡滚球', tr: 'Yokuş Topu' },
    howto: { en: 'Drag left/right to move\nAvoid holes and blocks!', ja: 'ひだりみぎドラッグでうごかそう\nあなとブロックにきをつけて！', es: 'Arrastra izquierda/derecha\n¡Evita hoyos y bloques!', 'pt-BR': 'Arraste para a esquerda/direita\nEvite buracos e blocos!', fr: 'Glissez gauche/droite\nÉvitez trous et blocs !', de: 'Ziehe links/rechts\nWeiche Löchern und Blöcken aus!', it: 'Trascina sinistra/destra\nEvita buche e blocchi!', ko: '좌우로 드래그하세요\n구멍과 블록을 피하세요!', 'zh-Hans': '左右拖动来移动\n避开洞和障碍！', tr: 'Sol/sağa kaydır\nDelik ve engellerden kaçın!' },
    scoreLabel: 'm',
    bg: 0x9fd8ff,
    fogNear: 40, fogFar: 130,
    cameraFov: 62,
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;
      lookV = new THREE.Vector3();

      // ボール（Canvasの2色テクスチャで転がりが見える）
      var cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      var c2 = cv.getContext('2d');
      c2.fillStyle = '#ff6b6b'; c2.fillRect(0, 0, 64, 64);
      c2.fillStyle = '#ffffff';
      c2.fillRect(0, 0, 32, 32); c2.fillRect(32, 32, 32, 32);
      ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 18, 14),
        new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) })
      );
      ctx.scene.add(ball);

      // 連続リボンのレーンと中央ガイド
      laneMesh = new THREE.Mesh(
        makeRibbonGeometry(THREE),
        // 注: リボンは動的 BufferGeometry で normal を持たないため、
        // ライティング不要の Basic を使う(Lambert だと真っ黒になる)
        new THREE.MeshBasicMaterial({ color: 0x53b6e8, side: THREE.DoubleSide })
      );
      guideMesh = new THREE.Mesh(
        makeRibbonGeometry(THREE),
        new THREE.MeshBasicMaterial({ map: guideTexture(THREE), transparent: true, opacity: 0.75, side: THREE.DoubleSide })
      );
      ctx.scene.add(laneMesh, guideMesh);

      var markerGeo = Style.roundedBox(0.18, 0.45, 1.2);
      var markerMat = Style.mat(0xffffff);
      for (var mi = 0; mi < 14; mi++) {
        var mk = new THREE.Mesh(markerGeo, markerMat);
        ctx.scene.add(mk);
        markers.push(mk);
      }

      // 障害物プール（ブロック/穴/ジャンプ台の3メッシュを持ち、種類で切替）
      var blockGeo = Style.roundedBox(1.6, 1.2, 1.2);
      var blockMat = Style.mat(0x9c2f2f);
      var holeGeo = new THREE.CircleGeometry(1.1, 20);
      var holeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a2a });
      var jumpGeo = Style.roundedBox(2.4, 0.3, 1.6);
      var jumpMat = Style.mat(0x39c96e);
      for (var j = 0; j < OBS_N; j++) {
        var o = {
          type: 0, d: 0, lat: 0, active: false,
          block: new THREE.Mesh(blockGeo, blockMat),
          hole: new THREE.Mesh(holeGeo, holeMat),
          jump: new THREE.Mesh(jumpGeo, jumpMat)
        };
        o.block.visible = o.hole.visible = o.jump.visible = false;
        ctx.scene.add(o.block, o.hole, o.jump);
        obstacles.push(o);
      }

      // 背景のふわふわ雲（球を寄せた塊）
      var cloudMat = Style.mat(0xffffff);
      for (var k = 0; k < 12; k++) {
        var cg = new THREE.Group();
        for (var cp = 0; cp < 3; cp++) {
          var cs = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random(), 8, 6), cloudMat);
          cs.position.set(cp * 2 - 2, Math.random() * 0.5, 0);
          cg.add(cs);
        }
        cg.position.set((Math.random() - 0.5) * 64, -k * 9 - 3, -k * 13 - 18);
        ctx.scene.add(cg);
      }
      // 浮遊する草の島（スカイワールド感。レーンの脇に散らす）
      for (var fi = 0; fi < 6; fi++) {
        var isl = new THREE.Group();
        var top = new THREE.Mesh(new THREE.CylinderGeometry(1.6 + Math.random(), 1.2, 0.5, 10), Style.mat(0x6fbf4a));
        var bot = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.8, 8), Style.mat(0x9a7050));
        bot.position.y = -1.1;
        isl.add(top, bot);
        var iside = fi % 2 === 0 ? -1 : 1;
        isl.position.set(iside * (9 + Math.random() * 6), -fi * 14 - 8, -fi * 20 - 30);
        ctx.scene.add(isl);
      }

      var trailGeo = new THREE.PlaneGeometry(0.55, 1.4);
      var trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
      for (var tr = 0; tr < 3; tr++) {
        var tm = new THREE.Mesh(trailGeo, trailMat.clone());
        tm.rotation.x = -Math.PI / 2;
        ctx.scene.add(tm);
        trails.push(tm);
      }

      // ジャンプ/着地のきらめきプール
      var puffGeo = new THREE.SphereGeometry(0.13, 5, 4);
      for (var pf = 0; pf < 12; pf++) {
        var pm = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0 }));
        pm.visible = false;
        ctx.scene.add(pm);
        puffs.push({ mesh: pm, vx: 0, vy: 0, vz: 0, life: 0 });
      }
    },

    _puff: function (x, y, z, col) {
      var n = 0;
      for (var i = 0; i < puffs.length && n < 6; i++) {
        if (puffs[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        puffs[i].life = 0.4;
        puffs[i].vx = Math.cos(a) * (2 + Math.random());
        puffs[i].vy = 1 + Math.random() * 1.5;
        puffs[i].vz = Math.sin(a) * (2 + Math.random());
        puffs[i].mesh.material.color.setHex(col);
        puffs[i].mesh.position.set(x, y, z);
        puffs[i].mesh.material.opacity = 1;
        puffs[i].mesh.visible = true;
        n++;
      }
    },

    start: function (ctx) {
      dist = 0; lateral = 0; speed = 6;
      jumpY = 0; vy = 0; grounded = true;
      falling = false; fallT = 0; dead = false; invT = 0;
      nextSpawnD = 24;
      camX = 0; camY = 4.5;
      updateRibbon(laneMesh, 6.4, -0.05);
      updateRibbon(guideMesh, 0.6, 0.03);
      for (var i = 0; i < markers.length; i++) {
        markers[i].userData.d = (i + 1) * 10;
      }
      // 障害物配置し直し
      for (var j = 0; j < OBS_N; j++) respawnObstacle(obstacles[j], ctx);
      ball.position.set(0, 0.5, 0);
      ball.rotation.set(0, 0, 0);
      ball.visible = true;
      ctx.setHint(ctx.t({ en: 'Drag left/right!', ja: 'ひだりみぎドラッグ！', es: '¡Arrastra izquierda/derecha!', 'pt-BR': 'Arraste para o lado!', fr: 'Glissez gauche/droite !', de: 'Links/rechts ziehen!', it: 'Trascina destra/sinistra!', ko: '좌우로 드래그!', 'zh-Hans': '左右拖动！', tr: 'Sol/sağa kaydır!' }));
    },

    // リワードコンティニュー: その場（同じ距離）から再開
    onContinue: function (ctx) {
      falling = false; dead = false;
      fallT = 0; jumpY = 0; vy = 0; grounded = true;
      lateral = 0;                       // レーン中央へ戻す
      speed = Math.max(6, speed * 0.55); // 少し減速して再開
      invT = 2;                          // 2秒無敵
      // 目の前の障害物はどかす
      for (var i = 0; i < OBS_N; i++) {
        var o = obstacles[i];
        if (o.d > dist - 2 && o.d < dist + 30) {
          nextSpawnD = Math.max(nextSpawnD, o.d + 40);
          o.d = nextSpawnD;
          respawnObstacle(o, ctx);
        }
      }
      ball.visible = true;
      ctx.setHint(ctx.t({ en: 'Back in action!', ja: 'ふっかつ！', es: '¡De vuelta!', 'pt-BR': 'De volta!', fr: 'Retour en jeu !', de: 'Zurück im Spiel!', it: 'Di nuovo in gara!', ko: '부활!', 'zh-Hans': '复活！', tr: 'Geri döndün!' }));
    },

    onPointerMove: function (ctx, p) {
      if (dead || falling) return;
      lateral += p.dx * 0.016;
      if (lateral > 3.6) lateral = 3.6;
      if (lateral < -3.6) lateral = -3.6;
    },

    update: function (ctx, dt) {
      if (dead) return;

      if (falling) {
        // 落下演出 → 終了
        fallT += dt;
        vy -= GRAV * dt;
        ball.position.y += vy * dt;
        ball.rotation.x -= speed * dt;
        if (fallT > 0.6) {
          dead = true;
          ctx.gameOver(Math.floor(dist));
        }
        return;
      }

      if (invT > 0) invT -= dt;

      // 加速しながら前進
      speed = Math.min(22, speed + 0.55 * dt);
      dist += speed * dt;
      ctx.setScore(Math.floor(dist));

      // ジャンプ（レーン面からの高さ）
      if (!grounded) {
        vy -= GRAV * dt;
        jumpY += vy * dt;
        if (jumpY <= 0) { jumpY = 0; vy = 0; grounded = true; ctx.sfx.bounce(); this._puff(laneX(dist) + lateral, laneY(dist) + 0.3, -dist, 0xfff0d0); }
      }

      // きらめきの更新
      for (var pu = 0; pu < puffs.length; pu++) {
        var pp = puffs[pu];
        if (pp.life <= 0) continue;
        pp.life -= dt;
        pp.mesh.position.x += pp.vx * dt;
        pp.mesh.position.y += pp.vy * dt;
        pp.mesh.position.z += pp.vz * dt;
        pp.vy -= 6 * dt;
        pp.mesh.material.opacity = Math.max(0, pp.life / 0.4);
        if (pp.life <= 0) pp.mesh.visible = false;
      }

      // ボール位置＆転がり回転
      ball.position.set(laneX(dist) + lateral, laneY(dist) + 0.5 + jumpY, -dist);
      ball.rotation.x -= (speed / 0.5) * dt;
      for (var tr = 0; tr < trails.length; tr++) {
        var td = dist - (tr + 1) * 0.9;
        trails[tr].position.set(laneX(td) + lateral, laneY(td) + 0.18 + jumpY * 0.6, -td + 0.2);
        trails[tr].rotation.z = Math.sin(ctx.elapsed * 4 + tr) * 0.08;
        trails[tr].material.opacity = 0.2 - tr * 0.05;
      }

      // 横落ち
      if (grounded && Math.abs(lateral) > LANE_EDGE && invT <= 0) {
        falling = true; vy = -2;
        ctx.sfx.fail(); ctx.vibrate(60);
        return;
      }

      updateRibbon(laneMesh, 6.4, -0.05);
      updateRibbon(guideMesh, 0.6, 0.03);
      for (var i = 0; i < markers.length; i++) {
        var mk = markers[i];
        if (mk.userData.d < dist - 5) mk.userData.d += markers.length * 10;
        var md = mk.userData.d;
        mk.position.set(laneX(md) + 3.2, laneY(md) + 0.3, -md);
        mk.rotation.x = Math.atan(SLOPE);
      }

      // 障害物判定＆使い回し
      for (var j = 0; j < OBS_N; j++) {
        var o = obstacles[j];
        if (o.d < dist - 6) { respawnObstacle(o, ctx); continue; }
        if (invT > 0) continue;
        if (Math.abs(dist - o.d) > 0.9) continue;
        var dl = Math.abs(lateral - o.lat);
        if (o.type === 0) {          // ブロック: 低い位置で接触したら終了
          if (dl < 1.3 && jumpY < 1.1) {
            dead = true;
            ctx.sfx.fail(); ctx.vibrate(80);
            ctx.gameOver(Math.floor(dist));
            return;
          }
        } else if (o.type === 1) {   // 穴: 接地したまま入ると落下
          if (dl < 0.95 && jumpY <= 0.05) {
            falling = true; vy = -1;
            ctx.sfx.fail(); ctx.vibrate(60);
            return;
          }
        } else {                     // ジャンプ台: 跳ぶ
          if (dl < 1.6 && jumpY <= 0.05 && grounded) {
            grounded = false; vy = 8.5;
            this._puff(laneX(o.d) + o.lat, laneY(o.d) + 0.3, -o.d, 0x8affb0);
            ctx.sfx.score(); ctx.vibrate(20);
          }
        }
      }

      // カメラ追従（毎フレーム new しない）
      var tx = laneX(dist) + lateral * 0.6;
      camX += (tx - camX) * Math.min(1, dt * 5);
      camY += ((laneY(dist) + 4.6) - camY) * Math.min(1, dt * 5);
      ctx.camera.position.set(camX, camY, -dist + 8.5);
      lookV.set(laneX(dist + 8) + lateral * 0.3, laneY(dist + 6), -dist - 6);
      ctx.camera.lookAt(lookV);
    }
  });
})();
