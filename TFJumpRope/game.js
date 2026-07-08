/* =========================================================================
 * TFJumpRope — なわとび
 * ルール: 回る縄が足元に来るタイミングでタップしてジャンプ。
 *        回転はだんだん加速。たまに「2だんとび」（縄が高速で2回転）が来るので
 *        ジャンプ中にもう1回タップして滞空を伸ばして2回分クリアする。
 * スコア: 跳んだ回数 (かい)。10回ごとに歓声。コンティニュー可。
 * ========================================================================= */
(function () {
  'use strict';

  var chara, ropeDots = [], ropeMat, perfectRing;
  var count, omegaBase, phi, lastRev, lastHalf, doubleRev;
  var py, vyJ, boosted, state, failT; // state: 0=プレイ 1=ひっかかり演出
  var pendingPerfect, perfectStreak, feverLeft, ringT, stageColorIdx;
  var charaShadow, warnRing, landSquash;
  var dusts = [], dustPool = [];

  function spawnDust(count2) {
    for (var i = 0; i < count2; i++) {
      var d = null;
      for (var di = 0; di < dustPool.length; di++) {
        if (!dustPool[di].visible) { d = dustPool[di]; break; }
      }
      if (!d) return;
      var ang = Math.random() * Math.PI * 2;
      d.userData.vx = Math.cos(ang) * (1.2 + Math.random());
      d.userData.vz = Math.sin(ang) * (1.2 + Math.random());
      d.userData.life = 0.4 + Math.random() * 0.2;
      d.userData.maxLife = d.userData.life;
      d.position.set((Math.random() - 0.5) * 0.5, 0.1, (Math.random() - 0.5) * 0.5);
      d.scale.set(1, 1, 1);
      d.visible = true;
      dusts.push(d);
    }
  }

  var G = 9.8, JUMP_V = 3.5, BOOST_V = 2.4;
  var HAND_Y = 1.42, HAND_X = 2.6, ROPE_R = 1.36, N_DOTS = 18;
  var ROPE_COLOR = 0xd94f2b, ROPE_DOUBLE = 0xff2222;
  var BG_COLORS = [0x9ecfef, 0xa8d8f4, 0xb6e1df, 0xbfe4cf, 0xd1e3b4];

  function bottomPhaseDist() {
    var a = phi % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return Math.min(a, Math.PI * 2 - a);
  }

  function makeKid(THREE, shirt, x, z) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.27, 0.6, 10),
      Style.mat(shirt)
    );
    body.position.y = 0.62;
    var legs = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.16, 0.35, 8),
      Style.mat(0x3a4a6b)
    );
    legs.position.y = 0.17;
    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 10),
      Style.mat(0xffd9b0)
    );
    head.position.y = 1.18;
    var hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      Style.mat(0x4a3626)
    );
    hair.position.y = 1.2;
    g.add(body, legs, head, hair);
    // 目（黒点。カメラ側を向く）
    [1, -1].forEach(function (xs) {
      var eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0x2a2a2a })
      );
      eye.position.set(0.1 * xs, 1.2, 0.23);
      g.add(eye);
    });
    g.position.set(x, 0, z);
    return g;
  }

  function currentOmega() {
    return doubleRev > 0 ? Math.max(omegaBase * 1.9, 8.4) : omegaBase;
  }

  function endDouble(ctx) {
    doubleRev = 0;
    if (feverLeft <= 0) ropeMat.color.setHex(ROPE_COLOR);
    ctx.setHint('');
  }

  Shell.registerGame({
    id: 'TFJumpRope',
    title: { en: 'Jump Rope', ja: 'なわとび', es: 'Salto de cuerda', 'pt-BR': 'Pular corda', fr: 'Corde à sauter', de: 'Seilspringen', it: 'Salto con la corda', ko: '줄넘기', 'zh-Hans': '跳绳', tr: 'İp atlama' },
    howto: { en: 'Tap when the rope reaches your feet!\nPerfect timing = Perfect!\n3 in a row = Fever!', ja: 'なわが あしもとに きたら タップ！\nぴったりとぶと パーフェクト！\n3れんぞくで フィーバー！', es: '¡Toca cuando la cuerda llegue a tus pies!\n¡Timing perfecto = Perfecto!\n¡3 seguidas = Fiebre!', 'pt-BR': 'Toque quando a corda chegar aos seus pés!\nTiming perfeito = Perfeito!\n3 seguidas = Febre!', fr: 'Touchez quand la corde atteint vos pieds !\nTiming parfait = Parfait !\n3 de suite = Fièvre !', de: 'Tippe wenn das Seil deine Füße erreicht!\nPerfektes Timing = Perfekt!\n3 hintereinander = Fieber!', it: 'Tocca quando la corda raggiunge i tuoi piedi!\nTiming perfetto = Perfetto!\n3 di fila = Febbre!', ko: '줄이 발에 닿을 때 탭하세요!\n완벽한 타이밍 = 완벽!\n3연속 = 피버!', 'zh-Hans': '绳子到脚边时点击！\n时机完美 = 完美！\n连续3次 = 热潮！', tr: 'Halat ayağınıza gelince dokun!\nMükemmel zamanlama = Mükemmel!\n3 üst üste = Ateş!' },
    scoreLabel: { en: 'times', ja: 'かい', es: 'veces', 'pt-BR': 'vezes', fr: 'fois', de: 'Mal', it: 'volte', ko: '번', 'zh-Hans': '次', tr: 'kez' },
    bg: 0x9ecfef,
    cameraFov: 55,
    cameraPos: [0, 3.2, 7.5],
    cameraLookAt: [0, 1.1, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 校庭の地面
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        Style.mat(0xd8c48e)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // 校舎（奥のバックドロップ）
      var school = new THREE.Mesh(
        Style.roundedBox(14, 4.5, 1.5),
        Style.mat(0xf2e6cc)
      );
      school.position.set(0, 2.25, -12);
      ctx.scene.add(school);
      var winMat = Style.mat(0x8fc7e8);
      var winGeo = Style.roundedBox(1.1, 0.9, 0.1);
      for (var w = 0; w < 8; w++) {
        var win = new THREE.Mesh(winGeo, winMat);
        win.position.set((w % 4) * 3 - 4.5, w < 4 ? 3.2 : 1.5, -11.2);
        ctx.scene.add(win);
      }
      // 木
      var trunkMat = Style.mat(0x7a5a36);
      var leafMat = Style.mat(0x4e9e4a);
      for (var t = 0; t < 3; t++) {
        var tx = [-8, 8, -10][t];
        var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.6, 8), trunkMat);
        trunk.position.set(tx, 0.8, -9);
        var crown = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), leafMat);
        crown.position.set(tx, 2.4, -9);
        ctx.scene.add(trunk, crown);
      }

      // 回し手2人（左右）
      var turnerL = makeKid(THREE, 0x4ea86b, -3.1, 0);
      var turnerR = makeKid(THREE, 0xf0a030, 3.1, 0);
      ctx.scene.add(turnerL, turnerR);
      // 腕（手元へ伸ばす簡易表現）
      var armMat = Style.mat(0xffd9b0);
      var armL = new THREE.Mesh(Style.roundedBox(0.5, 0.1, 0.1), armMat);
      armL.position.set(-2.82, HAND_Y, 0);
      var armR = new THREE.Mesh(Style.roundedBox(0.5, 0.1, 0.1), armMat);
      armR.position.set(2.82, HAND_Y, 0);
      ctx.scene.add(armL, armR);

      // 跳ぶキャラ（中央・正面向き）
      chara = makeKid(THREE, 0xd94f4f, 0, 0);
      ctx.scene.add(chara);
      // 足元の丸影
      var shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.4, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.01;
      ctx.scene.add(shadow);

      // 縄（球の連なりで表現。毎フレーム位置だけ更新）
      ropeMat = Style.mat(ROPE_COLOR);
      var dotGeo = new THREE.SphereGeometry(0.07, 8, 6);
      for (var i = 0; i < N_DOTS; i++) {
        var d = new THREE.Mesh(dotGeo, ropeMat);
        ctx.scene.add(d);
        ropeDots.push(d);
      }

      perfectRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.035, 8, 36),
        new THREE.MeshBasicMaterial({ color: 0xfff176, transparent: true, opacity: 0 })
      );
      perfectRing.rotation.x = Math.PI / 2;
      perfectRing.position.y = 0.04;
      perfectRing.visible = false;
      ctx.scene.add(perfectRing);
    },

    start: function (ctx) {
      count = 0; omegaBase = 3.2; phi = Math.PI;
      lastRev = 0; lastHalf = 0; doubleRev = 0;
      py = 0; vyJ = 0; boosted = false; state = 0; failT = 0;
      pendingPerfect = false; perfectStreak = 0; feverLeft = 0; ringT = 0; stageColorIdx = 0;
      chara.position.y = 0;
      chara.rotation.set(0, 0, 0);
      chara.scale.y = 1;
      ropeMat.color.setHex(ROPE_COLOR);
      perfectRing.visible = false;
      if (ctx.scene.background) ctx.scene.background.setHex(BG_COLORS[0]);
      ctx.setHint(ctx.t({ en: 'Tap when the rope comes!', ja: 'なわが きたら タップ！', es: '¡Toca cuando venga la cuerda!', 'pt-BR': 'Toque quando a corda vier!', fr: 'Touchez quand la corde arrive !', de: 'Tippe wenn das Seil kommt!', it: 'Tocca quando arriva la corda!', ko: '줄이 오면 탭하세요!', 'zh-Hans': '绳子来了就点击！', tr: 'Halat gelince dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (state !== 0) return;
      if (py <= 0) {
        vyJ = JUMP_V;
        boosted = false;
        pendingPerfect = bottomPhaseDist() <= Math.PI * 0.3;
        ctx.sfx.tap();
      } else if (!boosted) {
        // 空中でもう1タップ → 滞空を伸ばす（2だんとび用）
        vyJ = Math.max(vyJ, 0) + BOOST_V;
        boosted = true;
        ctx.sfx.tap();
      }
    },

    onContinue: function (ctx) {
      // 縄を頭上に戻してスロー再開。スコアはそのまま継続
      state = 0; failT = 0;
      phi = Math.PI; lastRev = 0; lastHalf = 0;
      doubleRev = 0;
      ropeMat.color.setHex(ROPE_COLOR);
      omegaBase = Math.max(3.2, omegaBase * 0.9);
      py = 0; vyJ = 0; boosted = false;
      pendingPerfect = false; perfectStreak = 0; feverLeft = 0; ringT = 0;
      chara.position.y = 0;
      chara.rotation.set(0, 0, 0);
      perfectRing.visible = false;
      ctx.setHint(ctx.t({ en: 'Back in! Tap when the rope comes!', ja: 'ふっかつ！なわが きたら タップ！', es: '¡Reincorporado! ¡Toca cuando venga la cuerda!', 'pt-BR': 'Voltou! Toque quando a corda vier!', fr: 'Retour ! Touchez quand la corde arrive !', de: 'Zurück! Tippe wenn das Seil kommt!', it: 'Di ritorno! Tocca quando arriva la corda!', ko: '부활! 줄이 오면 탭하세요!', 'zh-Hans': '复活！绳子来了就点击！', tr: 'Geri döndü! Halat gelince dokun!' }));
    },

    update: function (ctx, dt) {
      if (state === 1) {
        // ひっかかって転ぶ演出 → ゲームオーバー
        failT += dt;
        chara.rotation.x = Math.min(chara.rotation.x + dt * 4, Math.PI / 2);
        chara.position.y = Math.max(chara.position.y - dt * 2, 0.15);
        if (failT > 0.9) ctx.gameOver(count);
        return;
      }

      // 縄の回転
      phi += currentOmega() * dt;
      if (feverLeft > 0) {
        var rr = Math.floor((Math.sin(ctx.elapsed * 12) * 0.5 + 0.5) * 120) + 120;
        var gg = Math.floor((Math.sin(ctx.elapsed * 12 + 2) * 0.5 + 0.5) * 120) + 120;
        var bb = Math.floor((Math.sin(ctx.elapsed * 12 + 4) * 0.5 + 0.5) * 120) + 120;
        ropeMat.color.setRGB(rr / 255, gg / 255, bb / 255);
      }

      // ジャンプ物理
      if (py > 0 || vyJ > 0) {
        py += vyJ * dt;
        vyJ -= G * dt;
        if (py <= 0) { py = 0; vyJ = 0; boosted = false; }
      }
      chara.position.y = py;
      // 空中はちょっと伸びる
      chara.scale.y = py > 0 ? 1.04 : 1;
      if (ringT > 0) {
        ringT -= dt;
        var rs = 1 + (0.35 - Math.max(0, ringT)) * 2.6;
        perfectRing.scale.set(rs, rs, rs);
        perfectRing.material.opacity = Math.max(0, ringT / 0.35);
        if (ringT <= 0) perfectRing.visible = false;
      }

      // 縄のドット位置更新（手と手を結ぶ弧が回転）
      for (var i = 0; i < N_DOTS; i++) {
        var t = i / (N_DOTS - 1);
        var r = Math.sin(Math.PI * t) * ROPE_R;
        ropeDots[i].position.set(
          -HAND_X + HAND_X * 2 * t,
          HAND_Y - Math.cos(phi) * r,
          Math.sin(phi) * r
        );
      }

      // 頭上通過（半回転）ごとに2だんとび抽選
      var halfIdx = Math.floor(phi / (Math.PI * 2) - 0.5);
      if (halfIdx > lastHalf) {
        lastHalf = halfIdx;
        if (doubleRev === 0 && count >= 8 && omegaBase >= 4.0 && Math.random() < 0.16) {
          doubleRev = 2;
          ropeMat.color.setHex(ROPE_DOUBLE);
          ctx.setHint(ctx.t({ en: 'Double jump! Tap again in mid-air!', ja: '2だんとび！くうちゅうで もう1タップ！', es: '¡Doble salto! ¡Toca otra vez en el aire!', 'pt-BR': 'Salto duplo! Toque novamente no ar!', fr: 'Double saut ! Touchez encore en l\'air !', de: 'Doppelsprung! Nochmal tippen in der Luft!', it: 'Doppio salto! Tocca di nuovo in aria!', ko: '이단 뛰기! 공중에서 한 번 더 탭!', 'zh-Hans': '二段跳！在空中再点击一次！', tr: 'Çift atlama! Havadayken tekrar dokun!' }));
        }
      }

      // 足元通過（1回転）ごとに判定
      var rev = Math.floor(phi / (Math.PI * 2));
      while (rev > lastRev) {
        lastRev++;
        if (py > 0.30) {
          // クリア！
          count++;
          var inFever = feverLeft > 0;
          ctx.addScore(inFever ? 2 : 1);
          if (pendingPerfect) {
            perfectStreak++;
            ctx.sfx.score();
            ringT = 0.35;
            perfectRing.visible = true;
            perfectRing.scale.set(1, 1, 1);
            perfectRing.material.opacity = 1;
            if (perfectStreak >= 3 && feverLeft <= 0) {
              feverLeft = 10;
              ctx.setHint(ctx.t({ en: 'Fever! Score x2!', ja: 'フィーバー！てんすう2ばい', es: '¡Fiebre! ¡Puntos x2!', 'pt-BR': 'Febre! Pontos x2!', fr: 'Fièvre ! Score x2 !', de: 'Fieber! Punkte x2!', it: 'Febbre! Punteggio x2!', ko: '피버! 점수 2배!', 'zh-Hans': '热潮！得分×2！', tr: 'Ateş! Puan x2!' }));
              ctx.sfx.success();
            } else {
              ctx.setHint(ctx.t({ en: 'Perfect!', ja: 'パーフェクト！', es: '¡Perfecto!', 'pt-BR': 'Perfeito!', fr: 'Parfait !', de: 'Perfekt!', it: 'Perfetto!', ko: '완벽!', 'zh-Hans': '完美！', tr: 'Mükemmel!' }));
            }
          } else {
            perfectStreak = 0;
            ctx.sfx.score();
          }
          if (inFever) {
            feverLeft--;
            if (feverLeft <= 0) ropeMat.color.setHex(doubleRev > 0 ? ROPE_DOUBLE : ROPE_COLOR);
          }
          pendingPerfect = false;
          if (doubleRev > 0) {
            doubleRev--;
            if (doubleRev === 0) endDouble(ctx);
          }
          omegaBase = Math.min(3.2 + count * 0.065, 7.5);
          if (count % 10 === 0) {
            ctx.sfx.success(); // 歓声がわり
            ctx.setHint(ctx.t({ en: 'Speed up!', ja: 'スピードアップ！', es: '¡Más rápido!', 'pt-BR': 'Acelerando!', fr: 'Accélération !', de: 'Schneller!', it: 'Velocità aumentata!', ko: '속도 업!', 'zh-Hans': '加速！', tr: 'Hız arttı!' }));
            stageColorIdx = (stageColorIdx + 1) % BG_COLORS.length;
            if (ctx.scene.background) ctx.scene.background.setHex(BG_COLORS[stageColorIdx]);
          } else if (doubleRev === 0 && count > 3) {
            if (!pendingPerfect && feverLeft <= 0 && ringT <= 0) ctx.setHint('');
          }
        } else {
          // ひっかかった
          state = 1; failT = 0;
          ctx.sfx.fail();
          ctx.vibrate(80);
          return;
        }
      }
    }
  });
})();
