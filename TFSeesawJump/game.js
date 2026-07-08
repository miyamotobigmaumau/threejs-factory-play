/* =========================================================================
 * TFSeesawJump — シーソーロケット
 * ルール: シーソーで2人がこうたいにジャンプ。おちてくる間にタップして
 *        着地しせいをとる。タイミングが良いほど次はもっと高くとぶ。
 * 操作: タイミングタップ（落下中・シーソーに近いほど高評価）
 * スコア: 最高高度 (m)。しせいをとりそこねる／いきおい不足で終了。
 * ========================================================================= */
(function () {
  'use strict';

  var chars = [], plank, marker;
  var clouds = [], airBalloons = [], dusts = [];
  var flyerIdx, vy, posed, poseQ, peakH, maxH, tiltTarget;
  var failing, overT, launches;

  var G = 9.8;
  var SEAT_X = 1.8;   // シーソー中心から すわる位置までの距離
  var WINDOW = 2.2;   // 着地しせいの判定まど(m)

  function sideOf(i) { return i === 0 ? -1 : 1; }
  // シーソー端（すわる位置）の高さ
  function endY(rotZ, side) { return 0.95 + Math.sin(rotZ) * side * SEAT_X + 0.12; }

  function makeChar(THREE, color, capColor) {
    var g = new THREE.Group();
    var mat = Style.mat(color);
    var skin = Style.mat(0xffe0b8);
    var capM = Style.mat(capColor);
    var body = new THREE.Mesh(Style.roundedBox(0.55, 0.6, 0.4), mat);
    body.position.y = 0.5;
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), skin);
    head.position.y = 1.05;
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.14, 12), capM);
    cap.position.y = 1.28;
    var legL = new THREE.Mesh(Style.roundedBox(0.16, 0.24, 0.16), mat);
    legL.position.set(-0.14, 0.1, 0);
    var legR = legL.clone();
    legR.position.x = 0.14;
    g.add(body, head, cap, legL, legR);
    // 顔（黒点目・こちら向き=+Z）
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    var eyeGeo = new THREE.SphereGeometry(0.045, 6, 5);
    var eL = new THREE.Mesh(eyeGeo, eyeMat);
    eL.position.set(-0.1, 1.08, 0.27);
    var eR = new THREE.Mesh(eyeGeo, eyeMat);
    eR.position.set(0.1, 1.08, 0.27);
    g.add(eL, eR);
    return g;
  }

  function makeTree(THREE, x, z, s) {
    var g = new THREE.Group();
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.2, 8),
      Style.mat(0x8a5a2b));
    trunk.position.y = 0.6;
    var leaf = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.2, 10),
      Style.mat(0x4caf50));
    leaf.position.y = 2.1;
    g.add(trunk, leaf);
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    return g;
  }

  Shell.registerGame({
    id: 'TFSeesawJump',
    title: { en: 'Seesaw Rocket', ja: 'シーソーロケット', es: 'Cohete Balancín', 'pt-BR': 'Foguete Gangorra', fr: 'Fusée Bascule', de: 'Wippen-Rakete', it: 'Razzo Altalena', ko: '시소 로켓', 'zh-Hans': '跷跷板火箭', tr: 'Tahterevalli Roketi' },
    howto: { en: 'Tap while falling to land!\nCloser to the seesaw = higher jump', ja: 'おちてくる間にタップで着地しせい！\nシーソーに近いほど 高くとべる', es: '¡Toca al caer para aterrizar!\nMás cerca del balancín = más alto', 'pt-BR': 'Toque ao cair para pousar!\nMais perto da gangorra = mais alto', fr: 'Touchez en tombant pour atterrir !\nPlus près de la bascule = plus haut', de: 'Tippe beim Fallen zur Landung!\nNäher am Wippen = höher springen', it: 'Tocca mentre cadi per atterrare!\nPiù vicino all\'altalena = più in alto', ko: '낙하 중 탭해서 착지！\n시소에 가까울수록 더 높이 날아요', 'zh-Hans': '下落时点击落地！\n越靠近跷跷板跳得越高', tr: 'Düşerken dokun ve in!\nTahterevalliye yakın = daha yüksek zıpla' },
    scoreLabel: 'm',
    bg: 0x9ad6f0,
    cameraFov: 65,
    cameraPos: [0, 4.2, 9.5],
    cameraLookAt: [0, 2.2, 0],

    init: function (ctx) {
      var THREE = ctx.THREE, i;

      // 公園の地面
      var ground = new THREE.Mesh(
        new THREE.CircleGeometry(80, 32),
        Style.mat(0x7ec850)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // 砂場
      var sand = new THREE.Mesh(
        new THREE.CylinderGeometry(3.4, 3.4, 0.1, 24),
        Style.mat(0xe8d9a0)
      );
      sand.position.y = 0.05;
      ctx.scene.add(sand);

      // 木
      ctx.scene.add(makeTree(THREE, -6, -6, 1.2));
      ctx.scene.add(makeTree(THREE, 6.5, -8, 1.5));
      ctx.scene.add(makeTree(THREE, -8, -12, 1.8));
      ctx.scene.add(makeTree(THREE, 9, -14, 1.4));

      // シーソー（支点 + 板）
      var fulcrum = new THREE.Mesh(
        new THREE.ConeGeometry(0.65, 0.95, 4),
        Style.mat(0xd35f3c)
      );
      fulcrum.position.y = 0.475;
      fulcrum.rotation.y = Math.PI / 4;
      ctx.scene.add(fulcrum);

      plank = new THREE.Mesh(
        Style.roundedBox(5, 0.16, 0.8),
        Style.mat(0x59a8e0)
      );
      plank.position.y = 0.95;
      ctx.scene.add(plank);

      // 2人のキャラ
      chars.push(makeChar(THREE, 0xef5350, 0xc62828)); // あか
      chars.push(makeChar(THREE, 0x42a5f5, 0x1565c0)); // あお
      ctx.scene.add(chars[0]);
      ctx.scene.add(chars[1]);

      // 判定まどマーカー
      marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.06, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffee58 })
      );
      marker.rotation.x = Math.PI / 2;
      marker.visible = false;
      ctx.scene.add(marker);

      // 雲（高度が上がると見えてくる）
      var cloudMat = Style.mat(0xffffff);
      for (i = 0; i < 18; i++) {
        var c = new THREE.Group();
        for (var j = 0; j < 3; j++) {
          var s = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random(), 8, 6), cloudMat);
          s.position.set(j * 1.8 - 1.8, Math.random() * 0.5, Math.random() * 0.6);
          c.add(s);
        }
        c.position.set(Math.random() * 40 - 20, 8 + Math.random() * 110, -10 - Math.random() * 14);
        ctx.scene.add(c);
        clouds.push(c);
      }

      // 気球
      var balloonCols = [0xff7043, 0xffca28, 0xab47bc];
      for (i = 0; i < 3; i++) {
        var b = new THREE.Group();
        var env = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10),
          Style.mat(balloonCols[i]));
        var basket = new THREE.Mesh(Style.roundedBox(0.7, 0.5, 0.7),
          Style.mat(0x8a5a2b));
        basket.position.y = -2.2;
        b.add(env, basket);
        b.position.set(i % 2 === 0 ? -7 : 8, 35 + i * 42, -13);
        b.userData.baseY = b.position.y;
        b.userData.ph = i * 2.1;
        ctx.scene.add(b);
        airBalloons.push(b);
      }

      // 着地の砂煙プール
      var dustGeo = new THREE.SphereGeometry(0.16, 6, 5);
      for (i = 0; i < 12; i++) {
        var dm = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: 0xf0e4c0, transparent: true, opacity: 0 }));
        dm.visible = false;
        ctx.scene.add(dm);
        dusts.push({ mesh: dm, vx: 0, vy: 0, vz: 0, life: 0 });
      }
    },

    _dust: function (x, y) {
      var n = 0;
      for (var i = 0; i < dusts.length && n < 6; i++) {
        if (dusts[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        dusts[i].life = 0.4;
        dusts[i].vx = Math.cos(a) * (1.4 + Math.random());
        dusts[i].vy = 0.8 + Math.random();
        dusts[i].vz = Math.sin(a) * 0.6;
        dusts[i].mesh.position.set(x, y, 0);
        dusts[i].mesh.material.opacity = 0.75;
        dusts[i].mesh.visible = true;
        n++;
      }
    },

    start: function (ctx) {
      flyerIdx = 0;
      posed = false; poseQ = 0;
      peakH = 5; maxH = 0;
      failing = false; overT = 0; launches = 0;
      vy = 0;
      tiltTarget = -0.22;           // 右が下がる → 左端が上（左キャラが落ちてくる先）
      plank.rotation.z = -0.22;
      chars[0].position.set(-SEAT_X, 5, 0);
      chars[0].rotation.set(0, 0, 0);
      chars[0].scale.set(1, 1, 1);
      chars[1].position.set(SEAT_X, endY(-0.22, 1), 0);
      chars[1].rotation.set(0, 0, 0);
      chars[1].scale.set(1, 1, 1);
      marker.visible = false;
      ctx.camera.position.set(0, 4.2, 9.5);
      ctx.camera.lookAt(0, 2.2, 0);
      ctx.setHint(ctx.t({ en: 'Tap while falling!', ja: 'おちてくる間にタップ！', es: '¡Toca al caer!', 'pt-BR': 'Toque ao cair!', fr: 'Touchez en tombant !', de: 'Tippe beim Fallen!', it: 'Tocca mentre cadi!', ko: '낙하 중 탭하세요!', 'zh-Hans': '下落时点击！', tr: 'Düşerken dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (failing) return;
      if (vy < 0 && !posed) {
        var f = chars[flyerIdx];
        var d = f.position.y - endY(plank.rotation.z, sideOf(flyerIdx));
        poseQ = d <= WINDOW ? Math.max(0.08, 1 - d / WINDOW) : 0; // 早すぎは0
        posed = true;
        f.rotation.z = 0;
        f.scale.y = 0.75; // しゃがみ姿勢
        ctx.sfx.tap();
      }
    },

    update: function (ctx, dt) {
      var i, t = ctx.elapsed;

      // 雲と気球
      for (i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * 0.6;
        if (clouds[i].position.x > 24) clouds[i].position.x = -24;
      }
      for (i = 0; i < airBalloons.length; i++) {
        var ab = airBalloons[i];
        ab.position.y = ab.userData.baseY + Math.sin(t * 0.7 + ab.userData.ph) * 0.6;
      }

      // 砂煙の更新
      for (i = 0; i < dusts.length; i++) {
        var du = dusts[i];
        if (du.life <= 0) continue;
        du.life -= dt;
        du.mesh.position.x += du.vx * dt;
        du.mesh.position.y += du.vy * dt;
        du.mesh.position.z += du.vz * dt;
        du.vy -= 3 * dt;
        du.mesh.material.opacity = Math.max(0, du.life / 0.4) * 0.75;
        if (du.life <= 0) du.mesh.visible = false;
      }

      // シーソーの傾きを目標へ
      plank.rotation.z += (tiltTarget - plank.rotation.z) * Math.min(1, dt * 10);

      // すわっている側を板の上に
      var sIdx = 1 - flyerIdx;
      chars[sIdx].position.y = endY(plank.rotation.z, sideOf(sIdx));

      var f = chars[flyerIdx];
      var fSide = sideOf(flyerIdx);

      // 失敗演出 → ゲームオーバー
      if (failing) {
        f.rotation.z += dt * 6;
        f.position.y = Math.max(0.4, f.position.y - dt * 5);
        f.position.x += fSide * dt * 2;
        overT += dt;
        if (overT > 1.0) ctx.gameOver(maxH);
        return;
      }

      // 飛行（放物運動）
      f.position.y += vy * dt;
      vy -= G * dt;
      if (f.position.y > maxH) { maxH = f.position.y; ctx.setScore(maxH); }
      if (!posed) f.rotation.z += dt * 5; // しせい未確定はくるくる回転

      var ey = endY(plank.rotation.z, fSide);
      var d = f.position.y - ey;

      // 判定まどマーカー
      marker.visible = vy < 0 && d > 0 && d < WINDOW && !posed;
      marker.position.set(fSide * SEAT_X, ey + 0.06, 0);

      // 着地判定
      if (vy < 0 && f.position.y <= ey) {
        f.position.y = ey;
        f.rotation.z = 0;
        f.scale.y = 1;
        marker.visible = false;
        this._dust(fSide * SEAT_X, ey - 0.2);
        if (!posed) {
          // しせいをとれず → 端からころげ落ちて終了
          failing = true; overT = 0;
          ctx.sfx.fail(); ctx.vibrate(60);
          ctx.setHint(ctx.t({ en: 'Missed the landing…', ja: 'しせいをとれなかった…', es: 'Aterrizaje fallido…', 'pt-BR': 'Pouso perdido…', fr: 'Atterrissage raté…', de: 'Landung verpasst…', it: 'Atterraggio mancato…', ko: '착지 실패…', 'zh-Hans': '落地失败…', tr: 'İniş kaçırıldı…' }));
        } else {
          var q = poseQ;
          var nextH = peakH * (0.7 + 0.6 * q) + 1.6 * q;
          if (nextH < 2.4) {
            // いきおい不足 → 相手がはねられず落下
            failing = true; overT = 0;
            flyerIdx = sIdx; // よわく飛ばされた相手側が落ちる演出
            ctx.sfx.fail(); ctx.vibrate(60);
            ctx.setHint(ctx.t({ en: 'Not enough power…', ja: 'いきおいがたりない…', es: 'Sin fuerza suficiente…', 'pt-BR': 'Força insuficiente…', fr: 'Pas assez de force…', de: 'Nicht genug Kraft…', it: 'Forza insufficiente…', ko: '힘이 부족해…', 'zh-Hans': '力量不足…', tr: 'Yeterli güç yok…' }));
          } else {
            // 交代して打ち上げ！
            tiltTarget = -0.22 * fSide; // 着地した側が下がる
            flyerIdx = sIdx;
            vy = Math.sqrt(2 * G * Math.max(0.5, nextH - 1));
            peakH = nextH;
            posed = false; poseQ = 0;
            launches++;
            if (q > 0.75) { ctx.sfx.score(); ctx.setHint(ctx.t({ en: 'Perfect! 🎉', ja: 'ナイス！', es: '¡Perfecto! 🎉', 'pt-BR': 'Perfeito! 🎉', fr: 'Parfait ! 🎉', de: 'Perfekt! 🎉', it: 'Perfetto! 🎉', ko: '완벽! 🎉', 'zh-Hans': '完美！🎉', tr: 'Mükemmel! 🎉' })); }
            else if (q > 0.4) { ctx.sfx.bounce(); ctx.setHint(ctx.t({ en: 'Nice!', ja: 'いいね！', es: '¡Bien!', 'pt-BR': 'Boa!', fr: 'Bien !', de: 'Gut!', it: 'Bene!', ko: '좋아!', 'zh-Hans': '不错！', tr: 'İyi!' })); }
            else { ctx.sfx.bounce(); ctx.setHint(ctx.t({ en: 'Too shallow…', ja: 'あさい…', es: 'Muy débil…', 'pt-BR': 'Muito fraco…', fr: 'Trop faible…', de: 'Zu schwach…', it: 'Troppo debole…', ko: '얕아…', 'zh-Hans': '太浅了…', tr: 'Çok zayıf…' })); }
            ctx.vibrate(15);
          }
        }
      }

      // カメラ追従（高いほど引き）
      var fy = chars[flyerIdx].position.y;
      ctx.camera.position.set(0, Math.max(4.2, fy * 0.8 + 1.2), 9.5 + fy * 0.25);
      ctx.camera.lookAt(0, Math.max(2.2, fy * 0.75), 0);
    }
  });
})();
