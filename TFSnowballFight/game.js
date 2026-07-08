/* =========================================================================
 * TFSnowballFight — ゆきがっせん
 * ルール: 雪原の3レーン（近・中・遠）にランダムに現れる雪だるまに
 *        雪玉を山なりに当てろ！45秒タイムアタック。
 * 操作: 下に引いて離すと投球（引き量=とぶ距離、左右=方向）。
 * スコア: 当てた雪だるまの数 (たい)
 * ========================================================================= */
(function () {
  'use strict';

  var TIME_LIMIT = 45;
  var GRAV = 14;
  var ROWS_Z = [-10, -17, -25];   // 近・中・遠レーン
  var SNOWMAN_N = 9;              // 雪だるまプール
  var BALL_N = 6;                 // 雪玉プール
  var PART_N = 30;                // 破片パーティクルプール

  var snowmen = [], balls = [], parts = [];
  var aimRing;
  var goldSnowMat;
  var timeLeft, spawnT, lastHintSec;
  var aiming, aimSX, aimSY, aimDist, aimX;

  // ディテールパス追加分
  var SCARF_COLORS = [0xc23b3b, 0x2f6fb2, 0x2e8b57];
  var FLOAT_N = 4, RING_N = 3, SNOW_N = 110;
  var floats = [], hitRings = [], clouds = [];
  var snowPts, snowPos, snowSpd;
  var bunny, throwT;
  var texPlus1, texPlus5;

  // 「+N」フローティング用テクスチャ
  function scoreTexture(text, fill, stroke) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 64;
    var c = cv.getContext('2d');
    c.font = 'bold 46px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 9; c.strokeStyle = stroke; c.lineJoin = 'round';
    c.strokeText(text, 64, 34);
    c.fillStyle = fill;
    c.fillText(text, 64, 34);
    return new THREE_REF.CanvasTexture(cv);
  }
  var THREE_REF; // scoreTexture から参照

  function spawnFloat(gold, x, y, z) {
    for (var i = 0; i < FLOAT_N; i++) {
      var sp = floats[i];
      if (sp.userData.life > 0) continue;
      sp.material.map = gold ? texPlus5 : texPlus1;
      sp.material.needsUpdate = true;
      sp.material.opacity = 1;
      sp.position.set(x, y + 0.8, z);
      sp.userData.life = 0.9;
      sp.visible = true;
      return;
    }
  }

  function spawnRing(gold, x, y, z) {
    for (var i = 0; i < RING_N; i++) {
      var r = hitRings[i];
      if (r.userData.life > 0) continue;
      r.material.color.setHex(gold ? 0xffd54f : 0x66bb6a);
      r.material.opacity = 0.9;
      r.position.set(x, y, z);
      r.scale.set(1, 1, 1);
      r.userData.life = 0.45;
      r.visible = true;
      return;
    }
  }

  // 雪だるま1体を生成
  function starTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    var c = cv.getContext('2d');
    c.fillStyle = '#fff176';
    c.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var r = i % 2 === 0 ? 28 : 12;
      var x = 32 + Math.cos(a) * r;
      var y = 32 + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath(); c.fill();
    return new THREE.CanvasTexture(cv);
  }

  function makeSnowman(THREE, starMat) {
    var g = new THREE.Group();
    var white = Style.mat(0xffffff);
    var black = Style.mat(0x222222);
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 12), white);
    body.position.y = 0.7;
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 12), white);
    head.position.y = 1.75;
    var eyeGeo = new THREE.SphereGeometry(0.06, 6, 6);
    var eL = new THREE.Mesh(eyeGeo, black);
    eL.position.set(-0.16, 1.85, 0.4);
    var eR = new THREE.Mesh(eyeGeo, black);
    eR.position.set(0.16, 1.85, 0.4);
    var nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.4, 8),
      Style.mat(0xf08030)
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.72, 0.55);
    var bucket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.38, 0.3, 10),
      Style.mat(0xd04545)
    );
    bucket.position.y = 2.2;
    g.add(body, head, eL, eR, nose, bucket);
    var stars = [];
    for (var st = 0; st < 3; st++) {
      var sp = new THREE.Sprite(starMat);
      sp.position.set((st - 1) * 0.45, 2.2 - st * 0.22, 0.55);
      sp.scale.set(0.34, 0.34, 0.34);
      sp.visible = false;
      g.add(sp);
      stars.push(sp);
    }
    g.userData = {
      state: 0, t: 0, life: 0, gold: false,
      body: body, head: head, whiteMat: white, stars: stars
    };   // 0=非表示 1=出現中 2=待機 3=沈み中
    g.visible = false;
    return g;
  }

  function setGoldSnowman(s, gold) {
    var u = s.userData;
    u.gold = gold;
    u.body.material = gold ? goldSnowMat : u.whiteMat;
    u.head.material = gold ? goldSnowMat : u.whiteMat;
    for (var i = 0; i < u.stars.length; i++) u.stars[i].visible = gold;
  }

  // 空いている雪だるまを出現させる
  function spawnSnowman(ctx) {
    for (var i = 0; i < SNOWMAN_N; i++) {
      var s = snowmen[i];
      if (s.userData.state === 0) {
        var row = Math.floor(ctx.random() * 3);
        var spread = 3.5 + row * 2;
        s.position.set((ctx.random() - 0.5) * 2 * spread, -2.4, ROWS_Z[row]);
        s.userData.state = 1;
        s.userData.t = 0;
        s.userData.life = 3 + ctx.random() * 2.5;
        setGoldSnowman(s, ctx.random() < 0.08);
        s.visible = true;
        return;
      }
    }
  }

  // 雪の破片を飛ばす
  function burst(ctx, x, y, z, n) {
    var used = 0;
    for (var i = 0; i < PART_N && used < n; i++) {
      var p = parts[i];
      if (p.userData.life > 0) continue;
      p.position.set(x, y, z);
      p.userData.vx = (ctx.random() - 0.5) * 6;
      p.userData.vy = 2 + ctx.random() * 4;
      p.userData.vz = (ctx.random() - 0.5) * 6;
      p.userData.life = 0.7;
      p.visible = true;
      used++;
    }
  }

  Shell.registerGame({
    id: 'TFSnowballFight',
    title: { en: 'Snowball Fight', ja: 'ゆきがっせん', es: 'Guerra de Bolas de Nieve', 'pt-BR': 'Guerra de Bolas de Neve', fr: 'Bataille de Boules de Neige', de: 'Schneeballschlacht', it: 'Battaglia di Neve', ko: '눈싸움', 'zh-Hans': '打雪仗', tr: 'Kar Topu Savaşı' },
    howto: { en: 'Drag down and release to throw!\nGolden snowman = 5x points!\nHit as many as you can in 45 sec!', ja: 'したにひいて はなすと なげるよ\nきんのゆきだるまは 5ばいてん！\n45びょうで あてまくれ！', es: '¡Desliza hacia abajo y suelta para lanzar!\n¡El muñeco dorado vale x5!\n¡Acierta en 45 seg!', 'pt-BR': 'Deslize para baixo e solte para arremessar!\nBoneco dourado = x5 pontos!\nAcerte o máximo em 45 seg!', fr: 'Glissez vers le bas et relâchez pour lancer!\nLe bonhomme doré = x5 points!\nViser en 45 sec!', de: 'Nach unten ziehen und loslassen!\nGoldener Schneemann = x5 Punkte!\n45 Sek – so viele wie möglich!', it: 'Trascina in basso e rilascia per lanciare!\nBoneco dorato = x5 punti!\nColpisci più che puoi in 45 sec!', ko: '아래로 드래그 후 놓아서 던지기!\n황금 눈사람 = 5배 점수!\n45초 안에 최대한 맞히자!', 'zh-Hans': '向下拖动松手投球！\n金色雪人 = 5倍分数！\n45秒内尽量多打！', tr: 'Aşağı sürükle ve bırak!\nAltın kardan adam = 5 kat puan!\n45 saniyede maksimum vur!' },
    scoreLabel: { en: 'hit', ja: 'たい', es: 'golpe', 'pt-BR': 'acerto', fr: 'touche', de: 'Treffer', it: 'colpo', ko: '개', 'zh-Hans': '个', tr: 'isabet' },
    bg: 0xdfeeff,
    fogNear: 30, fogFar: 90,
    cameraFov: 60,
    cameraPos: [0, 2.4, 6],
    cameraLookAt: [0, 1.2, -14],

    init: function (ctx) {
      var THREE = ctx.THREE;
      goldSnowMat = new THREE.MeshPhongMaterial({ color: 0xffd54f, shininess: 80, specular: 0xffffff });

      // 雪原
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 120),
        Style.mat(0xf4f9ff)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // 雪をかぶった木（円錐・飾り）
      var treeMat = Style.mat(0xe8f4f0);
      for (var t = 0; t < 8; t++) {
        var tree = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.2, 8), treeMat);
        var side = t % 2 === 0 ? -1 : 1;
        tree.position.set(side * (9 + Math.random() * 6), 1.6, -8 - Math.random() * 25);
        ctx.scene.add(tree);
      }

      // 雪だるまプール
      var starMat = new THREE.SpriteMaterial({ map: starTexture(THREE), transparent: true });
      for (var i = 0; i < SNOWMAN_N; i++) {
        var s = makeSnowman(THREE, starMat);
        ctx.scene.add(s);
        snowmen.push(s);
      }

      // 雪玉プール
      var ballGeo = new THREE.SphereGeometry(0.22, 10, 8);
      var ballMat = Style.mat(0xffffff);
      for (var b = 0; b < BALL_N; b++) {
        var m = new THREE.Mesh(ballGeo, ballMat);
        m.userData = { active: false, vx: 0, vy: 0, vz: 0 };
        m.visible = false;
        ctx.scene.add(m);
        balls.push(m);
      }

      // 破片パーティクルプール
      var pGeo = new THREE.SphereGeometry(0.09, 6, 4);
      var pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (var p = 0; p < PART_N; p++) {
        var pm = new THREE.Mesh(pGeo, pMat);
        pm.userData = { vx: 0, vy: 0, vz: 0, life: 0 };
        pm.visible = false;
        ctx.scene.add(pm);
        parts.push(pm);
      }

      // 着弾予測リング
      aimRing = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.75, 20),
        new THREE.MeshBasicMaterial({ color: 0xff8844, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
      );
      aimRing.rotation.x = -Math.PI / 2;
      aimRing.visible = false;
      ctx.scene.add(aimRing);
    },

    start: function (ctx) {
      timeLeft = TIME_LIMIT;
      spawnT = 0;
      lastHintSec = -1;
      aiming = false;
      aimRing.visible = false;
      var i;
      for (i = 0; i < SNOWMAN_N; i++) {
        snowmen[i].userData.state = 0;
        setGoldSnowman(snowmen[i], false);
        snowmen[i].visible = false;
      }
      for (i = 0; i < BALL_N; i++) {
        balls[i].userData.active = false;
        balls[i].visible = false;
      }
      for (i = 0; i < PART_N; i++) {
        parts[i].userData.life = 0;
        parts[i].visible = false;
      }
      // 最初から2体出しておく
      spawnSnowman(ctx);
      spawnSnowman(ctx);
      ctx.setHint(ctx.t({ en: 'Time: ', ja: 'のこり ', es: 'Tiempo: ', 'pt-BR': 'Tempo: ', fr: 'Temps: ', de: 'Zeit: ', it: 'Tempo: ', ko: '남은 시간: ', 'zh-Hans': '剩余: ', tr: 'Süre: ' }) + TIME_LIMIT + ctx.t({ en: ' sec', ja: ' びょう', es: ' seg', 'pt-BR': ' seg', fr: ' sec', de: ' Sek', it: ' sec', ko: ' 초', 'zh-Hans': ' 秒', tr: ' sn' }));
    },

    onPointerDown: function (ctx, p) {
      aiming = true;
      aimSX = p.x; aimSY = p.y;
      aimDist = 0; aimX = 0;
    },

    onPointerMove: function (ctx, p) {
      if (!aiming) return;
      var dy = p.y - aimSY;   // 下に引いた量(px)
      var dx = p.x - aimSX;
      if (dy < 15) { aimRing.visible = false; aimDist = 0; return; }
      aimDist = Math.min(4 + dy * 0.075, 30);
      aimX = dx * 0.035 * (aimDist / 8);
      aimRing.position.set(aimX, 0.05, -aimDist);
      var sc = 1 + aimDist * 0.05; // 遠いほどリングを大きく（見やすさ）
      aimRing.scale.set(sc, sc, 1);
      aimRing.visible = true;
    },

    onPointerUp: function (ctx, p) {
      if (!aiming) return;
      aiming = false;
      aimRing.visible = false;
      if (aimDist < 4.5) return; // 引きが足りない
      // 空いている雪玉で山なり投球（着弾点=リング位置になる弾道を逆算）
      for (var i = 0; i < BALL_N; i++) {
        var b = balls[i];
        if (b.userData.active) continue;
        var T = 0.55 + aimDist * 0.028; // 滞空時間
        b.position.set(0, 1.4, 3.5);
        b.userData.vx = (aimX - 0) / T;
        b.userData.vz = (-aimDist - 3.5) / T;
        b.userData.vy = (0.3 - 1.4 + 0.5 * GRAV * T * T) / T;
        b.userData.active = true;
        b.visible = true;
        ctx.sfx.tap();
        ctx.vibrate(15);
        break;
      }
    },

    update: function (ctx, dt) {
      var i, j, u;

      // タイマー
      timeLeft -= dt;
      var sec = Math.ceil(timeLeft);
      if (sec !== lastHintSec) {
        lastHintSec = sec;
        ctx.setHint(ctx.t({ en: 'Time: ', ja: 'のこり ', es: 'Tiempo: ', 'pt-BR': 'Tempo: ', fr: 'Temps: ', de: 'Zeit: ', it: 'Tempo: ', ko: '남은 시간: ', 'zh-Hans': '剩余: ', tr: 'Süre: ' }) + Math.max(0, sec) + ctx.t({ en: ' sec', ja: ' びょう', es: ' seg', 'pt-BR': ' seg', fr: ' sec', de: ' Sek', it: ' sec', ko: ' 초', 'zh-Hans': ' 秒', tr: ' sn' }));
      }
      if (timeLeft <= 0) {
        ctx.endGame(ctx.score);
        return;
      }

      // 雪だるま出現（時間とともにテンポUP）
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnSnowman(ctx);
        spawnT = 1.5 - (1 - timeLeft / TIME_LIMIT) * 0.8;
      }

      // 雪だるまの状態遷移
      for (i = 0; i < SNOWMAN_N; i++) {
        var s = snowmen[i];
        u = s.userData;
        if (u.state === 0) continue;
        u.t += dt;
        if (u.state === 1) {          // せり上がり
          s.position.y = -2.4 + Math.min(1, u.t / 0.4) * 2.4;
          if (u.t >= 0.4) { u.state = 2; u.t = 0; s.position.y = 0; }
        } else if (u.state === 2) {   // 待機 → 寿命で沈む
          if (u.t >= u.life) { u.state = 3; u.t = 0; }
        } else if (u.state === 3) {   // 沈み
          s.position.y = -Math.min(1, u.t / 0.4) * 2.4;
          if (u.t >= 0.4) { u.state = 0; s.visible = false; }
        }
        if (u.gold) {
          for (var si = 0; si < u.stars.length; si++) {
            u.stars[si].material.rotation = ctx.elapsed * (1.8 + si * 0.5);
          }
        }
      }

      // 雪玉の弾道＆当たり判定
      for (i = 0; i < BALL_N; i++) {
        var b = balls[i];
        u = b.userData;
        if (!u.active) continue;
        u.vy -= GRAV * dt;
        b.position.x += u.vx * dt;
        b.position.y += u.vy * dt;
        b.position.z += u.vz * dt;

        // 雪だるまに命中？
        var hit = false;
        for (j = 0; j < SNOWMAN_N; j++) {
          var sm = snowmen[j];
          var su = sm.userData;
          if (su.state !== 1 && su.state !== 2) continue;
          var dx = b.position.x - sm.position.x;
          var dz = b.position.z - sm.position.z;
          var hy = b.position.y - sm.position.y;
          if (dx * dx + dz * dz < 0.85 && hy > 0 && hy < 2.5) {
            // 命中！ 崩れて破片が飛ぶ
            su.state = 0;
            sm.visible = false;
            burst(ctx, sm.position.x, sm.position.y + 1, sm.position.z, su.gold ? 14 : 8);
            ctx.addScore(su.gold ? 5 : 1);
            if (su.gold) {
              ctx.sfx.success();
              ctx.setHint(ctx.t({ en: 'Golden! x5', ja: 'ゴールデン！x5', es: '¡Dorado! x5', 'pt-BR': 'Dourado! x5', fr: 'Doré! x5', de: 'Golden! x5', it: 'Dorato! x5', ko: '황금! x5', 'zh-Hans': '黄金！x5', tr: 'Altın! x5' }));
            } else {
              ctx.sfx.score();
            }
            ctx.vibrate(30);
            hit = true;
            break;
          }
        }
        if (hit || b.position.y < 0.1 || b.position.z < -40) {
          if (!hit && b.position.y < 0.1) {
            burst(ctx, b.position.x, 0.2, b.position.z, 3); // 地面で雪煙
          }
          u.active = false;
          b.visible = false;
        }
      }

      // 破片パーティクル
      for (i = 0; i < PART_N; i++) {
        var pp = parts[i];
        u = pp.userData;
        if (u.life <= 0) continue;
        u.life -= dt;
        u.vy -= GRAV * dt;
        pp.position.x += u.vx * dt;
        pp.position.y += u.vy * dt;
        pp.position.z += u.vz * dt;
        if (u.life <= 0 || pp.position.y < 0) { u.life = 0; pp.visible = false; }
      }
    }
  });
})();
