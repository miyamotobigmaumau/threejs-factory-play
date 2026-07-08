/* =========================================================================
 * TFKendama — けんだま
 * ルール: 上フリックで玉が山なりに上がる。落ちてくる玉を、左右ドラッグで
 *        動かす皿の真上(±0.6)でキャッチできたら成功。連続で決めると
 *        コンボ音階が上がるが、玉の軌道はだんだん乱れる。
 *        3回落とすと終了。
 * 操作: 上フリック（投げ上げ）＋左右ドラッグ（皿の移動）
 * スコア: キャッチ精度の合計点 (てん)
 * ========================================================================= */
(function () {
  'use strict';

  var CAM_Z = 12, FOV = 60;
  var WORLD_H = 2 * Math.tan(FOV / 2 * Math.PI / 180) * CAM_Z; // 画面の縦幅(ワールド)
  var CUPY = -3.4;     // 皿の中心高さ
  var CATCHY = CUPY + 0.6; // キャッチ判定ライン
  var G = 16;          // 重力
  var BALL_R = 0.45;

  var cup, ball, strGeo;
  var confetti = [];
  var cupX, ballVX, ballVY, driftAX, state; // state: 'rest'|'fly'|'drop'
  var combo, drops, prevY, pulseT, catches, bigChance, bigThrow;
  var downX, downY, XMAX;

  // コンボ音階用の独自 WebAudio（アセット不要・生成音）
  var AC2 = null;
  function tone(freq) {
    if (!AC2) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) AC2 = new C();
    }
    if (!AC2) return;
    if (AC2.state === 'suspended') AC2.resume();
    var o = AC2.createOscillator(), g = AC2.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, AC2.currentTime);
    g.gain.setValueAtTime(0.15, AC2.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC2.currentTime + 0.28);
    o.connect(g); g.connect(AC2.destination);
    o.start(); o.stop(AC2.currentTime + 0.28);
  }

  function calcBounds(ctx) {
    var worldW = WORLD_H * ctx.width / ctx.height;
    XMAX = Math.max(1.6, worldW / 2 - 0.9);
  }

  function hearts(ctx, suffix) {
    var s = '';
    for (var i = 0; i < 3 - drops; i++) s += '♥';
    ctx.setHint(s + (suffix ? '　' + suffix : ''));
  }

  function restBall() {
    state = 'rest';
    ball.position.set(cupX, CUPY + 0.53, 0);
    ballVX = 0; ballVY = 0;
  }

  function burstConfetti(ctx, x, y) {
    var used = 0;
    for (var i = 0; i < confetti.length && used < 18; i++) {
      var p = confetti[i];
      if (p.life > 0) continue;
      p.mesh.position.set(x, y, 0.15);
      p.vx = (ctx.random() - 0.5) * 5;
      p.vy = 2 + ctx.random() * 4;
      p.vr = (ctx.random() - 0.5) * 12;
      p.life = 0.8;
      p.mesh.visible = true;
      used++;
    }
  }

  Shell.registerGame({
    id: 'TFKendama',
    title: { en: 'Kendama', ja: 'けんだま', es: 'Kendama', 'pt-BR': 'Kendama', fr: 'Kendama', de: 'Kendama', it: 'Kendama', ko: '켄다마', 'zh-Hans': '剑玉', tr: 'Kendama' },
    howto: { en: 'Flick up to toss the ball\nCenter catch scores higher!\nEvery 5 catches: Big Chance!', ja: 'うえにフリックで たまを あげる\nまんなかほど たかいてん！\n5かいごとに おおわざチャンス！', es: 'Desliza arriba para lanzar\n¡Centro da más puntos!\n¡Cada 5 atrapes: Gran Oportunidad!', 'pt-BR': 'Deslize para cima para jogar\nCentro dá mais pontos!\nA cada 5 pegas: Grande Chance!', fr: 'Glissez vers le haut pour lancer\nLe centre rapporte plus de points !\nToutes les 5 prises : Grande Chance !', de: 'Wische nach oben zum Werfen\nMitte gibt mehr Punkte!\nAlle 5 Fänge: Große Chance!', it: 'Scorri su per lanciare\nIl centro dà più punti!\nOgni 5 prese: Grande Chance!', ko: '위로 스와이프해서 공을 던지세요\n중앙 캐치가 높은 점수!\n5번마다 빅 찬스!', 'zh-Hans': '向上滑动抛球\n中心接球得分更高！\n每5次接球：大机会！', tr: 'Topu atmak için yukarı kaydır\nMerkez daha yüksek puan verir!\nHer 5 yakalamada: Büyük Şans!' },
    scoreLabel: { en: 'pts', ja: 'てん', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pts', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0xf6e2c0,
    cameraFov: FOV,
    cameraPos: [0, 0, CAM_Z],
    cameraLookAt: [0, 0, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 奥の壁（障子ふう：淡い和紙色＋木枠の格子）
      var wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), Style.mat(0xefe6d0));
      wall.position.set(0, 0, -3.5);
      ctx.scene.add(wall);
      var frameMat = Style.mat(0x7a5535);
      // 縦框
      for (var fx = -2; fx <= 2; fx++) {
        var vf = new THREE.Mesh(Style.roundedBox(0.16, 12, 0.1), frameMat);
        vf.position.set(fx * 3.2, 0, -3.35);
        ctx.scene.add(vf);
      }
      // 横框
      for (var fy = -1; fy <= 2; fy++) {
        var hf = new THREE.Mesh(Style.roundedBox(14, 0.16, 0.1), frameMat);
        hf.position.set(0, fy * 2.6, -3.35);
        ctx.scene.add(hf);
      }
      // 丸うちわ（壁のアクセント）
      var uchiwa = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), Style.mat(0xd94f4f));
      uchiwa.position.set(4.6, 2.2, -3.3);
      ctx.scene.add(uchiwa);
      var uchiwaHandle = new THREE.Mesh(Style.roundedBox(0.12, 1.1, 0.06), Style.mat(0xc9a06a));
      uchiwaHandle.position.set(4.6, 0.9, -3.3);
      ctx.scene.add(uchiwaHandle);

      // 床板（木目調の暖色）
      var shelf = new THREE.Mesh(
        Style.roundedBox(24, 0.5, 3),
        Style.mat(0xa9743f)
      );
      shelf.position.set(0, -5.6, -0.5);
      ctx.scene.add(shelf);
      // 棚に並ぶこけし列（色・大きさを散らして賑やかに）
      var kokeCols = [0xcf8a5b, 0xd94f4f, 0x3a7ca5, 0xe0a838, 0x8a6aa8];
      var kokeX = [-5.4, -4.3, 4.0, 5.0, 6.0];
      for (var kk = 0; kk < kokeX.length; kk++) {
        var sc = 0.7 + (kk % 3) * 0.18;
        var kmat = Style.mat(kokeCols[kk]);
        var kb = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * sc, 0.4 * sc, 1.4 * sc, 12), kmat);
        kb.position.set(kokeX[kk], -4.7 + 0.7 * sc, -1.4);
        ctx.scene.add(kb);
        var kh = new THREE.Mesh(new THREE.SphereGeometry(0.34 * sc, 12, 10), kmat);
        kh.position.set(kokeX[kk], -4.7 + 1.4 * sc + 0.1, -1.4);
        ctx.scene.add(kh);
        // こけしの顔（黒点目）
        var kEye = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        var keL = new THREE.Mesh(new THREE.SphereGeometry(0.04 * sc, 5, 4), kEye);
        keL.position.set(kokeX[kk] - 0.1 * sc, -4.7 + 1.4 * sc + 0.12, -1.1 + 0.03);
        ctx.scene.add(keL);
        var keR = new THREE.Mesh(new THREE.SphereGeometry(0.04 * sc, 5, 4), kEye);
        keR.position.set(kokeX[kk] + 0.1 * sc, -4.7 + 1.4 * sc + 0.12, -1.1 + 0.03);
        ctx.scene.add(keR);
      }

      // けん玉の皿（木の器＋持ち手）
      cup = new THREE.Group();
      var woodMat = new THREE.MeshLambertMaterial({ color: 0xb5804d, side: THREE.DoubleSide });
      var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.45, 0.7, 18, 1, true), woodMat);
      cup.add(bowl);
      var bottom = new THREE.Mesh(new THREE.CircleGeometry(0.45, 18), woodMat);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = -0.34;
      cup.add(bottom);
      var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.0, 12),
        Style.mat(0x8a5a30));
      stem.position.y = -0.85;
      cup.add(stem);
      var knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10),
        Style.mat(0x8a5a30));
      knob.position.y = -1.4;
      cup.add(knob);
      cup.position.set(0, CUPY, 0);
      ctx.scene.add(cup);

      // 玉（赤いけん玉ボール）
      ball = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_R, 18, 14),
        new THREE.MeshPhongMaterial({ color: 0xd32f2f, shininess: 70, specular: 0xffbbbb })
      );
      ctx.scene.add(ball);

      // 糸（毎フレーム座標だけ更新）
      strGeo = new THREE.BufferGeometry();
      strGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      var strLine = new THREE.Line(strGeo, new THREE.LineBasicMaterial({ color: 0x8a6a3c }));
      ctx.scene.add(strLine);

      var partGeo = Style.roundedBox(0.12, 0.05, 0.02);
      var partMats = [Style.mat(0xff5252), Style.mat(0xffeb3b), Style.mat(0x40c4ff), Style.mat(0x69f0ae)];
      for (var pi = 0; pi < 24; pi++) {
        var pm = new THREE.Mesh(partGeo, partMats[pi % partMats.length]);
        pm.visible = false;
        ctx.scene.add(pm);
        confetti.push({ mesh: pm, vx: 0, vy: 0, vr: 0, life: 0 });
      }
    },

    start: function (ctx) {
      combo = 0;
      drops = 0;
      catches = 0;
      bigChance = false;
      bigThrow = false;
      cupX = 0;
      driftAX = 0;
      pulseT = 0;
      downX = 0; downY = 0;
      cup.position.set(0, CUPY, 0);
      cup.scale.set(1, 1, 1);
      calcBounds(ctx);
      restBall();
      prevY = ball.position.y;
      ctx.setScore(0);
      for (var i = 0; i < confetti.length; i++) {
        confetti[i].life = 0;
        confetti[i].mesh.visible = false;
      }
      hearts(ctx, ctx.t({ en: 'Flick up!', ja: 'うえにフリック！', es: '¡Desliza arriba!', 'pt-BR': 'Deslize para cima!', fr: 'Glissez vers le haut !', de: 'Nach oben wischen!', it: 'Scorri su!', ko: '위로 스와이프!', 'zh-Hans': '向上滑动！', tr: 'Yukarı kaydır!' }));
    },

    onResize: function (ctx) {
      calcBounds(ctx);
    },

    onPointerDown: function (ctx, p) {
      downX = p.x; downY = p.y;
    },

    onPointerMove: function (ctx, p) {
      // 左右ドラッグで皿を移動
      cupX += p.dx * (WORLD_H / ctx.height);
      if (cupX > XMAX) cupX = XMAX;
      if (cupX < -XMAX) cupX = -XMAX;
    },

    onPointerUp: function (ctx, p) {
      if (state !== 'rest') return;
      var dy = downY - p.y;
      var dx = Math.abs(p.x - downX);
      if (dy > 50 && dy > dx) {
        // 投げ上げ！コンボが上がるほど軌道が乱れる
        bigThrow = bigChance;
        bigChance = false;
        ballVY = Math.min(6 + (dy / ctx.height) * 20, 16) * (bigThrow ? 1.4 : 1);
        var wob = Math.min(0.4 + combo * 0.22, 2.6);
        ballVX = (ctx.random() * 2 - 1) * wob;
        driftAX = (ctx.random() * 2 - 1) * Math.min(combo * 0.35, 3);
        state = 'fly';
        prevY = ball.position.y;
        ctx.sfx.tap();
        ctx.vibrate(15);
        hearts(ctx, bigThrow ? ctx.t({ en: 'Big Chance!', ja: 'おおわざチャンス！', es: '¡Gran Oportunidad!', 'pt-BR': 'Grande Chance!', fr: 'Grande Chance !', de: 'Große Chance!', it: 'Grande Chance!', ko: '빅 찬스!', 'zh-Hans': '大机会！', tr: 'Büyük Şans!' }) : '');
      }
    },

    update: function (ctx, dt) {
      cup.position.x = cupX;

      // キャッチ時のプルッと演出
      if (pulseT > 0) {
        pulseT -= dt;
        var s = 1 + Math.max(0, pulseT) * 0.5;
        cup.scale.set(s, 1, s);
        if (pulseT <= 0) cup.scale.set(1, 1, 1);
      }

      if (state === 'rest') {
        ball.position.x = cupX;
        ball.position.y = CUPY + 0.53;
      } else if (state === 'fly') {
        prevY = ball.position.y;
        ballVX += driftAX * dt;
        ballVY -= G * dt;
        ball.position.x += ballVX * dt;
        ball.position.y += ballVY * dt;
        ball.rotation.z -= ballVX * dt * 2;

        // 画面はしで軽くバウンド
        if (ball.position.x > XMAX + 0.5) { ball.position.x = XMAX + 0.5; ballVX = -Math.abs(ballVX) * 0.8; }
        if (ball.position.x < -XMAX - 0.5) { ball.position.x = -XMAX - 0.5; ballVX = Math.abs(ballVX) * 0.8; }

        // キャッチ判定（落下中に皿のラインを横切った瞬間）
        if (ballVY < 0 && prevY >= CATCHY && ball.position.y < CATCHY) {
          if (Math.abs(ball.position.x - cupX) <= 0.6) {
            var diff = Math.abs(ball.position.x - cupX);
            var zonePts = diff <= 0.2 ? 3 : (diff <= 0.45 ? 2 : 1);
            var label = diff <= 0.2 ? ctx.t({ en: 'Ken tip!', ja: 'けん先！', es: '¡Punta!', 'pt-BR': 'Ponta!', fr: 'Pointe !', de: 'Spitze!', it: 'Punta!', ko: '완벽!', 'zh-Hans': '剑尖！', tr: 'Uç!' }) : (diff <= 0.45 ? ctx.t({ en: 'Middle!', ja: '中皿！', es: '¡Centro!', 'pt-BR': 'Centro!', fr: 'Centre !', de: 'Mitte!', it: 'Centro!', ko: '중간!', 'zh-Hans': '中碗！', tr: 'Orta!' }) : ctx.t({ en: 'Big cup!', ja: '大皿！', es: '¡Grande!', 'pt-BR': 'Grande!', fr: 'Grande !', de: 'Groß!', it: 'Grande!', ko: '큰접시!', 'zh-Hans': '大碗！', tr: 'Büyük!' }));
            var pts = zonePts * (bigThrow ? 2 : 1);
            combo++;
            catches++;
            ctx.addScore(pts);
            pulseT = 0.35;
            tone(440 * Math.pow(1.0595, Math.min(combo, 24))); // コンボ音階
            ctx.vibrate(25);
            if (bigThrow) {
              burstConfetti(ctx, cupX, CATCHY);
              ctx.sfx.success();
            }
            if (catches % 5 === 0) bigChance = true;
            restBall();
            hearts(ctx, label + '+' + pts + (bigChance ? ' ' + ctx.t({ en: 'Next: Big Chance!', ja: 'つぎは おおわざ！', es: '¡Próximo: Gran Oportunidad!', 'pt-BR': 'Próximo: Grande Chance!', fr: 'Prochain : Grande Chance !', de: 'Nächste: Große Chance!', it: 'Prossima: Grande Chance!', ko: '다음: 빅 찬스!', 'zh-Hans': '下次：大机会！', tr: 'Sıradaki: Büyük Şans!' }) : ''));
          }
        }

        // 皿より下へ → 落とした
        if (state === 'fly' && ball.position.y < CUPY - 1.6) {
          drops++;
          combo = 0;
          bigThrow = false;
          ctx.sfx.fail();
          ctx.vibrate(60);
          if (drops >= 3) {
            ctx.gameOver(ctx.score);
          } else {
            state = 'drop';
            hearts(ctx, ctx.t({ en: (3 - drops) + ' drop(s) left', ja: 'あと' + (3 - drops) + 'かい おとせる', es: 'Fallos restantes: ' + (3 - drops), 'pt-BR': 'Quedas restantes: ' + (3 - drops), fr: (3 - drops) + ' chute(s) restante(s)', de: 'Noch ' + (3 - drops) + ' Mal(e)', it: 'Cadute rimaste: ' + (3 - drops), ko: '남은 실수: ' + (3 - drops), 'zh-Hans': '还剩 ' + (3 - drops) + ' 次', tr: 'Kalan hata: ' + (3 - drops) }));
          }
        }
      } else if (state === 'drop') {
        // 画面外まで落として仕切り直し
        ballVY -= G * dt;
        ball.position.y += ballVY * dt;
        if (ball.position.y < -WORLD_H / 2 - 2) {
          restBall();
          hearts(ctx, ctx.t({ en: 'Flick up!', ja: 'うえにフリック！', es: '¡Desliza arriba!', 'pt-BR': 'Deslize para cima!', fr: 'Glissez vers le haut !', de: 'Nach oben wischen!', it: 'Scorri su!', ko: '위로 스와이프!', 'zh-Hans': '向上滑动！', tr: 'Yukarı kaydır!' }));
        }
      }

      // 糸の更新
      var a = strGeo.attributes.position;
      a.setXYZ(0, cupX, CUPY + 0.1, 0.05);
      a.setXYZ(1, ball.position.x, ball.position.y, 0.05);
      a.needsUpdate = true;

      for (var cp = 0; cp < confetti.length; cp++) {
        var cf = confetti[cp];
        if (cf.life <= 0) continue;
        cf.life -= dt;
        cf.vy -= G * 0.7 * dt;
        cf.mesh.position.x += cf.vx * dt;
        cf.mesh.position.y += cf.vy * dt;
        cf.mesh.rotation.z += cf.vr * dt;
        if (cf.life <= 0 || cf.mesh.position.y < CUPY - 1) {
          cf.life = 0;
          cf.mesh.visible = false;
        }
      }
    }
  });
})();
