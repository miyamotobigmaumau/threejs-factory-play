/* =========================================================================
 * TFStoneSkip — みずきり
 * ルール: 石が水面に触れる直前にタップして跳ねさせる。
 * 操作: タイミングタップ。判定窓内なら跳ね、精度が良いほど勢いが残る。
 *       早すぎるタップはミス扱いで着水時に沈む。勢い切れでも沈む。
 * スコア: 跳ねた回数 (はね)
 * ========================================================================= */
(function () {
  'use strict';

  var stone, sun, sunPath, hills;
  var ripples = [];                 // 波紋プール {mesh, mat, t, active, big}
  var splashes = [];                // 水しぶき/泡プール {mesh, mat, vx, vy, g, life, maxLife, active}
  var stoneShadow;                  // 水面上の落下点マーカー（高度テレグラフ）
  var goldRing, goldT;              // Perfect時の金リング
  var thrower, throwT;              // 投げ手うさぎ（岸で見送る）
  var midProps = [];                // ループ配置のミッドプロップ（葦/浮き草/岩/波すじ）
  var clouds = [];
  var vx, vy, bounces, phase;       // phase: 0=飛行中 1=沈み演出 2=終了済み
  var armed, armQuality, missArmed, sinkT, failedMiss;

  var G = 9.8, WATER_Y = 0, CONTACT = 0.16, WINDOW = 0.24;
  var PROP_W = 30;                  // ミッドプロップのループ幅

  function spawnRipple(x, big) {
    for (var i = 0; i < ripples.length; i++) {
      if (!ripples[i].active) {
        var r = ripples[i];
        r.active = true; r.t = 0; r.big = big ? 1.9 : 1;
        r.mesh.visible = true;
        r.mesh.scale.set(0.4, 0.4, 1);
        r.mesh.position.set(x, WATER_Y + 0.02, 0);
        return;
      }
    }
  }

  Shell.registerGame({
    id: 'TFStoneSkip',
    title: { en: 'Stone Skip', ja: 'みずきり', es: 'Saltar Piedra', 'pt-BR': 'Pular Pedra', fr: 'Ricochet', de: 'Wasserstein', it: 'Rimbalzo', ko: '물수제비', 'zh-Hans': '打水漂', tr: 'Taş Sektirme' },
    howto: { en: 'Tap the moment the stone hits water!\nToo early and it sinks!', ja: '石が みなもに つく しゅんかんに タップ！\nはやすぎると しずんじゃう', es: '¡Toca justo cuando la piedra toca el agua!\n¡Muy pronto y se hunde!', 'pt-BR': 'Toque no momento em que a pedra toca a água!\nCedo demais e ela afunda!', fr: 'Touchez au moment où la pierre touche l\'eau!\nTrop tôt et elle coule!', de: 'Tippe genau wenn der Stein das Wasser berührt!\nZu früh und er sinkt!', it: 'Tocca nel momento in cui la pietra tocca l\'acqua!\nTroppo presto e affonda!', ko: '돌이 수면에 닿는 순간 탭!\n너무 빠르면 가라앉아!', 'zh-Hans': '石头触水瞬间点击！\n太早就沉了！', tr: 'Taş suya değen anda dokun!\nErken basarsan batar!' },
    scoreLabel: { en: 'skip', ja: 'はね', es: 'salto', 'pt-BR': 'pulo', fr: 'bond', de: 'Hüpfer', it: 'balzo', ko: '번', 'zh-Hans': '次', tr: 'sıçrama' },
    bg: 0xf09e63,
    cameraFov: 60,
    cameraPos: [3, 3.6, 13],
    cameraLookAt: [3, 1.1, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 石（平たい円盤ふうにつぶした球）
      stone = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 12, 8),
        Style.mat(0x8d99a6)
      );
      stone.scale.y = 0.45;
      ctx.scene.add(stone);

      // 川面（夕焼けの反射色）
      var water = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 90),
        Style.mat(0x46618c)
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(1900, WATER_Y, 0);
      ctx.scene.add(water);

      // 夕日と水面の光の帯（カメラに追従させる）
      sun = new THREE.Mesh(
        new THREE.SphereGeometry(6, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd97a })
      );
      sun.position.set(60, 13, -60);
      ctx.scene.add(sun);
      sunPath = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 120),
        new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.4 })
      );
      sunPath.rotation.x = -Math.PI / 2;
      sunPath.position.set(60, WATER_Y + 0.01, -25);
      ctx.scene.add(sunPath);

      // 対岸の山なみ（シルエット。カメラ位置に応じてループ配置）
      hills = new THREE.Group();
      var hillMat = new THREE.MeshBasicMaterial({ color: 0x6b4a6e });
      for (var i = 0; i < 30; i++) {
        var h = new THREE.Mesh(
          new THREE.ConeGeometry(12 + Math.random() * 10, 8 + Math.random() * 7, 4),
          hillMat
        );
        h.position.set(i * 24, 2, -48);
        hills.add(h);
      }
      ctx.scene.add(hills);

      // 波紋プール
      for (var j = 0; j < 10; j++) {
        var mat = new THREE.MeshBasicMaterial({
          color: 0xdfe9f5, transparent: true, opacity: 0.8, side: THREE.DoubleSide
        });
        var m = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 24), mat);
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        ctx.scene.add(m);
        ripples.push({ mesh: m, mat: mat, t: 0, active: false, big: 1 });
      }
    },

    start: function (ctx) {
      vx = 15; vy = 0.8; bounces = 0; phase = 0;
      armed = false; missArmed = false; armQuality = 0; sinkT = 0; failedMiss = false;
      stone.visible = true;
      stone.position.set(0, 3.4, 0);
      stone.rotation.set(0, 0, 0);
      for (var i = 0; i < ripples.length; i++) {
        ripples[i].active = false;
        ripples[i].mesh.visible = false;
      }
      ctx.setHint(ctx.t({ en: 'Tap right at the water surface!', ja: 'みなもギリギリで タップ！', es: '¡Toca justo en la superficie!', 'pt-BR': 'Toque bem na superfície!', fr: 'Touchez juste à la surface!', de: 'Genau an der Wasseroberfläche tippen!', it: 'Tocca proprio alla superficie!', ko: '수면 직전에 탭!', 'zh-Hans': '贴近水面时点击！', tr: 'Su yüzeyinde tam anda dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (phase !== 0 || armed || missArmed) return;
      if (vy > 0) return; // 上昇中のタップは無視（跳ねた直後の連打を許す）
      // 着水までの残り時間を弾道から予測
      var h = stone.position.y - WATER_Y - CONTACT;
      var tti = h <= 0 ? 0 : (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
      if (tti <= WINDOW) {
        armed = true;                       // 着水の瞬間に跳ねる
        armQuality = 1 - tti / WINDOW;      // ギリギリほど高精度
        ctx.sfx.tap();
      } else {
        missArmed = true;                   // 早すぎ → 着水で沈む
        ctx.setHint(ctx.t({ en: 'Too early!', ja: 'はやすぎ！', es: '¡Demasiado pronto!', 'pt-BR': 'Cedo demais!', fr: 'Trop tôt!', de: 'Zu früh!', it: 'Troppo presto!', ko: '너무 빠르다!', 'zh-Hans': '太早了！', tr: 'Çok erken!' }));
        ctx.vibrate(15);
      }
    },

    update: function (ctx, dt) {
      // 波紋の広がり
      for (var i = 0; i < ripples.length; i++) {
        var r = ripples[i];
        if (!r.active) continue;
        r.t += dt;
        if (r.t >= 1) { r.active = false; r.mesh.visible = false; continue; }
        var s = (0.4 + r.t * 3.2) * r.big;
        r.mesh.scale.set(s, s, 1);
        r.mat.opacity = 0.8 * (1 - r.t);
      }

      if (phase === 0) {
        vy -= G * dt;
        stone.position.x += vx * dt;
        stone.position.y += vy * dt;
        stone.rotation.z -= vx * dt * 0.9;
        if (missArmed) stone.rotation.x += dt * 6; // ぐらつき演出

        if (vy < 0 && stone.position.y <= WATER_Y + CONTACT) {
          if (armed && vx >= 2.5) {
            // 跳ねる！精度が良いほど勢いが残る
            bounces++;
            ctx.addScore(1);
            ctx.sfx.score();
            ctx.vibrate(15);
            spawnRipple(stone.position.x, false);
            stone.position.y = WATER_Y + CONTACT;
            vx = vx * (0.85 + 0.13 * armQuality) - 0.05;
            vy = Math.max((2.3 + Math.min(vx * 0.18, 3.0)) * (0.55 + 0.45 * armQuality), 1.6);
            armed = false;
            ctx.setHint(armQuality > 0.75 ? ctx.t({ en: 'Perfect!', ja: 'ナイス！', es: '¡Perfecto!', 'pt-BR': 'Perfeito!', fr: 'Parfait!', de: 'Perfekt!', it: 'Perfetto!', ko: '완벽!', 'zh-Hans': '完美！', tr: 'Mükemmel!' }) : '');
          } else {
            // 沈む（早すぎミス / ノータップ / 勢い切れ）
            failedMiss = (missArmed || !armed) && vx >= 2.5;
            phase = 1; sinkT = 0;
            spawnRipple(stone.position.x, true);
            ctx.sfx.bounce();
            ctx.vibrate(40);
            if (!failedMiss) ctx.setHint(ctx.t({ en: 'Out of speed…', ja: 'いきおいぎれ…', es: 'Sin velocidad…', 'pt-BR': 'Sem velocidade…', fr: 'À bout d\'élan…', de: 'Schwung weg…', it: 'Senza slancio…', ko: '속도 부족…', 'zh-Hans': '失速了…', tr: 'Hız bitti…' }));
          }
        }
      } else if (phase === 1) {
        // 沈み演出 → 結果へ
        vx = Math.max(vx - 8 * dt, 0);
        stone.position.x += vx * dt * 0.3;
        stone.position.y -= 1.4 * dt;
        stone.rotation.z -= dt * 2;
        sinkT += dt;
        if (stone.position.y < WATER_Y - 0.9) stone.visible = false;
        if (sinkT > 0.9) {
          phase = 2;
          if (failedMiss) ctx.gameOver(bounces);
          else ctx.endGame(bounces);
        }
      }

      // カメラと遠景の追従
      var cx = stone.position.x;
      ctx.camera.position.set(cx + 3, 3.6, 13);
      ctx.camera.lookAt(cx + 3, 1.1, 0);
      sun.position.x = cx + 60;
      sunPath.position.x = cx + 60;
      hills.position.x = Math.floor(cx / 24) * 24 - 340;
    }
  });
})();
