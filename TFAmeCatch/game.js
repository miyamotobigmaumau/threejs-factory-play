/* =========================================================================
 * TFAmeCatch — あめだまキャッチ
 * ルール: 空からふってくる飴（カラフル球）をカゴでキャッチ。
 *        連続キャッチでコンボボーナス。ピーマン（緑）を取るとライフ-1、
 *        飴を取りこぼすとコンボ切れ。ライフ3で開始、0で終了。
 * 操作: 左右ドラッグでカゴを動かす
 * スコア: キャッチ数＋コンボボーナス (こ)
 * コンティニュー: あり（ライフ2で その場から再開）
 * ========================================================================= */
(function () {
  'use strict';

  var basket, candies = [], pimans = [];
  var heartsEl;
  var bunny;                 // カゴを持つうさぎ
  var fxStars = [];          // 星バーストのプール
  var fxSplats = [];         // 取りこぼしスプラットのプール
  var basketPulse = 0;       // キャッチ時のぷにっと

  var FIELD_X = 4;          // カゴ可動域 ±
  var BASKET_Y = 1.2;       // キャッチ判定の高さ
  var CATCH_W = 1.2;        // キャッチ判定の横はば

  // 状態
  var lives, combo, spawnT, flashT;

  function updateHearts() {
    var s = '';
    for (var i = 0; i < lives; i++) s += '♥';
    for (var j = lives; j < 3; j++) s += '♡';
    heartsEl.textContent = s;
  }

  /* 飴・ピーマンをプールから1つ出す */
  function spawn(ctx) {
    var t = ctx.elapsed;
    var pimanProb = Math.min(0.38, 0.16 + t * 0.004);
    var pool = ctx.random() < pimanProb ? pimans : candies;
    for (var i = 0; i < pool.length; i++) {
      var it = pool[i];
      if (!it.active) {
        it.active = true;
        it.g.visible = true;
        it.g.position.set((ctx.random() * 2 - 1) * FIELD_X, 13 + ctx.random() * 2, 0);
        it.sp = 3.2 + t * 0.075 + ctx.random() * 1.2;
        if (it.mats) it.mesh.material = it.mats[(ctx.random() * it.mats.length) | 0];
        return;
      }
    }
  }

  function deactivate(it) {
    it.active = false;
    it.g.visible = false;
  }

  function clearItems() {
    var i;
    for (i = 0; i < candies.length; i++) deactivate(candies[i]);
    for (i = 0; i < pimans.length; i++) deactivate(pimans[i]);
    for (i = 0; i < fxStars.length; i++) { fxStars[i].active = false; fxStars[i].m.visible = false; }
    for (i = 0; i < fxSplats.length; i++) { fxSplats[i].active = false; fxSplats[i].m.visible = false; }
  }

  /* 星バースト（成功=金 / ピーマン=緑） */
  function spawnBurst(px, py, color, n) {
    var used = 0;
    for (var i = 0; i < fxStars.length && used < n; i++) {
      var s = fxStars[i];
      if (s.active) continue;
      s.active = true;
      s.m.visible = true;
      s.m.material.color.setHex(color);
      s.m.material.opacity = 1;
      s.m.position.set(px + (Math.random() - 0.5) * 0.4, py, (Math.random() - 0.5) * 0.4);
      var ang = Math.random() * Math.PI * 2;
      var sp = 2.2 + Math.random() * 2.2;
      s.vx = Math.cos(ang) * sp;
      s.vy = 2.5 + Math.random() * 2.5;
      s.vz = Math.sin(ang) * sp * 0.4;
      s.maxLife = 0.45 + Math.random() * 0.2;
      s.life = s.maxLife;
      used++;
    }
  }

  /* 取りこぼしスプラット（地面で飴色の円が広がって消える） */
  function spawnSplat(px, color) {
    for (var i = 0; i < fxSplats.length; i++) {
      var s = fxSplats[i];
      if (s.active) continue;
      s.active = true;
      s.m.visible = true;
      s.m.material.color.setHex(color);
      s.m.material.opacity = 0.75;
      s.m.position.set(px, 0.03, 0);
      s.m.scale.set(0.3, 0.3, 0.3);
      s.life = 0.5;
      return;
    }
  }

  function updateFx(dt) {
    var i, s, r;
    for (i = 0; i < fxStars.length; i++) {
      s = fxStars[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) { s.active = false; s.m.visible = false; continue; }
      s.m.position.x += s.vx * dt;
      s.m.position.y += s.vy * dt;
      s.m.position.z += s.vz * dt;
      s.vy -= 9 * dt;
      s.m.rotation.z += dt * 8;
      r = s.life / s.maxLife;
      s.m.material.opacity = r;
      s.m.scale.setScalar(0.6 + r * 0.6);
    }
    for (i = 0; i < fxSplats.length; i++) {
      s = fxSplats[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) { s.active = false; s.m.visible = false; continue; }
      r = s.life / 0.5;
      var sc = 0.3 + (1 - r) * 1.3;
      s.m.scale.set(sc, sc, sc);
      s.m.material.opacity = 0.75 * r;
    }
  }

  Shell.registerGame({
    id: 'TFAmeCatch',
    title: { en: 'Candy Catch', ja: 'あめだまキャッチ', es: 'Atrapa Caramelos', 'pt-BR': 'Pega Balas', fr: 'Attrape Bonbons', de: 'Bonbons Fangen', it: 'Acchiappa Caramelle', ko: '사탕 캐치', 'zh-Hans': '接糖果', tr: 'Şeker Yakala' },
    howto: { en: 'Catch falling candies with the basket!\nAvoid the green pepper!', ja: 'ふってくる あめだまをカゴでキャッチ！\nピーマン（みどり）はよけてね', es: '¡Atrapa los caramelos con la cesta!\n¡Evita el pimiento verde!', 'pt-BR': 'Pegue os doces que caem com a cesta!\nEvite o pimentão verde!', fr: 'Attrape les bonbons avec le panier !\nÉvite le poivron vert !', de: 'Fange die Bonbons mit dem Korb!\nWeiche dem grünen Paprika aus!', it: 'Prendi le caramelle con il cestino!\nEvita il peperone verde!', ko: '바구니로 떨어지는 사탕을 받아라!\n초록 피망은 피해요!', 'zh-Hans': '用篮子接住落下的糖果！\n要避开绿色辣椒！', tr: 'Düşen şekerleri sepetle yakala!\nYeşil biberden kaç!' },
    scoreLabel: { en: 'pcs', ja: 'こ', es: 'uds', 'pt-BR': 'pçs', fr: 'pcs', de: 'Stk', it: 'pz', ko: '개', 'zh-Hans': '个', tr: 'adet' },
    bg: 0xa8dcff,
    allowContinue: true,
    cameraFov: 60,
    cameraPos: [0, 6, 13],
    cameraLookAt: [0, 5, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 地面（パステルの草原）
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 60),
        Style.mat(0xb8e6a0)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // カゴの通り道（明るい帯でプレイエリアの輪郭を示す）
      var path = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.2), Style.mat(0xd7f0bc));
      path.rotation.x = -Math.PI / 2;
      path.position.set(0, 0.01, 0);
      ctx.scene.add(path);
      var pathEdge = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 3.8), Style.mat(0x94c97e));
      pathEdge.rotation.x = -Math.PI / 2;
      pathEdge.position.set(0, 0.005, 0);
      ctx.scene.add(pathEdge);

      // 花（草原の情報量）
      var petalMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      var coreMat = new THREE.MeshBasicMaterial({ color: 0xffca4f });
      [[-6.5, 2], [6.8, 1.4], [-7.5, -3], [8, -4], [-3.2, 3.4], [4.4, 3.1]].forEach(function (fp) {
        var fl = new THREE.Group();
        for (var pe = 0; pe < 5; pe++) {
          var ang = (pe / 5) * Math.PI * 2;
          var petal = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 4), petalMat);
          petal.position.set(Math.cos(ang) * 0.14, 0, Math.sin(ang) * 0.14);
          petal.scale.set(1, 0.4, 1);
          fl.add(petal);
        }
        var core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), coreMat);
        core.scale.set(1, 0.5, 1);
        fl.add(core);
        fl.position.set(fp[0], 0.08, fp[1]);
        ctx.scene.add(fl);
      });

      // 遠景: 丘＋雲（縦画面の上半分を埋める）
      [[-14, -24, 9, 0x8fce7c], [12, -28, 12, 0x7dbf6d], [0, -32, 15, 0x95d584]].forEach(function (h) {
        var hill = new THREE.Mesh(new THREE.SphereGeometry(h[2], 12, 8), Style.mat(h[3]));
        hill.scale.set(1.6, 0.55, 1);
        hill.position.set(h[0], 0, h[1]);
        ctx.scene.add(hill);
      });
      [[-7, 11, -18, 1.5], [6, 13.5, -20, 1.9], [0, 16, -24, 1.3], [11, 10, -16, 1.1]].forEach(function (c) {
        var cloud = new THREE.Group();
        for (var ci = 0; ci < 3; ci++) {
          var puff = new THREE.Mesh(new THREE.SphereGeometry(c[3] * (0.7 + Math.random() * 0.4), 7, 5),
            new THREE.MeshBasicMaterial({ color: 0xffffff }));
          puff.position.set(ci * c[3] * 0.85 - c[3] * 0.85, (Math.random() - 0.5) * 0.3, 0);
          cloud.add(puff);
        }
        cloud.position.set(c[0], c[1], c[2]);
        ctx.scene.add(cloud);
      });

      // 背景: お菓子の家
      var house = new THREE.Group();
      var wall = new THREE.Mesh(Style.roundedBox(3.4, 2.6, 2.4),
        Style.mat(0xf6e2b8));
      wall.position.y = 1.3;
      house.add(wall);
      var roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.8, 4),
        Style.mat(0x9c5a3c));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 3.5;
      house.add(roof);
      var door = new THREE.Mesh(Style.roundedBox(0.8, 1.2, 0.1),
        Style.mat(0xe57390));
      door.position.set(0, 0.6, 1.25);
      house.add(door);
      house.position.set(-4.5, 0, -7);
      ctx.scene.add(house);
      // ぺろぺろキャンディの木
      var stickMat = Style.mat(0xffffff);
      var popMats = [
        Style.mat(0xff6fa0),
        Style.mat(0x7fd0ff)
      ];
      for (var i = 0; i < 2; i++) {
        var pop = new THREE.Group();
        var stick = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), stickMat);
        stick.position.y = 1.2;
        pop.add(stick);
        var ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), popMats[i]);
        ball.position.y = 2.8;
        pop.add(ball);
        pop.position.set(3.5 + i * 2.4, 0, -7 - i * 2);
        ctx.scene.add(pop);
      }

      // カゴ（横開きの円筒＋底）
      basket = new THREE.Group();
      var basketMat = new THREE.MeshLambertMaterial({ color: 0xb07840, side: THREE.DoubleSide });
      var cup = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.8, 1.0, 14, 1, true), basketMat);
      cup.position.y = 0.5;
      basket.add(cup);
      var bottom = new THREE.Mesh(new THREE.CircleGeometry(0.8, 14), basketMat);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = 0.02;
      basket.add(bottom);
      var rimB = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 8, 16),
        Style.mat(0x8a5a28));
      rimB.rotation.x = -Math.PI / 2;
      rimB.position.y = 1.0;
      basket.add(rimB);
      basket.position.set(0, 0.6, 0);
      ctx.scene.add(basket);

      // カゴを持つうさぎ（主役。カゴと一緒に動く）
      bunny = GameBunny.make(THREE, { scale: 1.05 });
      bunny.group.position.set(0, -0.6, -1.0);
      bunny.armL.rotation.x = -1.15; // 両腕を前に伸ばしてカゴを支える
      bunny.armR.rotation.x = -1.15;
      bunny.armL.rotation.z = 0.1;
      bunny.armR.rotation.z = -0.1;
      basket.add(bunny.group);

      // 接地影（カゴ＋うさぎで1枚）
      var shadow = Style.softShadow(1.7);
      shadow.position.set(0, -0.58, -0.4);
      basket.add(shadow);

      // 飴プール（マテリアルは共有パレットから割り当て）
      var candyMats = [];
      var palette = [0xff5a76, 0xffa726, 0xffee58, 0xab7ff0, 0x64d8ff, 0x7ee08a];
      for (var c = 0; c < palette.length; c++) {
        candyMats.push(new THREE.MeshPhongMaterial({ color: palette[c], shininess: 80 }));
      }
      var candyGeo = new THREE.SphereGeometry(0.45, 12, 10);
      var wrapGeo = new THREE.ConeGeometry(0.16, 0.32, 6);
      var wrapMat = Style.mat(0xfff8ee);
      for (var k = 0; k < 12; k++) {
        var mesh = new THREE.Mesh(candyGeo, candyMats[0]);
        var g = new THREE.Group();
        g.add(mesh);
        // 包み紙のひねり（両端）→「飴」と分かるシルエットに
        var twistL = new THREE.Mesh(wrapGeo, wrapMat);
        twistL.rotation.z = Math.PI / 2;
        twistL.position.x = -0.56;
        g.add(twistL);
        var twistR = new THREE.Mesh(wrapGeo, wrapMat);
        twistR.rotation.z = -Math.PI / 2;
        twistR.position.x = 0.56;
        g.add(twistR);
        g.visible = false;
        ctx.scene.add(g);
        candies.push({ g: g, mesh: mesh, mats: candyMats, active: false, sp: 0 });
      }

      // ピーマンプール（緑の球＋ヘタ）
      var pimanMat = Style.mat(0x3aa544);
      var hetaMat = Style.mat(0x2a7030);
      var pimanGeo = new THREE.SphereGeometry(0.5, 12, 10);
      var hetaGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.3, 6);
      for (var m = 0; m < 6; m++) {
        var pg = new THREE.Group();
        var body = new THREE.Mesh(pimanGeo, pimanMat);
        body.scale.set(1, 0.85, 1);
        pg.add(body);
        var heta = new THREE.Mesh(hetaGeo, hetaMat);
        heta.position.y = 0.5;
        pg.add(heta);
        pg.visible = false;
        ctx.scene.add(pg);
        pimans.push({ g: pg, mesh: body, mats: null, active: false, sp: 0 });
      }

      // エフェクトプール（星バースト＋スプラット）
      var starGeo = new THREE.OctahedronGeometry(0.14, 0);
      for (var fs = 0; fs < 24; fs++) {
        var star = new THREE.Mesh(starGeo,
          new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 1 }));
        star.visible = false;
        ctx.scene.add(star);
        fxStars.push({ m: star, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, active: false });
      }
      var splatGeo = new THREE.CircleGeometry(0.5, 12);
      for (var fp2 = 0; fp2 < 6; fp2++) {
        var splat = new THREE.Mesh(splatGeo,
          new THREE.MeshBasicMaterial({ color: 0xff5a76, transparent: true, opacity: 0.75 }));
        splat.rotation.x = -Math.PI / 2;
        splat.visible = false;
        ctx.scene.add(splat);
        fxSplats.push({ m: splat, life: 0, active: false });
      }

      // ライフ表示（DOM）
      heartsEl = document.createElement('div');
      heartsEl.style.cssText = 'position:fixed;top:64px;right:16px;font-size:24px;color:#ff5a76;' +
        'z-index:11;text-shadow:0 1px 3px rgba(0,0,0,.3);display:none;';
      document.body.appendChild(heartsEl);
    },

    start: function (ctx) {
      lives = 3; combo = 0; spawnT = 0.5; flashT = 0;
      clearItems();
      basket.position.x = 0;
      updateHearts();
      heartsEl.style.display = '';
      ctx.setHint(ctx.t({ en: 'Drag left/right!', ja: '左右にドラッグ！', es: '¡Desliza izquierda/derecha!', 'pt-BR': 'Deslize para os lados!', fr: 'Glissez gauche/droite !', de: 'Links/rechts wischen!', it: 'Scorri a sinistra/destra!', ko: '좌우로 드래그!', 'zh-Hans': '左右滑动！', tr: 'Sola/sağa kaydır!' }));
    },

    onContinue: function (ctx) {
      // その場から再開: ライフ2ふっかつ、画面上の物は一度クリア
      lives = 2; combo = 0; spawnT = 0.8;
      clearItems();
      updateHearts();
      heartsEl.style.display = '';
      ctx.setHint(ctx.t({ en: 'Continue! Keep going!', ja: 'つづき！がんばれ！', es: '¡Continúa! ¡Ánimo!', 'pt-BR': 'Continue! Vai lá!', fr: 'Courage ! Continue !', de: 'Weiter! Viel Erfolg!', it: 'Continua! Forza!', ko: '계속! 힘내!', 'zh-Hans': '继续！加油！', tr: 'Devam! Haydi!' }));
    },

    onPointerDown: function (ctx, p) {
      basket.position.x = Math.max(-FIELD_X, Math.min(FIELD_X, p.nx * 5));
    },

    onPointerMove: function (ctx, p) {
      basket.position.x = Math.max(-FIELD_X, Math.min(FIELD_X, p.nx * 5));
    },

    update: function (ctx, dt) {
      // 出現間隔は時間とともに短く（難度曲線 → ライフ切れで30〜90秒に収束）
      spawnT -= dt;
      if (spawnT <= 0) {
        spawn(ctx);
        spawnT = Math.max(0.32, 0.85 - ctx.elapsed * 0.008);
      }

      // ピーマンを取った時の赤フラッシュもどし
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) basket.children[0].material.color.setHex(0xb07840);
      }

      // エフェクト＋うさぎの生きてる感
      updateFx(dt);
      bunny.flop(ctx.elapsed);
      if (basketPulse > 0) {
        basketPulse -= dt;
        var bp = Math.max(basketPulse, 0) / 0.18;
        basket.scale.set(1 + 0.12 * bp, 1 - 0.1 * bp, 1 + 0.12 * bp);
      } else {
        basket.scale.set(1, 1, 1);
      }

      var pools = [candies, pimans];
      for (var pi = 0; pi < 2; pi++) {
        var pool = pools[pi];
        var isPiman = pi === 1;
        for (var i = 0; i < pool.length; i++) {
          var it = pool[i];
          if (!it.active) continue;
          it.g.position.y -= it.sp * dt;
          it.g.rotation.z += dt * 2;

          // キャッチ判定
          if (it.g.position.y < BASKET_Y + 0.4 && it.g.position.y > BASKET_Y - 0.3 &&
              Math.abs(it.g.position.x - basket.position.x) < CATCH_W) {
            deactivate(it);
            if (isPiman) {
              lives--;
              combo = 0;
              updateHearts();
              basket.children[0].material.color.setHex(0xe05050);
              flashT = 0.3;
              spawnBurst(it.g.position.x, BASKET_Y + 0.6, 0x4a8a3a, 8);
              ctx.sfx.fail();
              ctx.vibrate(60);
              ctx.setHint(ctx.t({ en: 'Pepper! Life -1', ja: 'ピーマン！ ライフ-1', es: '¡Pimiento! Vida -1', 'pt-BR': 'Pimentão! Vida -1', fr: 'Poivron ! Vie -1', de: 'Paprika! Leben -1', it: 'Peperone! Vita -1', ko: '피망! 목숨 -1', 'zh-Hans': '辣椒！生命 -1', tr: 'Biber! Can -1' }));
              if (lives <= 0) {
                heartsEl.style.display = 'none';
                ctx.gameOver(ctx.score);
                return;
              }
            } else {
              combo++;
              ctx.addScore(1 + Math.floor(combo / 5)); // コンボボーナス
              spawnBurst(it.g.position.x, BASKET_Y + 0.6, 0xffd54f, 8);
              basketPulse = 0.18;
              ctx.sfx.score();
              ctx.vibrate(10);
              ctx.setHint(combo >= 2 ? ctx.t({ en: 'Combo x', ja: 'コンボ x', es: 'Combo x', 'pt-BR': 'Combo x', fr: 'Combo x', de: 'Kombo x', it: 'Combo x', ko: '콤보 x', 'zh-Hans': '连击 x', tr: 'Kombo x' }) + combo : '');
            }
            continue;
          }

          // 取りこぼし（飴は地面でスプラット。瞬間消滅させない）
          if (it.g.position.y < 0.2) {
            deactivate(it);
            if (!isPiman) spawnSplat(it.g.position.x, it.mesh.material.color.getHex());
            if (!isPiman && combo > 0) {
              combo = 0;
              ctx.setHint(ctx.t({ en: 'Combo broken…', ja: 'コンボきれた…', es: 'Combo roto…', 'pt-BR': 'Combo perdido…', fr: 'Combo brisé…', de: 'Kombo unterbrochen…', it: 'Combo interrotto…', ko: '콤보 끊겼어…', 'zh-Hans': '连击断了…', tr: 'Kombo bitti…' }));
            }
          }
        }
      }
    }
  });
})();
