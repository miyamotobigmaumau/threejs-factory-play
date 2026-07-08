/* =========================================================================
 * TFPencilBalance — えんぴつバランス
 * ルール: 指先の上に立てた鉛筆（倒立振子）を倒さずキープ。
 *        時間とともに風の外乱が強くなる。45°をこえたら落下で終了。
 * 操作: 倒れそうな側へ左右ドラッグして支点（指）を動かす。
 * スコア: 生存秒 (びょう) / コンティニュー可
 * ========================================================================= */
(function () {
  'use strict';

  var G = 10;                 // 有効重力（ゲームとしての倒れやすさ）
  var L = 2.6;                // 振子の有効長
  var FAIL_ANG = Math.PI / 4; // 45°で落下
  var TIP_Y = 2.05;           // 指先の高さ（鉛筆の支点）

  var pencil, finger;
  var theta, omega;           // 振子角度・角速度（zまわり）
  var fx, fxVel, targetFx;    // 指のx位置・速度・目標
  var aliveTime, graceT;
  var falling, fallT;
  var gustT, gustDir, nextGust;
  // ビジュアルディテール
  var fingerShadow, windLines = [], clockHandM, clockHandH;
  var pulseRing, pulseT = -1, nextMilestone, flashDiv;

  Shell.registerGame({
    id: 'TFPencilBalance',
    title: { en: 'Pencil Balance', ja: 'えんぴつバランス', es: 'Equilibrio de lápiz', 'pt-BR': 'Equilíbrio do lápis', fr: 'Équilibre du crayon', de: 'Bleistift-Balance', it: 'Equilibrio matita', ko: '연필 균형', 'zh-Hans': '铅笔平衡', tr: 'Kalem Dengesi' },
    howto: { en: 'Drag toward the falling side!\nKeep the pencil on your fingertip', ja: 'たおれそうなほうへドラッグ！\nゆびのうえのえんぴつをキープしよう', es: '¡Arrastra hacia el lado que cae!\nMantén el lápiz sobre tu dedo', 'pt-BR': 'Arraste para o lado que cai!\nMantenha o lápis na ponta do dedo', fr: 'Glissez vers le côté qui tombe !\nGardez le crayon sur votre doigt', de: 'Ziehe zur fallenden Seite!\nHalte den Bleistift auf deiner Fingerspitze', it: 'Trascina verso il lato che cade!\nTieni la matita sulla punta del dito', ko: '넘어지는 쪽으로 드래그!\n손가락 위의 연필을 유지해보세요', 'zh-Hans': '向倾倒方向拖动！\n保持铅笔在指尖上', tr: 'Düşen tarafa doğru sürükle!\nKalem parmak ucunda kalsın' },
    scoreLabel: { en: 'sec', ja: 'びょう', es: 'seg', 'pt-BR': 'seg', fr: 'sec', de: 'Sek', it: 'sec', ko: '초', 'zh-Hans': '秒', tr: 'sn' },
    bg: 0xfdf3dd,
    cameraFov: 55,
    cameraPos: [0, 3.4, 8],
    cameraLookAt: [0, 3.2, 0],
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 勉強机の天板（ノートの罫線テクスチャ）
      var cv = document.createElement('canvas');
      cv.width = 256; cv.height = 256;
      var c2 = cv.getContext('2d');
      c2.fillStyle = '#fffdf4'; c2.fillRect(0, 0, 256, 256);
      c2.strokeStyle = '#b9d4ee'; c2.lineWidth = 2;
      for (var yy = 20; yy < 256; yy += 26) {
        c2.beginPath(); c2.moveTo(0, yy); c2.lineTo(256, yy); c2.stroke();
      }
      c2.strokeStyle = '#f0a0a0';
      c2.beginPath(); c2.moveTo(30, 0); c2.lineTo(30, 256); c2.stroke();
      var deskTop = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 20),
        new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) })
      );
      deskTop.rotation.x = -Math.PI / 2;
      deskTop.position.set(0, -1.2, -4);
      ctx.scene.add(deskTop);

      // 奥の壁
      var wall = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        Style.mat(0xf6e3c0)
      );
      wall.position.set(0, 10, -14);
      ctx.scene.add(wall);

      // 小道具: 本（当たり無し）
      var book = new THREE.Mesh(
        Style.roundedBox(2.4, 0.5, 3.2),
        Style.mat(0x6fa8dc)
      );
      book.position.set(-4.5, -0.95, -3);
      book.rotation.y = 0.3;
      ctx.scene.add(book);
      var book2 = new THREE.Mesh(Style.roundedBox(2.2, 0.4, 3.0), Style.mat(0xd98a6a));
      book2.position.set(-4.4, -0.5, -3.1);
      book2.rotation.y = 0.45;
      ctx.scene.add(book2);

      // 壁の窓（青空+雲 → 画面に寒色を足してコントラスト確保）
      var win = new THREE.Group();
      var sky2 = new THREE.Mesh(new THREE.PlaneGeometry(7, 5.4),
        new THREE.MeshBasicMaterial({ color: 0x8ec9ea }));
      win.add(sky2);
      var cloudMat2 = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (var ci = 0; ci < 2; ci++) {
        var cl = new THREE.Group();
        for (var cj = 0; cj < 3; cj++) {
          var puff = new THREE.Mesh(new THREE.CircleGeometry(0.45 + Math.random() * 0.25, 10), cloudMat2);
          puff.position.set(cj * 0.6 - 0.6, Math.random() * 0.2, 0.01);
          cl.add(puff);
        }
        cl.position.set(ci === 0 ? -1.6 : 1.8, ci === 0 ? 1.2 : -0.6, 0.02);
        win.add(cl);
      }
      var frameMat = Style.mat(0xa9825c);
      var fH = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.28, 0.14), frameMat);
      var fH2 = fH.clone(); fH.position.y = 2.75; fH2.position.y = -2.75;
      var fV = new THREE.Mesh(new THREE.BoxGeometry(0.28, 5.8, 0.14), frameMat);
      var fV2 = fV.clone(); fV.position.x = -3.65; fV2.position.x = 3.65;
      var fC = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.4, 0.12), frameMat);
      var fC2 = new THREE.Mesh(new THREE.BoxGeometry(7, 0.16, 0.12), frameMat);
      win.add(fH, fH2, fV, fV2, fC, fC2);
      win.position.set(-6, 9, -13.9);
      ctx.scene.add(win);

      // 掛け時計（生存時間で針が回る = 舞台と因果のリンク）
      var clock = new THREE.Group();
      var face = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24),
        new THREE.MeshBasicMaterial({ color: 0xfffdf4 }));
      var rim = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.72, 24),
        new THREE.MeshBasicMaterial({ color: 0x8a6242 }));
      rim.position.z = 0.01;
      clockHandM = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1.2),
        new THREE.MeshBasicMaterial({ color: 0x445566 }));
      clockHandM.geometry.translate(0, 0.6, 0);
      clockHandM.position.z = 0.02;
      clockHandH = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.85),
        new THREE.MeshBasicMaterial({ color: 0x445566 }));
      clockHandH.geometry.translate(0, 0.42, 0);
      clockHandH.position.z = 0.02;
      clockHandH.rotation.z = -2.1;
      clock.add(face, rim, clockHandM, clockHandH);
      clock.position.set(5.5, 11, -13.9);
      ctx.scene.add(clock);

      // 机上プロップ: マグのペン立て（色鉛筆3本）＋りんご＋消しゴム
      var mug = new THREE.Group();
      var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.48, 1.0, 12), Style.mat(0x7f9ec9));
      cup.position.y = 0.5;
      mug.add(cup);
      var pcols = [0xc94f4f, 0x4f8ac9, 0x58a35b];
      for (var pi2 = 0; pi2 < 3; pi2++) {
        var pb = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 6), Style.mat(pcols[pi2]));
        pb.position.set((pi2 - 1) * 0.2, 1.2, (pi2 % 2) * 0.24 - 0.12);
        pb.rotation.z = (pi2 - 1) * 0.16;
        mug.add(pb);
      }
      mug.position.set(4.6, -1.2, -4);
      ctx.scene.add(mug);
      var apple = new THREE.Group();
      var abody = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), Style.mat(0xb84040));
      abody.position.y = 0.45; abody.scale.y = 0.9;
      var astem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 5), Style.mat(0x6b4a2f));
      astem.position.y = 0.95;
      var aleaf = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), Style.mat(0x58a35b));
      aleaf.scale.set(1.4, 0.5, 0.8); aleaf.position.set(0.16, 1.0, 0);
      apple.add(abody, astem, aleaf);
      apple.position.set(2.8, -1.2, -2.2);
      ctx.scene.add(apple);
      var eraser2 = new THREE.Mesh(Style.roundedBox(0.9, 0.35, 0.5, 0.08), Style.mat(0xd9dfe6));
      eraser2.position.set(-2.6, -1.02, -1.6);
      eraser2.rotation.y = -0.4;
      ctx.scene.add(eraser2);

      // 指の接地影（机の上、左右移動に追従 → 空間の把握が楽になる）
      fingerShadow = Style.softShadow(1.1);
      fingerShadow.position.set(0, -1.19, 0);
      ctx.scene.add(fingerShadow);

      // 風の可視化ライン（プール6本、突風時に流れる）
      for (var wi = 0; wi < 6; wi++) {
        var wl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.07),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        wl.visible = false;
        ctx.scene.add(wl);
        windLines.push(wl);
      }

      // マイルストーン金リング（10秒ごとのパルス、支点まわり）
      pulseRing = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.07, 8, 26),
        new THREE.MeshBasicMaterial({ color: 0xe8b423, transparent: true, opacity: 0, depthWrite: false }));
      pulseRing.visible = false;
      ctx.scene.add(pulseRing);

      // 失敗の赤フラッシュ（DOM）
      flashDiv = document.createElement('div');
      flashDiv.style.cssText = 'position:fixed;inset:0;background:#c62828;opacity:0;' +
        'pointer-events:none;z-index:10;transition:opacity .12s;';
      document.body.appendChild(flashDiv);

      // 指（腕＋指先） — 支点として左右に動く
      finger = new THREE.Group();
      var skin = Style.mat(0xf2c49b);
      var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 3, 10), skin);
      arm.position.y = -1.7;
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), skin);
      tip.position.y = -0.15;
      var nail = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 6),
        Style.mat(0xffe9e0)
      );
      nail.position.set(0, -0.08, 0.24);
      finger.add(arm, tip, nail);
      finger.position.set(0, TIP_Y, 0);
      ctx.scene.add(finger);

      // 鉛筆（支点=グループ原点が芯先。上へ: 芯→木→六角軸→金具→消しゴム）
      pencil = new THREE.Group();
      var lead = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.16, 6),
        Style.mat(0x333333)
      );
      lead.rotation.x = Math.PI; // 尖りを下へ
      lead.position.y = 0.08;
      var wood = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.42, 6),
        Style.mat(0xe8c49a)
      );
      wood.rotation.x = Math.PI;
      wood.position.y = 0.36;
      var body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 3.0, 6),
        Style.mat(0xf3c522)
      );
      body.position.y = 2.07;
      var band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.18, 10),
        Style.mat(0xb8c4cc)
      );
      band.position.y = 3.65;
      var eraser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.24, 10),
        Style.mat(0xf29aa5)
      );
      eraser.position.y = 3.85;
      pencil.add(lead, wood, body, band, eraser);
      pencil.position.set(0, TIP_Y + 0.15, 0);
      ctx.scene.add(pencil);
    },

    start: function (ctx) {
      theta = (ctx.random() - 0.5) * 0.06; // ほんの少し傾いた状態から
      omega = 0;
      fx = 0; fxVel = 0; targetFx = 0;
      aliveTime = 0; graceT = 2;   // 最初の2秒は風なし
      falling = false; fallT = 0;
      gustT = 0; gustDir = 1; nextGust = 4 + ctx.random() * 3;
      finger.position.x = 0;
      pencil.position.set(0, TIP_Y + 0.15, 0);
      pencil.rotation.set(0, 0, theta);
      nextMilestone = 10; pulseT = -1;
      pulseRing.visible = false;
      flashDiv.style.opacity = '0';
      fingerShadow.position.x = 0;
      for (var wi = 0; wi < windLines.length; wi++) windLines[wi].visible = false;
      ctx.setHint(ctx.t({ en: 'Drag toward the falling side!', ja: 'たおれそうなほうへドラッグ！', es: '¡Arrastra hacia el lado que cae!', 'pt-BR': 'Arraste para o lado que cai!', fr: 'Glissez vers le côté qui tombe !', de: 'Ziehe zur fallenden Seite!', it: 'Trascina verso il lato che cade!', ko: '넘어지는 쪽으로 드래그!', 'zh-Hans': '向倾倒方向拖动！', tr: 'Düşen tarafa doğru sürükle!' }));
    },

    // リワードコンティニュー: 記録秒を引き継ぎ、まっすぐ立て直して再開
    onContinue: function (ctx) {
      theta = 0; omega = 0;
      falling = false; fallT = 0;
      fxVel = 0; targetFx = fx;
      graceT = 1.5;
      pencil.rotation.set(0, 0, 0);
      pencil.position.set(fx, TIP_Y + 0.15, 0);
      ctx.setHint(ctx.t({ en: 'Back in action! 💪', ja: 'ふっかつ！', es: '¡Regresa! 💪', 'pt-BR': 'Voltou! 💪', fr: 'Retour au jeu ! 💪', de: 'Zurück! 💪', it: 'Di nuovo in gioco! 💪', ko: '부활! 💪', 'zh-Hans': '复活！💪', tr: 'Geri döndün! 💪' }));
    },

    onPointerMove: function (ctx, p) {
      if (falling) return;
      targetFx += p.dx * 0.014;
      if (targetFx > 3.4) targetFx = 3.4;
      if (targetFx < -3.4) targetFx = -3.4;
    },

    update: function (ctx, dt) {
      var wi, wl;
      if (falling) {
        // 落下演出: 支点から回転しながら落ちる → 終了
        fallT += dt;
        omega += (theta > 0 ? 9 : -9) * dt;
        theta += omega * dt;
        pencil.rotation.z = -theta;
        pencil.position.y = Math.max(0.4, TIP_Y + 0.15 - fallT * 3);
        flashDiv.style.opacity = String(Math.max(0, 0.28 - fallT * 0.5));
        for (wi = 0; wi < windLines.length; wi++) windLines[wi].visible = false;
        if (fallT > 0.7) ctx.gameOver(Math.round(aliveTime * 10) / 10);
        return;
      }

      aliveTime += dt;
      ctx.setScore(Math.floor(aliveTime * 10) / 10);
      if (graceT > 0) graceT -= dt;

      // 時計の針が生存時間で回る（1秒=6°の早回し）
      clockHandM.rotation.z = -aliveTime * 0.105;
      clockHandH.rotation.z = -2.1 - aliveTime * 0.0087;

      // 10秒ごとのマイルストーン: 金リングパルス＋効果音（記録更新の実感）
      if (aliveTime >= nextMilestone) {
        nextMilestone += 10;
        pulseT = 0;
        pulseRing.visible = true;
        pulseRing.position.set(fx, TIP_Y, 0.3);
        ctx.sfx.score();
        ctx.vibrate(20);
      }
      if (pulseT >= 0) {
        pulseT += dt;
        var pk = 1 + pulseT * 4;
        pulseRing.scale.set(pk, pk, pk);
        pulseRing.material.opacity = Math.max(0, 0.9 - pulseT * 1.8);
        if (pulseT > 0.5) { pulseT = -1; pulseRing.visible = false; }
      }

      // 指の動き（バネ＋減衰）→ 支点加速度を得る
      var prevVel = fxVel;
      fxVel += ((targetFx - fx) * 30 - fxVel * 8) * dt;
      fx += fxVel * dt;
      var ax = (fxVel - prevVel) / Math.max(dt, 0.001);
      if (ax > 60) ax = 60; if (ax < -60) ax = -60;

      // 風の外乱: ゆらぎ＋時間で強くなる突風
      var wind = 0;
      if (graceT <= 0) {
        var amp = 0.5 + aliveTime * 0.10;
        wind = (Math.sin(aliveTime * 0.9) + Math.sin(aliveTime * 2.3) * 0.5) * amp * 0.4;
        nextGust -= dt;
        if (nextGust <= 0) {
          gustT = 0.9;
          gustDir = ctx.random() < 0.5 ? -1 : 1;
          nextGust = 3 + ctx.random() * 4;
          ctx.setHint(gustDir > 0 ? ctx.t({ en: 'Wind →→', ja: 'かぜ →→', es: 'Viento →→', 'pt-BR': 'Vento →→', fr: 'Vent →→', de: 'Wind →→', it: 'Vento →→', ko: '바람 →→', 'zh-Hans': '风 →→', tr: 'Rüzgar →→' }) : ctx.t({ en: '←← Wind', ja: '←← かぜ', es: '←← Viento', 'pt-BR': '←← Vento', fr: '←← Vent', de: '←← Wind', it: '←← Vento', ko: '←← 바람', 'zh-Hans': '←← 风', tr: '←← Rüzgar' }));
        }
        if (gustT > 0) {
          gustT -= dt;
          wind += gustDir * amp * 1.6 * Math.sin((0.9 - gustT) / 0.9 * Math.PI);
          if (gustT <= 0) ctx.setHint('');
        }
      }

      // 倒立振子: θ'' = (g·sinθ − ax·cosθ + 風) / L
      omega += ((G * Math.sin(theta) - ax * Math.cos(theta)) / L + wind / L) * dt;
      omega *= (1 - 0.15 * dt); // 空気抵抗ぶんの減衰
      theta += omega * dt;

      // 反映（鉛筆は画面上、右に倒れる=+xでθ正 → rotation.zは負方向）
      finger.position.x = fx;
      pencil.position.x = fx;
      pencil.rotation.z = -theta;

      // 45°超えで落下開始
      if (Math.abs(theta) > FAIL_ANG) {
        falling = true; fallT = 0;
        ctx.sfx.fail();
        ctx.vibrate(80);
      }
    }
  });
})();
