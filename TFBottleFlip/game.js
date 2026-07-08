/* =========================================================================
 * TFBottleFlip — ボトルフリップ
 * ルール: 机の上のペットボトルを上スワイプで投げる。スワイプの長さが
 *        回転力（＝飛距離）。1回転以上して ±25° 以内の直立で
 *        テーブルに着地できたら成功。成功するたびテーブルが
 *        小さく・遠くなる。失敗で終了。
 * 操作: 上スワイプ（強さ）
 * スコア: 連続成功 (れんぞく)
 * ========================================================================= */
(function () {
  'use strict';

  var G = 9.8;
  var L = 2.6;        // 1回転ぶんの飛距離（物理を回転にロック）
  var HB = 0.62;      // ボトル半分の高さ
  var TY = 1.0;       // 机の天板の高さ
  var TILT = 0.4363;  // 25° (rad)

  var bottle;                      // ボトル（Group）
  var bottleShadow;                // ボトル追従の接地影
  var targetGrp, targetTop, legL, legR; // ターゲット机
  var confetti = [];               // 紙吹雪プール
  var dusts = [];                  // 土煙プール（失敗・着地）
  var state;                       // 'ready' | 'fly' | 'landed' | 'fail'
  var vx, vy, theta, landT, failT, failRestY, wobble0;
  var tableX, tableW, roundN;
  var swipeY = null;
  var camTX, camTY, camTZ, camLY;  // カメラ目標
  var powerBar, powerBarBg;        // スワイプ力ゲージ(DOM)

  function makePowerBarDom() {
    powerBarBg = document.createElement('div');
    powerBarBg.style.cssText = [
      'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);',
      'width:56vw;height:10px;background:rgba(0,0,0,.25);border-radius:5px;z-index:11;display:none;'
    ].join('');
    powerBar = document.createElement('div');
    powerBar.style.cssText = 'height:100%;width:0%;background:#42a5f5;border-radius:5px;transition:none;';
    powerBarBg.appendChild(powerBar);
    document.body.appendChild(powerBarBg);
  }

  function spawnDust(x, y) {
    for (var i = 0; i < dusts.length; i++) {
      var d = dusts[i];
      d.mesh.visible = true;
      d.life = 0.4 + Math.random() * 0.2;
      d.maxLife = d.life;
      d.mesh.position.set(x + (Math.random() - 0.5) * 0.4, y, (Math.random() - 0.5) * 0.4);
      d.mesh.scale.set(1, 1, 1);
      var ang = Math.random() * Math.PI * 2;
      d.vx = Math.cos(ang) * (1.0 + Math.random());
      d.vz = Math.sin(ang) * (1.0 + Math.random());
    }
  }

  // 脚つきの机を作る（board 幅は scale.x で可変）
  function makeDesk(scene, woodMat, legMat) {
    var grp = new THREE.Group();
    var top = new THREE.Mesh(Style.roundedBox(1, 0.12, 1.2), woodMat);
    top.position.y = TY - 0.06;
    grp.add(top);
    var legs = [];
    for (var i = 0; i < 2; i++) {
      var leg = new THREE.Mesh(Style.roundedBox(0.1, TY - 0.12, 1.0), legMat);
      leg.position.y = (TY - 0.12) / 2;
      grp.add(leg);
      legs.push(leg);
    }
    scene.add(grp);
    return { grp: grp, top: top, legs: legs };
  }

  // ラウンドに応じてターゲット机を配置（遠く・小さく）
  function setupRound(n) {
    tableW = Math.max(1.7 * Math.pow(0.85, n), 0.6);
    tableX = L * (n + 1);
    targetGrp.position.x = tableX;
    targetTop.scale.x = tableW;
    legL.position.x = -(tableW / 2 - 0.08);
    legR.position.x = (tableW / 2 - 0.08);

    // ボトルをスタート机へ戻す
    bottle.position.set(0, TY + HB, 0);
    bottle.rotation.set(0, 0, 0);
    theta = 0; vx = 0; vy = 0;
  }

  // カメラフレーミング: 発射机・着地机・軌道の頂点が常に1画面に収まるよう、
  // 縦持ち(狭い横FOV)でも横スパンが入る距離を、アスペクト比とFOVから逆算する。
  function frameCamera(ctx) {
    // 発射からの推定到達高さ（vx=0.55*vy, 飛距離≒1.1*vy^2/G=tableX → apex≒tableX/2.2）
    var apex = tableX / 2.2;
    var xMin = -1.15;                          // 発射机の左端
    var xMax = tableX + tableW / 2 + 0.7;      // 着地机の右端
    var yMax = TY + HB + apex + 0.7;           // 軌道の頂点＋余白
    var cx = (xMin + xMax) / 2;
    var cy = Math.max(1.3, yMax / 2);
    var halfW = (xMax - xMin) / 2;
    var halfH = yMax / 2;

    var vFov = (ctx.camera.fov || 60) * Math.PI / 180;
    var aspect = ctx.camera.aspect || (ctx.width && ctx.height ? ctx.width / ctx.height : 0.6);
    var tanV = Math.tan(vFov / 2);
    var tanH = tanV * aspect;                  // 横FOVの半角tan（縦持ちでは小さい）
    var dV = halfH / tanV;
    var dH = halfW / tanH;
    var D = Math.max(dV, dH) * 1.16 + 1.2;     // 横/縦の厳しい方＋マージン

    camTX = cx;
    camLY = cy;
    camTY = cy + D * 0.24;                      // ゆるく見下ろす
    camTZ = D;
  }

  // 紙吹雪をまき散らす
  function burstConfetti(x, y) {
    for (var i = 0; i < confetti.length; i++) {
      var c = confetti[i];
      c.mesh.visible = true;
      c.life = 0.9 + Math.random() * 0.5;
      c.mesh.position.set(x, y, (Math.random() - 0.5) * 0.5);
      c.vx = (Math.random() - 0.5) * 5;
      c.vy = 2.5 + Math.random() * 3.5;
      c.vz = (Math.random() - 0.5) * 3;
      c.spin = (Math.random() - 0.5) * 12;
      c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    }
  }

  Shell.registerGame({
    id: 'TFBottleFlip',
    title: { en: 'Bottle Flip', ja: 'ボトルフリップ', es: 'Lanzamiento de Botella', 'pt-BR': 'Giro de Garrafa', fr: 'Flip de Bouteille', de: 'Flaschen-Flip', it: 'Lancia la Bottiglia', ko: '보틀 플립', 'zh-Hans': '翻转瓶子', tr: 'Şişe Çevirme' },
    howto: { en: 'Swipe up to throw the bottle!\nSpin it and land it upright!', ja: 'うえにスワイプでボトルをなげる！\nくるっとまわして たてて ちゃくち', es: '¡Desliza hacia arriba para lanzar la botella!\n¡Gírala y aterrízala de pie!', 'pt-BR': 'Deslize para cima para lançar a garrafa!\nGire-a e pouse em pé!', fr: 'Glissez vers le haut pour lancer la bouteille !\nFaites-la tourner et posez-la debout !', de: 'Nach oben wischen um die Flasche zu werfen!\nDrehen und aufrecht landen!', it: 'Scorri in su per lanciare la bottiglia!\nFalla girare e atterra in piedi!', ko: '위로 스와이프해서 병을 던져라!\n빙글 돌려서 세워서 착지!', 'zh-Hans': '向上滑动投掷瓶子！\n旋转后直立落地！', tr: 'Şişeyi atmak için yukarı kaydır!\nDöndür ve dik indir!' },
    scoreLabel: { en: 'streak', ja: 'れんぞく', es: 'racha', 'pt-BR': 'seguidos', fr: 'série', de: 'Serie', it: 'fila', ko: '연속', 'zh-Hans': '连续', tr: 'seri' },
    bg: 0xfdf1dc,
    cameraFov: 60,
    cameraPos: [1.3, 2.8, 6.8],
    cameraLookAt: [1.3, 1.7, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 教室の床
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 30),
        Style.mat(0xc8a061)
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(15, 0, 0);
      ctx.scene.add(floor);

      // 教室の壁（進行方向に長く。カメラが右へ進んでも空白にならない）
      var wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 14), Style.mat(0xf2e4c8));
      wall.position.set(20, 7, -5.6);
      ctx.scene.add(wall);
      var molding = new THREE.Mesh(Style.roundedBox(90, 0.5, 0.12), Style.mat(0xc8a878));
      molding.position.set(20, 0.25, -5.45);
      ctx.scene.add(molding);

      // 黒板と壁飾り
      var board = new THREE.Mesh(
        Style.roundedBox(7, 3, 0.15),
        Style.mat(0x2e5d43)
      );
      board.position.set(5, 2.8, -5);
      ctx.scene.add(board);
      var frame = new THREE.Mesh(
        Style.roundedBox(7.4, 3.4, 0.1),
        Style.mat(0x8d6e4a)
      );
      frame.position.set(5, 2.8, -5.06);
      ctx.scene.add(frame);

      // 窓（外は空色）を進行方向に繰り返し配置
      [13, 21, 29, 37].forEach(function (wx) {
        var winFrame = new THREE.Mesh(Style.roundedBox(3.2, 2.6, 0.12), Style.mat(0xffffff));
        winFrame.position.set(wx, 3.2, -5.4);
        ctx.scene.add(winFrame);
        var winGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.2),
          new THREE.MeshBasicMaterial({ color: 0xa8dcf0 }));
        winGlass.position.set(wx, 3.2, -5.32);
        ctx.scene.add(winGlass);
        var winBarV = new THREE.Mesh(Style.roundedBox(0.1, 2.2, 0.06), Style.mat(0xffffff));
        winBarV.position.set(wx, 3.2, -5.3);
        ctx.scene.add(winBarV);
        var winBarH = new THREE.Mesh(Style.roundedBox(2.8, 0.1, 0.06), Style.mat(0xffffff));
        winBarH.position.set(wx, 3.2, -5.3);
        ctx.scene.add(winBarH);
      });

      // 掲示ポスターと時計（教室の物語）
      [[9.5, 0xf6c6d0], [17.5, 0xc7e9a8], [25.5, 0xffe9a8]].forEach(function (pp) {
        var poster = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6),
          new THREE.MeshBasicMaterial({ color: pp[1] }));
        poster.position.set(pp[0], 3.0, -5.35);
        poster.rotation.z = (Math.random() - 0.5) * 0.08;
        ctx.scene.add(poster);
      });
      var clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      clockFace.position.set(5, 5.2, -5.35);
      ctx.scene.add(clockFace);
      var clockRim = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 20),
        new THREE.MeshBasicMaterial({ color: 0x37474f }));
      clockRim.position.set(5, 5.2, -5.34);
      ctx.scene.add(clockRim);
      var handL = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.42),
        new THREE.MeshBasicMaterial({ color: 0x37474f }));
      handL.position.set(5, 5.35, -5.33);
      ctx.scene.add(handL);
      var handS = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x37474f }));
      handS.position.set(5.12, 5.25, -5.33);
      handS.rotation.z = -Math.PI / 3;
      ctx.scene.add(handS);

      // 机（スタート用とターゲット用）
      var woodMat = Style.mat(0xb5804d);
      var legMat = Style.mat(0x6d4c2f);
      var launch = makeDesk(ctx.scene, woodMat, legMat);
      launch.top.scale.x = 1.7;
      launch.legs[0].position.x = -0.77;
      launch.legs[1].position.x = 0.77;

      var t = makeDesk(ctx.scene, woodMat, legMat);
      targetGrp = t.grp; targetTop = t.top;
      legL = t.legs[0]; legR = t.legs[1];

      // ペットボトル（円柱の組み合わせ・r128 に Capsule は無い）
      bottle = new THREE.Group();
      var petMat = new THREE.MeshPhongMaterial({
        color: 0xcfe8ff, transparent: true, opacity: 0.45, shininess: 90
      });
      var waterMat = new THREE.MeshPhongMaterial({
        color: 0x4fc3f7, transparent: true, opacity: 0.65, shininess: 60
      });
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.8, 14), petMat);
      body.position.y = -0.2;
      var shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.26, 0.25, 14), petMat);
      shoulder.position.y = 0.325;
      var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 12), petMat);
      neck.position.y = 0.5;
      var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 12),
        Style.mat(0x1976d2));
      cap.position.y = 0.6;
      var water = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.3, 14), waterMat);
      water.position.y = -0.44;
      bottle.add(body, shoulder, neck, cap, water);
      ctx.scene.add(bottle);

      // 紙吹雪プール（マテリアル共有）
      var confGeo = new THREE.PlaneGeometry(0.16, 0.1);
      var confColors = [0xff5252, 0xffd54f, 0x4fc3f7, 0x81c784, 0xba68c8];
      var confMats = [];
      for (var m = 0; m < confColors.length; m++) {
        confMats.push(new THREE.MeshBasicMaterial({ color: confColors[m], side: THREE.DoubleSide }));
      }
      for (var i = 0; i < 36; i++) {
        var mesh = new THREE.Mesh(confGeo, confMats[i % confMats.length]);
        mesh.visible = false;
        ctx.scene.add(mesh);
        confetti.push({ mesh: mesh, life: 0, vx: 0, vy: 0, vz: 0, spin: 0 });
      }
    },

    start: function (ctx) {
      roundN = 0;
      state = 'ready';
      swipeY = null;
      landT = 0; failT = 0;
      for (var i = 0; i < confetti.length; i++) { confetti[i].life = 0; confetti[i].mesh.visible = false; }
      setupRound(0);
      frameCamera(ctx);
      ctx.camera.position.set(camTX, camTY, camTZ);
      ctx.camera.lookAt(camTX, camLY, 0);
      ctx.setHint(ctx.t({ en: 'Swipe up! Length = distance & spin', ja: 'うえにスワイプ！ながさで きょり＆かいてん', es: '¡Desliza arriba! Largo = distancia y giro', 'pt-BR': 'Deslize para cima! Comprimento = distância e giro', fr: 'Glissez en haut ! Longueur = distance & rotation', de: 'Nach oben wischen! Länge = Distanz & Drehung', it: 'Scorri in su! Lunghezza = distanza e giro', ko: '위로 스와이프! 길이 = 거리 & 회전', 'zh-Hans': '向上滑动！长度=距离和旋转', tr: 'Yukarı kaydır! Uzunluk = mesafe ve dönüş' }));
    },

    onPointerDown: function (ctx, p) {
      if (state === 'ready') swipeY = p.y;
    },

    onPointerUp: function (ctx, p) {
      if (state !== 'ready' || swipeY == null) return;
      var dy = swipeY - p.y; // 上向きスワイプ量(px)
      swipeY = null;
      if (dy < 30) return;
      vy = Math.min(3.0 + dy * 0.026, 14.5);
      vx = vy * 0.55;
      state = 'fly';
      ctx.setHint('');
      ctx.sfx.tap();
      ctx.vibrate(15);
    },

    update: function (ctx, dt) {
      // カメラフレーミングを毎フレーム再計算（リサイズにも追従）→ゆっくり目標へ
      frameCamera(ctx);
      var cam = ctx.camera;
      var k = Math.min(1, dt * 2.5);
      cam.position.x += (camTX - cam.position.x) * k;
      cam.position.y += (camTY - cam.position.y) * k;
      cam.position.z += (camTZ - cam.position.z) * k;
      cam.lookAt(camTX, camLY, 0);

      // 紙吹雪
      for (var i = 0; i < confetti.length; i++) {
        var c = confetti[i];
        if (c.life <= 0) continue;
        c.life -= dt;
        c.vy -= 6 * dt;
        c.mesh.position.x += c.vx * dt;
        c.mesh.position.y += c.vy * dt;
        c.mesh.position.z += c.vz * dt;
        c.mesh.rotation.x += c.spin * dt;
        c.mesh.rotation.y += c.spin * 0.6 * dt;
        if (c.life <= 0) c.mesh.visible = false;
      }

      if (state === 'fly') {
        bottle.position.x += vx * dt;
        bottle.position.y += vy * dt;
        vy -= G * dt;
        // 回転は飛距離にロック（L 進むごとに1回転）
        theta = Math.PI * 2 * bottle.position.x / L;
        bottle.rotation.z = -theta;

        if (vy < 0) {
          var x = bottle.position.x;
          var onTarget = x >= tableX - tableW / 2 - 0.08 && x <= tableX + tableW / 2 + 0.08;
          var onLaunch = x <= 0.9;
          if ((onTarget || onLaunch) && bottle.position.y <= TY + HB) {
            // 机に接地 → 角度判定
            var m = theta % (Math.PI * 2);
            var signed = (m < Math.PI) ? m : m - Math.PI * 2; // -180..180°
            // ±25°はクリーン成功。±40°まではおっとっと（ゆらゆら復帰）で救済
            if (onTarget && Math.abs(signed) <= 0.70 && theta >= Math.PI * 2 - 0.70) {
              // 成功！
              bottle.position.y = TY + HB;
              wobble0 = signed;
              bottle.rotation.z = -wobble0;
              state = 'landed'; landT = 0;
              ctx.addScore(1);
              burstConfetti(bottle.position.x, TY + HB + 0.6);
              if (Math.abs(signed) > TILT) ctx.setHint(ctx.t({ en: 'Wobbly…!', ja: 'おっとっと…！', es: '¡Inestable…!', 'pt-BR': 'Bambolê…!', fr: 'Chancelant… !', de: 'Wackelig…!', it: 'Barcollante…!', ko: '흔들흔들…!', 'zh-Hans': '摇摇晃晃…！', tr: 'Sallantılı…!' }));
              ctx.sfx.success();
              ctx.vibrate(40);
            } else {
              // 倒れた
              state = 'fail'; failT = 0;
              failRestY = TY + 0.28;
              ctx.sfx.fail();
              ctx.vibrate(60);
            }
          } else if (bottle.position.y <= HB * 0.5) {
            // 床に落ちた
            state = 'fail'; failT = 0;
            failRestY = 0.28;
            ctx.sfx.fail();
            ctx.vibrate(60);
          }
        }
      } else if (state === 'landed') {
        landT += dt;
        // ゆらゆらしながら直立へ
        bottle.rotation.z = -wobble0 * Math.cos(landT * 12) * Math.exp(-landT * 3.5);
        if (landT > 1.0) {
          roundN++;
          setupRound(roundN);
          state = 'ready';
          ctx.setHint(ctx.t({ en: 'Next: farther & smaller!', ja: 'つぎは とおく＆ちいさい！', es: '¡Siguiente: más lejos y pequeño!', 'pt-BR': 'Próximo: mais longe e menor!', fr: 'Suivant : plus loin et plus petit !', de: 'Nächste: weiter & kleiner!', it: 'Prossimo: più lontano e piccolo!', ko: '다음은 더 멀고 작아!', 'zh-Hans': '下一个：更远更小！', tr: 'Sıradaki: daha uzak ve küçük!' }));
        }
      } else if (state === 'fail') {
        // 倒れる演出 → 終了
        failT += dt;
        bottle.rotation.z -= 6 * dt;
        bottle.position.y += (failRestY - bottle.position.y) * Math.min(1, dt * 6);
        if (failT > 0.9) ctx.gameOver(ctx.score);
      }
    }
  });
})();
