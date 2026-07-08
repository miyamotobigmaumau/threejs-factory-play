/* =========================================================================
 * TFWanage — わなげ
 * ルール: スワイプの方向と強さで輪を投げ、3本のポールをねらう。
 *        近100点・中300点・遠500点。10投の合計点で勝負。
 * 操作: スワイプ（上にはらうと遠くへ、左右で方向）
 * スコア: 合計点 (てん)
 * ========================================================================= */
(function () {
  'use strict';

  var G = 9.8, THROWS = 10;
  var STAKE_TOP = 1.05;         // 輪がポールに入る高さ
  var HAND = { x: 0, y: 1.1, z: 5.6 }; // かまえの位置

  var poles = [
    { x: -1.1, z: -3,  pts: 100, tol: 0.5 },
    { x: 0,    z: -7,  pts: 300, tol: 0.58 },
    { x: 1.1,  z: -11, pts: 500, tol: 0.66 },
    { x: -1.6, z: -8.8, pts: 500, tol: 0.56, bonus: true, baseX: -1.6 }
  ];
  var poleStacks = [0, 0, 0, 0], poleGroups = [], stars = [];

  var rings = [];
  var thrown, activeIdx, ringReady, readyT, endT, total, successStreak;
  var downX, downY, hasDown;
  var aimDots = [], aimCX, aimCY;   // ドラッグ中の軌道予測

  // スワイプ量 → 投擲速度（onPointerUp と軌道予測で共用）
  function throwVel(curX, curY) {
    var dy = downY - curY;
    return {
      vx: (curX - downX) * 0.013,
      vy: Math.min(7.5, 4.0 + dy * 0.008),
      vz: -Math.min(13, 4.5 + dy * 0.03),
      valid: dy >= 25
    };
  }

  function makeLabelTexture(THREE, text) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 64;
    var c = cv.getContext('2d');
    c.clearRect(0, 0, 128, 64);
    c.font = 'bold 34px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 6;
    c.strokeStyle = '#402010';
    c.strokeText(text, 64, 32);
    c.fillStyle = '#ffe082';
    c.fillText(text, 64, 32);
    return new THREE.CanvasTexture(cv);
  }

  function makeAwningTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    var c = cv.getContext('2d');
    for (var i = 0; i < 8; i++) {
      c.fillStyle = i % 2 === 0 ? '#c0392b' : '#f5eee2';
      c.fillRect(i * 32, 0, 32, 64);
    }
    return new THREE.CanvasTexture(cv);
  }

  function resetRing(rg) {
    rg.state = 'wait';
    rg.grp.visible = false;
    rg.grp.position.set(HAND.x, HAND.y, HAND.z);
    rg.grp.rotation.set(0, 0, 0);
    rg.vx = 0; rg.vy = 0; rg.vz = 0;
    rg.prevY = HAND.y;
    rg.tumbleT = 0;
  }

  function armRing(idx) {
    var rg = rings[idx];
    rg.state = 'hand';
    rg.grp.visible = true;
    rg.grp.position.set(HAND.x, HAND.y, HAND.z);
    rg.grp.rotation.set(0, 0, 0);
  }

  function burstStars(ctx, x, y, z) {
    var used = 0;
    for (var i = 0; i < stars.length && used < 10; i++) {
      var s = stars[i];
      if (s.life > 0) continue;
      s.mesh.position.set(x, y, z);
      s.vx = (ctx.random() - 0.5) * 3;
      s.vy = 2 + ctx.random() * 2;
      s.vz = (ctx.random() - 0.5) * 3;
      s.life = 0.7;
      s.mesh.visible = true;
      used++;
    }
  }

  Shell.registerGame({
    id: 'TFWanage',
    title: { en: 'Ring Toss', ja: 'わなげ', es: 'Lanzamiento de Aros', 'pt-BR': 'Argolinha', fr: 'Lancer d\'Anneaux', de: 'Ringwurf', it: 'Lancia l\'Anello', ko: '고리 던지기', 'zh-Hans': '套圈圈', tr: 'Halka Atma' },
    howto: { en: 'Drag to aim — dots show the arc!\nDead-center throws score ×1.5!\nThe golden pole moves — time it!', ja: 'ドラッグでねらう！点線が軌道だ\nど真ん中に通すと ×1.5！\nきんのポールは動く→タイミング！', es: '¡Arrastra para apuntar: los puntos son la trayectoria!\n¡Por el centro exacto ×1.5!\n¡El poste dorado se mueve!', 'pt-BR': 'Arraste para mirar — os pontos mostram o arco!\nNo centro exato ×1.5!\nO poste dourado se move!', fr: 'Glissez pour viser : les points montrent l\'arc !\nEn plein centre ×1,5 !\nLe poteau doré bouge !', de: 'Ziehen zum Zielen — Punkte zeigen die Flugbahn!\nGenau mittig ×1,5!\nDer Goldstab bewegt sich!', it: 'Trascina per mirare: i punti mostrano l\'arco!\nCentro perfetto ×1,5!\nIl palo dorato si muove!', ko: '드래그로 조준! 점선이 궤도\n정중앙 통과는 ×1.5!\n황금 기둥은 움직여→타이밍!', 'zh-Hans': '拖动瞄准——圆点显示弹道！\n正中央穿过×1.5！\n金色柱子会动，抓准时机！', tr: 'Sürükleyerek nişan al — noktalar yayı gösterir!\nTam ortadan geçir ×1,5!\nAltın direk hareket eder!' },
    scoreLabel: { en: 'pt', ja: 'てん', es: 'pt', 'pt-BR': 'pt', fr: 'pt', de: 'Pkt', it: 'pt', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0x1b2140,
    fogNear: 22, fogFar: 55,
    cameraFov: 60,
    cameraPos: [0, 3, 8.5],
    cameraLookAt: [0, 1.4, -5],

    init: function (ctx) {
      var THREE = ctx.THREE, i;

      // 夜のちょうちんの明かり
      var warm = new THREE.PointLight(0xffc27a, 0.9, 40);
      warm.position.set(0, 6, 2);
      ctx.scene.add(warm);

      // 地面（縁日の土）
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        Style.mat(0x4c4038)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // 屋台の紅白テント（背景）
      var awning = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 5),
        new THREE.MeshLambertMaterial({ map: makeAwningTexture(THREE) })
      );
      awning.position.set(0, 3.2, -15);
      ctx.scene.add(awning);

      // ちょうちんの列
      var lanternMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
      var stringMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      var lanternGeo = new THREE.SphereGeometry(0.28, 10, 8);
      for (var row = 0; row < 2; row++) {
        var zz = row === 0 ? 1.5 : -8;
        var yy = row === 0 ? 4.6 : 5.2;
        var str = new THREE.Mesh(Style.roundedBox(14, 0.03, 0.03), stringMat);
        str.position.set(0, yy, zz);
        ctx.scene.add(str);
        for (i = 0; i < 6; i++) {
          var ln = new THREE.Mesh(lanternGeo, lanternMat);
          ln.scale.set(1, 1.3, 1);
          ln.position.set(-5 + i * 2, yy - 0.35, zz);
          ctx.scene.add(ln);
        }
      }

      // ポール（近・中・遠）＋点数ふだ
      var stakeMat = Style.mat(0xd9a066);
      var goldStakeMat = new THREE.MeshPhongMaterial({ color: 0xffd54f, shininess: 90, specular: 0xffffff });
      var baseMat = Style.mat(0x6b4a2b);
      for (i = 0; i < poles.length; i++) {
        var pl = poles[i];
        var pg = new THREE.Group();
        var base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.14, 16), baseMat);
        base.position.set(0, 0.07, 0);
        pg.add(base);
        var stake = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 10), pl.bonus ? goldStakeMat : stakeMat);
        stake.position.set(0, 0.64, 0);
        pg.add(stake);
        var sign = new THREE.Mesh(
          new THREE.PlaneGeometry(1.1, 0.55),
          new THREE.MeshBasicMaterial({ map: makeLabelTexture(THREE, pl.pts + 'てん'), transparent: true })
        );
        sign.position.set(0, 1.7, 0);
        pg.add(sign);
        pg.position.set(pl.x, 0, pl.z);
        ctx.scene.add(pg);
        poleGroups.push(pg);
      }

      // 輪（10本・投げた輪はその場に残る）
      var ringGeo = new THREE.TorusGeometry(0.42, 0.08, 10, 24);
      var ringMats = [
        Style.mat(0xef5350),
        Style.mat(0x42a5f5),
        Style.mat(0xffca28)
      ];
      for (i = 0; i < THROWS; i++) {
        var grp = new THREE.Group();
        var mesh = new THREE.Mesh(ringGeo, ringMats[i % 3]);
        mesh.rotation.x = Math.PI / 2; // 水平（穴が上下）
        grp.add(mesh);
        grp.visible = false;
        ctx.scene.add(grp);
        rings.push({ grp: grp, state: 'wait', vx: 0, vy: 0, vz: 0, prevY: 0, dropY: 0, tumbleT: 0 });
      }

      var starGeo = new THREE.SphereGeometry(0.08, 6, 4);
      var starMat = new THREE.MeshBasicMaterial({ color: 0xfff176 });
      for (i = 0; i < 18; i++) {
        var sm = new THREE.Mesh(starGeo, starMat);
        sm.visible = false;
        ctx.scene.add(sm);
        stars.push({ mesh: sm, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      // 軌道予測ドット（ドラッグ中のみ表示）
      var dotGeo = new THREE.SphereGeometry(0.08, 8, 6);
      for (i = 0; i < 7; i++) {
        var dot = new THREE.Mesh(dotGeo,
          new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.85 - i * 0.09 }));
        dot.visible = false;
        ctx.scene.add(dot);
        aimDots.push(dot);
      }
    },

    start: function (ctx) {
      thrown = 0; activeIdx = 0; total = 0;
      successStreak = 0;
      ringReady = true; readyT = 0; endT = 0;
      hasDown = false;
      poleStacks[0] = poleStacks[1] = poleStacks[2] = poleStacks[3] = 0;
      for (var p = 0; p < poles.length; p++) {
        if (poles[p].bonus) poles[p].x = poles[p].baseX;
        poleGroups[p].position.x = poles[p].x;
      }
      for (var i = 0; i < THROWS; i++) resetRing(rings[i]);
      for (i = 0; i < stars.length; i++) {
        stars[i].life = 0;
        stars[i].mesh.visible = false;
      }
      armRing(0);
      ctx.setHint(ctx.t({ en: 'Swipe to throw! Rings left: ', ja: 'スワイプでなげる！ のこり ', es: '¡Desliza para lanzar! Quedan: ', 'pt-BR': 'Deslize para lançar! Restam: ', fr: 'Glissez pour lancer! Restants: ', de: 'Wischen zum Werfen! Noch: ', it: 'Scorri per lanciare! Rimangono: ', ko: '스와이프로 던지기! 남은 개수: ', 'zh-Hans': '滑动投圈！剩余: ', tr: 'Kaydırarak at! Kalan: ' }) + THROWS);
    },

    onPointerDown: function (ctx, p) {
      downX = p.x; downY = p.y;
      aimCX = p.x; aimCY = p.y;
      hasDown = true;
    },

    onPointerMove: function (ctx, p) {
      if (!hasDown) return;
      aimCX = p.x; aimCY = p.y;
    },

    onPointerUp: function (ctx, p) {
      for (var d = 0; d < aimDots.length; d++) aimDots[d].visible = false;
      if (!hasDown || !ringReady || thrown >= THROWS) { hasDown = false; return; }
      hasDown = false;
      var v = throwVel(p.x, p.y);
      if (!v.valid) return;
      var rg = rings[activeIdx];
      rg.state = 'fly';
      rg.vx = v.vx;
      rg.vy = v.vy;
      rg.vz = v.vz;
      rg.prevY = rg.grp.position.y;
      ringReady = false;
      ctx.sfx.tap();
      ctx.vibrate(15);
    },

    update: function (ctx, dt) {
      var i, t = ctx.elapsed;

      for (var pg = 0; pg < poles.length; pg++) {
        if (!poles[pg].bonus) continue;
        poles[pg].x = poles[pg].baseX + Math.sin(t * 0.85) * 0.85;
        poleGroups[pg].position.x = poles[pg].x;
      }

      // かまえ中の輪はふわふわ
      if (ringReady && thrown < THROWS) {
        rings[activeIdx].grp.position.y = HAND.y + Math.sin(t * 3) * 0.05;
      }

      // エイム中: 軌道予測ドット（スワイプの角度と強さが見える＝極め要素）
      if (hasDown && ringReady && thrown < THROWS) {
        var av = throwVel(aimCX, aimCY);
        for (var ad = 0; ad < aimDots.length; ad++) {
          var tt = 0.14 + ad * 0.14;
          var px2 = HAND.x + av.vx * tt;
          var py2 = HAND.y + av.vy * tt - 0.5 * G * tt * tt;
          var pz2 = HAND.z + av.vz * tt;
          aimDots[ad].position.set(px2, py2, pz2);
          aimDots[ad].visible = av.valid && py2 > 0;
        }
      }

      for (i = 0; i < THROWS; i++) {
        var rg = rings[i];
        if (rg.state === 'fly') {
          rg.prevY = rg.grp.position.y;
          rg.grp.position.x += rg.vx * dt;
          rg.grp.position.y += rg.vy * dt;
          rg.grp.position.z += rg.vz * dt;
          rg.vy -= G * dt;
          rg.grp.rotation.y += 10 * dt; // くるくる回転

          // ポールの高さを下向きに通過した瞬間に入ったか判定
          if (rg.vy < 0 && rg.prevY >= STAKE_TOP && rg.grp.position.y < STAKE_TOP) {
            for (var k = 0; k < poles.length; k++) {
              var pl = poles[k];
              var ddx = rg.grp.position.x - pl.x;
              var ddz = rg.grp.position.z - pl.z;
              var passDist = Math.sqrt(ddx * ddx + ddz * ddz);
              if (passDist < pl.tol) {
                // 成功！ ポールに刺さる
                rg.state = 'drop';
                rg.grp.position.x = pl.x;
                rg.grp.position.z = pl.z;
                rg.grp.rotation.set(0, 0, 0);
                rg.dropY = 0.16 + poleStacks[k] * 0.14;
                poleStacks[k]++;
                successStreak++;
                var mul = successStreak >= 3 ? 2 : (successStreak === 2 ? 1.5 : 1);
                // ドンピシャ（中心±35%を通した）で ×1.5 ＋ 星バースト
                var dead = passDist < pl.tol * 0.35;
                if (dead) mul *= 1.5;
                var add = Math.floor(pl.pts * mul);
                if (dead) burstStars(ctx, pl.x, 1.3, pl.z);
                total += add;
                ctx.setScore(total);
                ctx.sfx.success();
                ctx.vibrate(30);
                if (pl.bonus) burstStars(ctx, pl.x, 1.2, pl.z);
                ctx.setHint((mul > 1 ? ctx.t({ en: 'Combo x', ja: 'れんぞく x', es: 'Combo x', 'pt-BR': 'Combo x', fr: 'Combo x', de: 'Kombo x', it: 'Combo x', ko: '콤보 x', 'zh-Hans': '连击 x', tr: 'Kombo x' }) + mul + '! ' : '') + '+' + add + ctx.t({ en: ' pts!', ja: 'てん！', es: ' pts!', 'pt-BR': ' pts!', fr: ' pts!', de: ' Pkt!', it: ' pts!', ko: ' 점!', 'zh-Hans': ' 分！', tr: ' puan!' }));
                break;
              }
            }
          }

          // 地面に落ちた（はずれ）
          if (rg.state === 'fly' && rg.grp.position.y <= 0.1) {
            var near = false;
            for (var nk = 0; nk < poles.length; nk++) {
              var np = poles[nk];
              var ndx = rg.grp.position.x - np.x;
              var ndz = rg.grp.position.z - np.z;
              if (Math.sqrt(ndx * ndx + ndz * ndz) < np.tol + 0.4) { near = true; break; }
            }
            rg.state = near ? 'tumble' : 'done';
            rg.grp.position.y = 0.1;
            rg.grp.rotation.set(0, rg.grp.rotation.y, 0);
            ctx.sfx.bounce();
            successStreak = 0;
            if (near) {
              rg.tumbleT = 0.45;
              ctx.setHint(ctx.t({ en: 'So close!', ja: 'おしい！', es: '¡Casi!', 'pt-BR': 'Quase!', fr: 'Presque!', de: 'Fast!', it: 'Quasi!', ko: '아깝다!', 'zh-Hans': '差一点！', tr: 'Az kaldı!' }));
            } else {
              ctx.setHint(ctx.t({ en: 'Miss…', ja: 'はずれ…', es: 'Fallo…', 'pt-BR': 'Errou…', fr: 'Raté…', de: 'Verfehlt…', it: 'Mancato…', ko: '빗나갔다…', 'zh-Hans': '没中…', tr: 'Kaçtı…' }));
              thrown++;
              readyT = 0.5;
            }
          }
        } else if (rg.state === 'drop') {
          // ポールをすべり落ちて積み重なる
          rg.grp.position.y -= 5 * dt;
          if (rg.grp.position.y <= rg.dropY) {
            rg.grp.position.y = rg.dropY;
            rg.state = 'done';
            thrown++;
            readyT = 0.5;
          }
        } else if (rg.state === 'tumble') {
          rg.tumbleT -= dt;
          rg.grp.rotation.x += 4 * dt;
          rg.grp.rotation.z = Math.min(Math.PI / 2, rg.grp.rotation.z + 5 * dt);
          if (rg.tumbleT <= 0) {
            rg.state = 'done';
            thrown++;
            readyT = 0.5;
          }
        }
      }

      for (i = 0; i < stars.length; i++) {
        var st = stars[i];
        if (st.life <= 0) continue;
        st.life -= dt;
        st.vy -= G * dt;
        st.mesh.position.x += st.vx * dt;
        st.mesh.position.y += st.vy * dt;
        st.mesh.position.z += st.vz * dt;
        if (st.life <= 0 || st.mesh.position.y < 0) {
          st.life = 0;
          st.mesh.visible = false;
        }
      }

      // 次の輪のじゅんび／おしまい
      if (!ringReady && readyT > 0) {
        readyT -= dt;
        if (readyT <= 0) {
          if (thrown >= THROWS) {
            endT = 0.8;
          } else {
            activeIdx = thrown;
            armRing(activeIdx);
            ringReady = true;
            ctx.setHint(ctx.t({ en: 'Rings left: ', ja: 'のこり ', es: 'Quedan: ', 'pt-BR': 'Restam: ', fr: 'Restants: ', de: 'Noch: ', it: 'Rimangono: ', ko: '남은 개수: ', 'zh-Hans': '剩余: ', tr: 'Kalan: ' }) + (THROWS - thrown));
          }
        }
      }
      if (endT > 0) {
        endT -= dt;
        if (endT <= 0) ctx.endGame(total);
      }
    }
  });
})();
