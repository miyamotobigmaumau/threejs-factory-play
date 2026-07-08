/* =========================================================================
 * TFMarbleShot — ビーだまはじき
 * ルール: 白線サークルの中に敵ビー玉8個。自玉を引っぱって離すと
 *        引いた方向の逆へ発射（パチンコ式）。摩擦で減速する2D物理。
 *        円の外に弾き出した敵玉が得点。自玉が場外に出ると1球損失。
 *        持ち球5球。ぜんぶ弾き出すか、球切れで終了。
 * 操作: 引っぱって離す
 * スコア: 弾き出した数 (こ)
 * ========================================================================= */
(function () {
  'use strict';

  var R = 4.2;        // サークル半径
  var K = 3.5;        // 引っぱり→速度 係数
  var VMAX = 15;      // 最大発射速度
  var FRIC = 1.4;     // 摩擦（指数減衰）
  var TIME_CAP = 75;  // 保険の時間上限

  var bodies = [];    // [0]=自玉, [1..8]=敵玉
  var player;
  var arrow, shaft, head;   // 照準矢印
  var balls, outCount, aiming, ending, endT, endKind, respawnT;
  var lastBounceT = 0;
  // ビジュアルディテール
  var fxRings = [], sparks = [], floats = [];

  // 「+1」「✗」用スプライト（Canvas テキストは数字/記号のみ = 言語非依存）
  function makeFloatSprite(THREE, text, color) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var c = cv.getContext('2d');
    c.font = 'bold 84px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 10; c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.strokeText(text, 64, 64);
    c.fillStyle = color;
    c.fillText(text, 64, 64);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false
    }));
    sp.scale.set(1.4, 1.4, 1);
    sp.visible = false;
    sp.userData.t = -1;
    return sp;
  }

  // 一時ベクトル（毎フレーム new しない）
  var _v = null, _n = null, _startHit = null, _curHit = null;

  // 敵玉の基本配置（中央1 + リング6 + 奥1）
  var BASE_POS = [];
  (function () {
    BASE_POS.push([0, 0]);
    for (var k = 0; k < 6; k++) {
      var a = k * Math.PI / 3;
      BASE_POS.push([Math.cos(a) * 1.5, Math.sin(a) * 1.5]);
    }
    BASE_POS.push([0, -2.4]);
  })();

  // 画面座標(nx,ny)→地面(y=0)のワールド座標
  function groundHit(ctx, nx, ny, out) {
    _v.set(nx, ny, 0.5).unproject(ctx.camera);
    _v.sub(ctx.camera.position).normalize();
    var t = -ctx.camera.position.y / _v.y;
    out.set(
      ctx.camera.position.x + _v.x * t,
      0,
      ctx.camera.position.z + _v.z * t
    );
  }

  function updateHint(ctx) {
    ctx.setHint(ctx.t({
      en: 'Left: ' + (8 - outCount) + ' ／ Balls: ' + balls,
      ja: 'のこり ' + (8 - outCount) + 'こ ／ たま ' + balls,
      es: 'Restan: ' + (8 - outCount) + ' ／ Bolas: ' + balls,
      'pt-BR': 'Restam: ' + (8 - outCount) + ' ／ Bolas: ' + balls,
      fr: 'Reste: ' + (8 - outCount) + ' ／ Billes: ' + balls,
      de: 'Übrig: ' + (8 - outCount) + ' ／ Bälle: ' + balls,
      it: 'Rimaste: ' + (8 - outCount) + ' ／ Sfere: ' + balls,
      ko: '남은 구슬: ' + (8 - outCount) + ' ／ 볼: ' + balls,
      'zh-Hans': '剩余: ' + (8 - outCount) + ' ／ 球数: ' + balls,
      tr: 'Kalan: ' + (8 - outCount) + ' ／ Top: ' + balls
    }));
  }

  function anyMoving() {
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (!b.alive) continue;
      if (b.sinking) return true;
      if (b.vel.x * b.vel.x + b.vel.z * b.vel.z > 0.003) return true;
    }
    return false;
  }

  // リング拡散エフェクト（成功=金 / 失敗=赤、プール）
  function burstRing(pos, color) {
    for (var i = 0; i < fxRings.length; i++) {
      var r = fxRings[i];
      if (r.userData.t >= 0) continue;
      r.material.color.setHex(color);
      r.position.set(pos.x, 0.06, pos.z);
      r.userData.t = 0;
      r.visible = true;
      return;
    }
  }

  // 衝突スパーク（プールから4粒）
  function burstSpark(x, z, n) {
    var used = 0;
    for (var i = 0; i < sparks.length && used < n; i++) {
      var s = sparks[i];
      if (s.userData.t >= 0) continue;
      var a = Math.random() * Math.PI * 2;
      var sp = 1.5 + Math.random() * 2;
      s.userData.t = 0;
      s.userData.vx = Math.cos(a) * sp;
      s.userData.vz = Math.sin(a) * sp;
      s.userData.vy = 1.5 + Math.random() * 1.5;
      s.position.set(x, 0.4, z);
      s.visible = true;
      used++;
    }
  }

  var plusIdx = 0;
  function popFloat(pos, isPlus) {
    var f;
    if (isPlus) { // +1 は3枚を順繰り（連続弾き出しに対応）
      f = floats[plusIdx % 3];
      plusIdx++;
    } else {
      f = floats[3]; // ✗
    }
    f.position.set(pos.x, 1.2, pos.z);
    f.userData.t = 0;
    f.visible = true;
    f.material.opacity = 1;
  }

  // 場外へ → 沈む演出開始
  function knockOut(ctx, b) {
    b.sinking = true;
    if (b.isPlayer) {
      balls--;
      burstRing(b.mesh.position, 0xd63b3b);
      popFloat(b.mesh.position, false); // ✗
      ctx.sfx.fail();
      ctx.vibrate(50);
    } else {
      outCount++;
      ctx.setScore(outCount);
      burstRing(b.mesh.position, 0xe8b423);
      popFloat(b.mesh.position, true); // +1
      ctx.sfx.score();
      ctx.vibrate(20);
    }
    updateHint(ctx);
  }

  Shell.registerGame({
    id: 'TFMarbleShot',
    title: {
      en: 'Marble Shot',
      ja: 'ビーだまはじき',
      es: 'Tiro de Canica',
      'pt-BR': 'Tiro de Bolinha',
      fr: 'Tir de Bille',
      de: 'Murmelschuss',
      it: 'Tiro di Biglia',
      ko: '구슬치기',
      'zh-Hans': '弹珠射击',
      tr: 'Bilye Atışı'
    },
    howto: {
      en: 'Drag & release to shoot your marble!\nKnock all marbles out of the white circle',
      ja: 'ひっぱって はなすと ビーだまはっしゃ！\nしろいせんのそとへ はじきだそう',
      es: '¡Arrastra y suelta para disparar!\nSaca todas las canicas del círculo',
      'pt-BR': 'Arraste e solte para atirar!\nTire todas as bolinhas do círculo branco',
      fr: 'Glissez et relâchez pour tirer !\nExpulsez toutes les billes hors du cercle',
      de: 'Ziehe und loslassen zum Schießen!\nWirble alle Murmeln aus dem Kreis',
      it: 'Trascina e rilascia per sparare!\nCaccia tutte le biglie fuori dal cerchio',
      ko: '드래그 후 놓기로 구슬을 발사!\n흰 원 밖으로 모두 튕겨내자',
      'zh-Hans': '拖动并松开来发射弹珠！\n将所有弹珠弹出白圈',
      tr: 'Sürükle ve bırak ile ateşle!\nTüm bilyeleri beyaz çemberden çıkar'
    },
    scoreLabel: {
      en: 'pcs',
      ja: 'こ',
      es: 'pzs',
      'pt-BR': 'pçs',
      fr: 'pcs',
      de: 'Stk',
      it: 'pz',
      ko: '개',
      'zh-Hans': '个',
      tr: 'adet'
    },
    bg: 0xbfe3f7,
    cameraFov: 60,
    cameraPos: [0, 16, 8],
    cameraLookAt: [0, 0, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;
      _v = new THREE.Vector3();
      _n = new THREE.Vector3();
      _startHit = new THREE.Vector3();
      _curHit = new THREE.Vector3();

      // 土の地面と土俵サークル
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(70, 70),
        new THREE.MeshLambertMaterial({ color: 0xa78a5c })
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);
      var inner = new THREE.Mesh(
        new THREE.CircleGeometry(R, 44),
        new THREE.MeshLambertMaterial({ color: 0xb59d6e })
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.005;
      ctx.scene.add(inner);
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(R - 0.08, R + 0.08, 56),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      ctx.scene.add(ring);

      // 地面ディテール: 砂の色むら＋サークル内の同心ガイド線（チョーク風）
      var i2, k2;
      var sandMat = new THREE.MeshLambertMaterial({ color: 0xa08252 });
      for (i2 = 0; i2 < 8; i2++) {
        var sp2 = new THREE.Mesh(new THREE.CircleGeometry(0.8 + Math.random() * 1.6, 9), sandMat);
        sp2.rotation.x = -Math.PI / 2;
        var sa = Math.random() * Math.PI * 2, sr = R + 1.5 + Math.random() * 6;
        sp2.position.set(Math.cos(sa) * sr, 0.004, Math.sin(sa) * sr);
        ctx.scene.add(sp2);
      }
      var guide = new THREE.Mesh(
        new THREE.RingGeometry(1.95, 2.0, 40),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })
      );
      guide.rotation.x = -Math.PI / 2;
      guide.position.y = 0.01;
      ctx.scene.add(guide);

      // ミッドプロップ: 草むら・小石・木（サークルの周囲に、駄菓子屋の原っぱ感）
      for (i2 = 0; i2 < 10; i2++) {
        var pa = (i2 / 10) * Math.PI * 2 + Math.random() * 0.5;
        var pr = R + 2.2 + Math.random() * 4.5;
        var px2 = Math.cos(pa) * pr, pz2 = Math.sin(pa) * pr;
        if (pz2 > R + 1.5) continue; // カメラ手前は空ける
        if (i2 % 3 === 0) {
          var rock2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + Math.random() * 0.25, 0),
            Style.mat(0x8f959c, { flat: true }));
          rock2.position.set(px2, 0.18, pz2);
          rock2.rotation.set(Math.random(), Math.random(), 0);
          ctx.scene.add(rock2);
        } else {
          var tuft = new THREE.Group();
          for (k2 = 0; k2 < 3; k2++) {
            var blade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55 + Math.random() * 0.3, 5),
              Style.mat(0x5f9e46));
            blade.position.set((Math.random() - 0.5) * 0.4, 0.28, (Math.random() - 0.5) * 0.4);
            blade.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
            tuft.add(blade);
          }
          tuft.position.set(px2, 0, pz2);
          ctx.scene.add(tuft);
        }
      }
      // 奥に木2本（画面上部の余白を埋める）
      for (i2 = 0; i2 < 2; i2++) {
        var tree = new THREE.Group();
        var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6), Style.mat(0x8a6242));
        trunk.position.y = 0.8;
        tree.add(trunk);
        var crown = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6), Style.mat(0x55a344, { flat: true }));
        crown.position.y = 2.3;
        tree.add(crown);
        tree.position.set(i2 === 0 ? -6.5 : 7, 0, -7 - i2 * 2);
        ctx.scene.add(tree);
      }

      // エフェクトプール: リング拡散2・スパーク8・フローティング(+1×3, ✗×1)
      for (i2 = 0; i2 < 2; i2++) {
        var fr = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 32),
          new THREE.MeshBasicMaterial({ color: 0xe8b423, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
        fr.rotation.x = -Math.PI / 2;
        fr.visible = false;
        fr.userData.t = -1;
        ctx.scene.add(fr);
        fxRings.push(fr);
      }
      for (i2 = 0; i2 < 8; i2++) {
        var sk = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4),
          new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 1, depthWrite: false }));
        sk.visible = false;
        sk.userData.t = -1;
        ctx.scene.add(sk);
        sparks.push(sk);
      }
      for (i2 = 0; i2 < 3; i2++) floats.push(makeFloatSprite(THREE, '+1', '#2e7d32'));
      floats.push(makeFloatSprite(THREE, '✗', '#c62828'));
      for (i2 = 0; i2 < floats.length; i2++) ctx.scene.add(floats[i2]);

      // ビー玉（ガラス風 Phong）と丸影
      var sphereGeo = new THREE.SphereGeometry(1, 18, 14);
      var shadowGeo = new THREE.CircleGeometry(1, 16);
      var shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });
      var colors = [0x4fc3f7, 0xef5350, 0xffb300, 0x66bb6a, 0xab47bc, 0x26c6da, 0xec407a, 0x9ccc65, 0x5c6bc0];

      for (var i = 0; i < 9; i++) {
        var isPlayer = (i === 0);
        var r = isPlayer ? 0.45 : 0.4;
        var mat = new THREE.MeshPhongMaterial({
          color: colors[i], shininess: 120, specular: 0xffffff,
          transparent: true, opacity: 0.92
        });
        var mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.scale.set(r, r, r);
        ctx.scene.add(mesh);
        var sh = new THREE.Mesh(shadowGeo, shadowMat);
        sh.rotation.x = -Math.PI / 2;
        sh.scale.set(r * 0.9, r * 0.9, 1);
        ctx.scene.add(sh);
        bodies.push({
          mesh: mesh, shadow: sh, vel: new THREE.Vector3(),
          r: r, alive: true, sinking: false, isPlayer: isPlayer
        });
      }
      player = bodies[0];
      // 自玉の識別: ビー玉らしい白い渦帯2本（転がりに合わせて回る）
      var bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
      var band1 = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.1, 6, 26), bandMat);
      var band2 = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.1, 6, 26), bandMat);
      band2.rotation.x = Math.PI / 2.4;
      band2.rotation.y = 0.7;
      player.mesh.add(band1, band2);

      // 照準矢印（棒＋三角）
      arrow = new THREE.Group();
      var aMat = new THREE.MeshBasicMaterial({ color: 0xff7043 });
      shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.14), aMat);
      head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 10), aMat);
      head.rotation.z = -Math.PI / 2;
      arrow.add(shaft, head);
      arrow.position.y = 0.1;
      arrow.visible = false;
      ctx.scene.add(arrow);
    },

    start: function (ctx) {
      balls = 5;
      outCount = 0;
      aiming = false;
      ending = false; endT = 0; endKind = '';
      respawnT = 0;
      lastBounceT = -1;
      arrow.visible = false;
      plusIdx = 0;
      var fi;
      for (fi = 0; fi < fxRings.length; fi++) { fxRings[fi].visible = false; fxRings[fi].userData.t = -1; }
      for (fi = 0; fi < sparks.length; fi++) { sparks[fi].visible = false; sparks[fi].userData.t = -1; }
      for (fi = 0; fi < floats.length; fi++) { floats[fi].visible = false; floats[fi].userData.t = -1; }

      // 自玉
      player.alive = true; player.sinking = false;
      player.vel.set(0, 0, 0);
      player.mesh.visible = true;
      player.shadow.visible = true;
      player.mesh.scale.set(player.r, player.r, player.r);
      player.mesh.position.set(0, player.r, 3.2);

      // 敵玉（毎回すこし配置ゆらぎ）
      for (var i = 1; i < bodies.length; i++) {
        var b = bodies[i];
        b.alive = true; b.sinking = false;
        b.vel.set(0, 0, 0);
        b.mesh.visible = true;
        b.shadow.visible = true;
        b.mesh.scale.set(b.r, b.r, b.r);
        var bp = BASE_POS[i - 1];
        b.mesh.position.set(
          bp[0] + (ctx.random() - 0.5) * 0.3,
          b.r,
          bp[1] + (ctx.random() - 0.5) * 0.3
        );
      }
      updateHint(ctx);
    },

    onPointerDown: function (ctx, p) {
      if (ending || player.sinking || !player.alive || anyMoving()) return;
      groundHit(ctx, p.nx, p.ny, _startHit);
      _curHit.copy(_startHit);
      aiming = true;
    },

    onPointerMove: function (ctx, p) {
      if (!aiming) return;
      groundHit(ctx, p.nx, p.ny, _curHit);
      // 発射方向 = 引きの逆
      var dx = _startHit.x - _curHit.x;
      var dz = _startHit.z - _curHit.z;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.15) { arrow.visible = false; return; }
      var alen = Math.min(len * K / VMAX * 2.4, 2.4) + 0.4;
      arrow.visible = true;
      arrow.position.x = player.mesh.position.x;
      arrow.position.z = player.mesh.position.z;
      arrow.rotation.y = Math.atan2(-dz, dx);
      shaft.scale.x = alen;
      shaft.position.x = alen / 2;
      head.position.x = alen + 0.2;
    },

    onPointerUp: function (ctx, p) {
      if (!aiming) return;
      aiming = false;
      arrow.visible = false;
      groundHit(ctx, p.nx, p.ny, _curHit);
      var dx = _startHit.x - _curHit.x;
      var dz = _startHit.z - _curHit.z;
      var v = Math.sqrt(dx * dx + dz * dz) * K;
      if (v < 1.2) return; // 弱すぎは不発
      if (v > VMAX) v = VMAX;
      var inv = 1 / Math.sqrt(dx * dx + dz * dz);
      player.vel.set(dx * inv * v, 0, dz * inv * v);
      ctx.sfx.tap();
      ctx.vibrate(15);
    },

    update: function (ctx, dt) {
      var i, j, b;

      // エフェクト更新（リング拡散・スパーク・フローティング）
      for (i = 0; i < fxRings.length; i++) {
        var fr = fxRings[i];
        if (fr.userData.t < 0) continue;
        fr.userData.t += dt;
        var fk = 1 + fr.userData.t * 5;
        fr.scale.set(fk, fk, 1);
        fr.material.opacity = Math.max(0, 0.9 - fr.userData.t * 2.2);
        if (fr.userData.t > 0.42) { fr.userData.t = -1; fr.visible = false; }
      }
      for (i = 0; i < sparks.length; i++) {
        var sk = sparks[i];
        if (sk.userData.t < 0) continue;
        sk.userData.t += dt;
        sk.position.x += sk.userData.vx * dt;
        sk.position.z += sk.userData.vz * dt;
        sk.position.y += sk.userData.vy * dt;
        sk.userData.vy -= 9 * dt;
        sk.material.opacity = Math.max(0, 1 - sk.userData.t * 3);
        if (sk.userData.t > 0.35) { sk.userData.t = -1; sk.visible = false; }
      }
      for (i = 0; i < floats.length; i++) {
        var fl = floats[i];
        if (fl.userData.t < 0) continue;
        fl.userData.t += dt;
        fl.position.y += dt * 1.6;
        fl.material.opacity = Math.max(0, 1 - fl.userData.t * 1.3);
        if (fl.userData.t > 0.8) { fl.userData.t = -1; fl.visible = false; }
      }

      // 移動と摩擦
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (!b.alive) continue;

        if (b.sinking) {
          // 場外に沈む演出
          b.mesh.position.x += b.vel.x * dt * 0.4;
          b.mesh.position.z += b.vel.z * dt * 0.4;
          b.mesh.position.y -= 2.5 * dt;
          b.shadow.visible = false;
          if (b.mesh.position.y < -1.2) {
            b.alive = false;
            b.sinking = false; // 沈み完了（終了判定のため必ず戻す）
            b.mesh.visible = false;
            if (b.isPlayer && balls > 0 && !ending) respawnT = 0.5;
          }
          continue;
        }

        b.mesh.position.x += b.vel.x * dt;
        b.mesh.position.z += b.vel.z * dt;
        var damp = Math.max(0, 1 - FRIC * dt);
        b.vel.x *= damp; b.vel.z *= damp;
        if (b.vel.x * b.vel.x + b.vel.z * b.vel.z < 0.023) b.vel.set(0, 0, 0);
        // 転がり回転（見た目）
        b.mesh.rotation.z -= b.vel.x * dt / b.r;
        b.mesh.rotation.x += b.vel.z * dt / b.r;
        b.shadow.position.x = b.mesh.position.x;
        b.shadow.position.z = b.mesh.position.z;
      }

      // 衝突（等質量・弾性）
      for (i = 0; i < bodies.length; i++) {
        var a = bodies[i];
        if (!a.alive || a.sinking) continue;
        for (j = i + 1; j < bodies.length; j++) {
          b = bodies[j];
          if (!b.alive || b.sinking) continue;
          var dx = b.mesh.position.x - a.mesh.position.x;
          var dz = b.mesh.position.z - a.mesh.position.z;
          var rr = a.r + b.r;
          var d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 === 0) continue;
          var d = Math.sqrt(d2);
          var nx = dx / d, nz = dz / d;
          // めり込み解消
          var push = (rr - d) / 2;
          a.mesh.position.x -= nx * push; a.mesh.position.z -= nz * push;
          b.mesh.position.x += nx * push; b.mesh.position.z += nz * push;
          // 法線方向の速度交換（反発 0.95）
          var van = a.vel.x * nx + a.vel.z * nz;
          var vbn = b.vel.x * nx + b.vel.z * nz;
          var rel = van - vbn;
          if (rel > 0) {
            var imp = rel * 0.975; // (1+e)/2, e=0.95
            a.vel.x -= nx * imp; a.vel.z -= nz * imp;
            b.vel.x += nx * imp; b.vel.z += nz * imp;
            if (rel > 2 && ctx.elapsed - lastBounceT > 0.12) {
              lastBounceT = ctx.elapsed;
              ctx.sfx.bounce();
              // 衝突点にスパーク（強い当たりの因果を光らせる）
              burstSpark(
                (a.mesh.position.x + b.mesh.position.x) / 2,
                (a.mesh.position.z + b.mesh.position.z) / 2, 4);
            }
          }
        }
      }

      // 場外判定
      if (!ending) {
        for (i = 0; i < bodies.length; i++) {
          b = bodies[i];
          if (!b.alive || b.sinking) continue;
          var px = b.mesh.position.x, pz = b.mesh.position.z;
          if (px * px + pz * pz > (R + 0.15) * (R + 0.15)) knockOut(ctx, b);
        }
      }

      // 自玉のリスポーン
      if (respawnT > 0) {
        respawnT -= dt;
        if (respawnT <= 0 && !ending) {
          player.alive = true; player.sinking = false;
          player.vel.set(0, 0, 0);
          player.mesh.visible = true;
          player.shadow.visible = true;
          player.mesh.position.set(0, player.r, 3.2);
          // 敵と重なるならずらす
          for (i = 1; i < bodies.length; i++) {
            b = bodies[i];
            if (!b.alive) continue;
            var ddx = b.mesh.position.x - player.mesh.position.x;
            var ddz = b.mesh.position.z - player.mesh.position.z;
            if (ddx * ddx + ddz * ddz < 1.2) player.mesh.position.z += 0.9;
          }
        }
      }

      // 終了判定
      if (!ending) {
        if (outCount >= 8) {
          ending = true; endKind = 'clear'; endT = 0.7;
          ctx.sfx.success();
        } else if (balls <= 0 && !player.sinking) {
          ending = true; endKind = 'over'; endT = 0.7;
        } else if (ctx.elapsed > TIME_CAP) {
          ending = true; endKind = 'clear'; endT = 0.3;
        }
      } else {
        endT -= dt;
        if (endT <= 0) {
          if (endKind === 'clear') ctx.endGame(outCount);
          else ctx.gameOver(outCount);
        }
      }
    }
  });
})();
