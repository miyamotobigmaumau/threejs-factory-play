/* =========================================================================
 * TFShateki — しゃてきや
 * ルール: 屋台の棚3段を景品(ぬいぐるみ・箱)が左右に流れる。
 *         照準は8の字にゆらゆら自動で動く。タップでコルク弾を発射。
 *         当てると景品が落ちて得点(小さい景品ほど高得点)。10発勝負。
 * 操作: タップ(照準が景品に重なった瞬間をねらう)
 * スコア: 10発の合計点 (てん)
 * ========================================================================= */
(function () {
  'use strict';

  var SHOTS = 10;          // 持ち弾
  var SHELF_Z = -6;        // 棚の奥行き位置
  var WRAP_X = 3.4;        // 景品がループする端
  var G_CORK = 9;          // コルク弾の重力
  var CORK_VZ = -13;       // 奥向き速度（固定。強さは高さ=vyに効く）
  var AIM_DOTS = 7;        // 軌道予測ドット数

  var prizes = [];         // { group, row, size, points, speed, dir, state, t, isGold }
  var corks = [];          // コルク弾プール { mesh, active, vx, vy, vz, lastChance }
  var aimDots = [];        // 軌道予測ドット（ドラッグ中のみ表示）
  var aiming, aimSX, aimSY, aimCX, aimCY;
  var shotsLeft, pending, ended, endTimer, comboStreak, lastChanceAnnounced;
  var muzzle;              // 発射位置
  var goldMat;

  // ドラッグ量 → 発射速度（角度=vx / 強さ=vy。上フリックが強いほど上の棚へ届く）
  function aimVelocity(ctx) {
    var dyUp = Math.max(aimSY - aimCY, 0);
    var vy = 3.6 + (dyUp / ctx.height) * 9.5;
    var vx = Math.max(-4.2, Math.min(4.2, (aimCX - aimSX) * 0.018));
    return { vx: vx, vy: vy, vz: CORK_VZ, valid: dyUp >= 30 };
  }

  // 弾道上の点（発射 t 秒後）
  function trajPoint(v, t, out) {
    out.x = muzzle.x + v.vx * t;
    out.y = muzzle.y + v.vy * t - 0.5 * G_CORK * t * t;
    out.z = muzzle.z + v.vz * t;
  }

  var PR_MOVING = 0, PR_FALLING = 1, PR_GONE = 2;

  // 段ごとの設定: 下段=大きい/安い、上段=小さい/高い
  var ROWS = [
    { y: 1.15, size: 0.95, points: 100, speed: 0.9 },
    { y: 2.35, size: 0.68, points: 200, speed: 1.3 },
    { y: 3.45, size: 0.46, points: 300, speed: 1.8 }
  ];

  /* くまのぬいぐるみ(球の組み合わせ) */
  function makeBear(THREE, size, color) {
    var g = new THREE.Group();
    var mat = Style.mat(color);
    var body = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 10, 8), mat);
    body.position.y = size * 0.5;
    var head = new THREE.Mesh(new THREE.SphereGeometry(size * 0.34, 10, 8), mat);
    head.position.y = size * 1.05;
    var earGeo = new THREE.SphereGeometry(size * 0.13, 8, 6);
    var eL = new THREE.Mesh(earGeo, mat);
    eL.position.set(-size * 0.24, size * 1.32, 0);
    var eR = new THREE.Mesh(earGeo, mat);
    eR.position.set(size * 0.24, size * 1.32, 0);
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    var eyeGeo = new THREE.SphereGeometry(size * 0.05, 6, 6);
    var vL = new THREE.Mesh(eyeGeo, eyeMat);
    vL.position.set(-size * 0.12, size * 1.08, size * 0.3);
    var vR = new THREE.Mesh(eyeGeo, eyeMat);
    vR.position.set(size * 0.12, size * 1.08, size * 0.3);
    g.add(body, head, eL, eR, vL, vR);
    return g;
  }

  /* おかしの箱(リボンつきキューブ) */
  function makeBox(THREE, size, color) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(
      Style.roundedBox(size, size, size),
      Style.mat(color)
    );
    body.position.y = size * 0.5;
    var ribbonMat = Style.mat(0xfff176);
    var r1 = new THREE.Mesh(Style.roundedBox(size * 0.2, size * 1.02, size * 1.02), ribbonMat);
    r1.position.y = size * 0.5;
    g.add(body, r1);
    return g;
  }

  function rememberMaterials(g) {
    g.traverse(function (o) {
      if (o.material && !o.userData.baseMat) o.userData.baseMat = o.material;
    });
  }

  function setGold(g, isGold) {
    g.traverse(function (o) {
      if (!o.material) return;
      o.material = isGold ? goldMat : o.userData.baseMat;
    });
  }

  /* 有効な(棚に乗っている)景品との当たり判定 */
  function checkHit(x, y) {
    for (var i = 0; i < prizes.length; i++) {
      var p = prizes[i];
      if (p.state !== PR_MOVING) continue;
      var row = ROWS[p.row];
      var halfW = p.size * 0.55 + 0.16; // コルクの半径ぶんおまけ
      var cy = row.y + p.size * 0.65;   // 景品の中心あたり
      var halfH = p.size * 0.75 + 0.16;
      if (Math.abs(x - p.group.position.x) <= halfW &&
          Math.abs(y - cy) <= halfH) return p;
    }
    return null;
  }

  Shell.registerGame({
    id: 'TFShateki',
    title: { en: 'Shooting Gallery', ja: 'しゃてきや', es: 'Galería de tiro', 'pt-BR': 'Galeria de tiro', fr: 'Stand de tir', de: 'Schießbude', it: 'Stand di tiro', ko: '사격 게임', 'zh-Hans': '射击摊', tr: 'Nişancı Kulübesi' },
    howto: { en: 'Flick to shoot — angle & power aim the cork!\nStrong flick reaches the top shelf (high pts)!\nLead moving targets & hit dead-center!', ja: 'フリックでうつ！角度と強さがねらい\nつよくはじくと上のだな（高得点）へ\n動くまとは先読み！ど真ん中で ×1.5', es: '¡Desliza para disparar: ángulo y fuerza!\n¡Fuerte llega al estante alto (más pts)!\n¡Anticipa el movimiento y da en el centro!', 'pt-BR': 'Deslize para atirar — ângulo e força!\nForte alcança a prateleira alta (mais pts)!\nAntecipe o alvo e acerte no centro!', fr: 'Glissez pour tirer : angle et force !\nFort atteint l\'étagère haute (plus de pts) !\nAnticipez et visez le centre !', de: 'Wischen zum Schießen — Winkel & Kraft!\nStark erreicht das obere Regal (mehr Pkt)!\nZielen mit Vorhalt, mittig treffen!', it: 'Scorri per sparare: angolo e forza!\nForte arriva allo scaffale alto (più punti)!\nAnticipa il bersaglio e colpisci al centro!', ko: '플릭으로 발사! 각도와 세기로 조준\n세게 튕기면 위쪽 선반(고득점)까지\n움직임을 예측! 정중앙은 ×1.5', 'zh-Hans': '滑动射击——角度和力度决定弹道！\n用力滑到达上层货架（高分）！\n预判移动目标，正中靶心×1.5！', tr: 'Kaydırarak ateş et — açı ve güç!\nGüçlü fırlatış üst rafa ulaşır (yüksek puan)!\nHareketi tahmin et, tam ortadan vur!' },
    scoreLabel: { en: 'pts', ja: 'てん', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pts', it: 'pts', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0x1a1233,
    cameraFov: 55,
    cameraPos: [0, 2.3, 7],
    cameraLookAt: [0, 2.3, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 夜店の地面と屋台
      goldMat = new THREE.MeshPhongMaterial({ color: 0xffd54f, shininess: 90, specular: 0xffffff });
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        Style.mat(0x3a2e28)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);

      // 屋台の背板
      var back = new THREE.Mesh(
        new THREE.PlaneGeometry(9, 6.5),
        Style.mat(0x51342a)
      );
      back.position.set(0, 3.2, SHELF_Z - 0.8);
      ctx.scene.add(back);

      // 木の棚3段
      var shelfGeo = Style.roundedBox(8.5, 0.16, 1.1);
      var shelfMat = Style.mat(0x8a5a2b);
      for (var r = 0; r < ROWS.length; r++) {
        var sh = new THREE.Mesh(shelfGeo, shelfMat);
        sh.position.set(0, ROWS[r].y, SHELF_Z);
        ctx.scene.add(sh);
      }

      // 屋根と提灯(ネオンぽい光)
      var roof = new THREE.Mesh(
        Style.roundedBox(9.5, 0.4, 2.4),
        Style.mat(0xc0392b)
      );
      roof.position.set(0, 5.4, SHELF_Z + 0.2);
      ctx.scene.add(roof);
      var lanternGeo = new THREE.SphereGeometry(0.28, 10, 8);
      var lanternMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
      for (var l = 0; l < 5; l++) {
        var la = new THREE.Mesh(lanternGeo, lanternMat);
        la.position.set(-3.2 + l * 1.6, 4.95, SHELF_Z + 0.8);
        la.scale.y = 1.25;
        ctx.scene.add(la);
      }

      // 景品: 各段4個(くま/箱を交互に)
      var colors = [0xf48fb1, 0x81d4fa, 0xaed581, 0xffcc80];
      for (var row = 0; row < ROWS.length; row++) {
        for (var k = 0; k < 4; k++) {
          var size = ROWS[row].size;
          var g = (k % 2 === 0)
            ? makeBear(ctx.THREE, size, colors[(row + k) % colors.length])
            : makeBox(ctx.THREE, size, colors[(row + k * 2) % colors.length]);
          rememberMaterials(g);
          g.position.set(-WRAP_X + k * (WRAP_X * 2 / 4), ROWS[row].y + 0.08, SHELF_Z);
          ctx.scene.add(g);
          prizes.push({
            group: g, row: row, size: size,
            points: ROWS[row].points,
            speed: ROWS[row].speed,
            dir: row % 2 === 0 ? 1 : -1,
            baseX: g.position.x,
            state: PR_MOVING, t: 0, vy: 0, isGold: false
          });
        }
      }

      // 軌道予測ドット（ドラッグ中のみ表示。フリックの角度と強さがそのまま見える）
      var dotGeo = new THREE.SphereGeometry(0.09, 8, 6);
      for (var dI = 0; dI < AIM_DOTS; dI++) {
        var dot = new THREE.Mesh(dotGeo,
          new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.85 - dI * 0.09 }));
        dot.visible = false;
        ctx.scene.add(dot);
        aimDots.push(dot);
      }

      // コルク弾プール
      var corkGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8);
      var corkMat = Style.mat(0xd7b98e);
      for (var cI = 0; cI < 4; cI++) {
        var m = new THREE.Mesh(corkGeo, corkMat);
        m.rotation.x = Math.PI / 2;
        m.visible = false;
        ctx.scene.add(m);
        corks.push({ mesh: m, active: false, t: 0, dur: 0.3,
                     fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0 });
      }
      muzzle = { x: 0, y: 0.9, z: 5.5 };
    },

    start: function (ctx) {
      shotsLeft = SHOTS;
      pending = 0;
      ended = false;
      endTimer = 0;
      aiming = false;
      for (var d = 0; d < aimDots.length; d++) aimDots[d].visible = false;
      comboStreak = 0;
      lastChanceAnnounced = false;
      for (var i = 0; i < prizes.length; i++) {
        var p = prizes[i];
        p.state = PR_MOVING;
        p.t = 0; p.vy = 0;
        p.isGold = ctx.random() < 0.12;
        setGold(p.group, p.isGold);
        p.group.visible = true;
        p.group.position.set(p.baseX, ROWS[p.row].y + 0.08, SHELF_Z);
        p.group.rotation.set(0, 0, 0);
      }
      for (var c = 0; c < corks.length; c++) {
        corks[c].active = false;
        corks[c].mesh.visible = false;
      }
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Shots left: ', ja: 'のこり ', es: 'Disparos: ', 'pt-BR': 'Tiros: ', fr: 'Tirs restants: ', de: 'Schüsse: ', it: 'Colpi: ', ko: '남은 발: ', 'zh-Hans': '剩余发数: ', tr: 'Kalan atış: ' }) + SHOTS + ctx.t({ en: '', ja: ' ぱつ', es: '', 'pt-BR': '', fr: '', de: '', it: '', ko: ' 발', 'zh-Hans': ' 发', tr: '' }));
    },

    onPointerDown: function (ctx, p) {
      if (ended || shotsLeft <= 0) return;
      aiming = true;
      aimSX = p.x; aimSY = p.y;
      aimCX = p.x; aimCY = p.y;
    },

    onPointerMove: function (ctx, p) {
      if (!aiming) return;
      aimCX = p.x; aimCY = p.y;
    },

    onPointerUp: function (ctx, p) {
      if (!aiming) return;
      aiming = false;
      for (var d = 0; d < AIM_DOTS; d++) aimDots[d].visible = false;
      if (ended || shotsLeft <= 0) return;
      aimCX = p.x; aimCY = p.y;
      var v = aimVelocity(ctx);
      if (!v.valid) return; // フリックが弱すぎ＝キャンセル

      var cork = null;
      for (var i = 0; i < corks.length; i++) if (!corks[i].active) { cork = corks[i]; break; }
      if (!cork) return;

      shotsLeft--;
      pending++;
      ctx.setHint(ctx.t({ en: 'Shots left: ', ja: 'のこり ', es: 'Disparos: ', 'pt-BR': 'Tiros: ', fr: 'Tirs restants: ', de: 'Schüsse: ', it: 'Colpi: ', ko: '남은 발: ', 'zh-Hans': '剩余发数: ', tr: 'Kalan atış: ' }) + shotsLeft + ctx.t({ en: '', ja: ' ぱつ', es: '', 'pt-BR': '', fr: '', de: '', it: '', ko: ' 발', 'zh-Hans': ' 发', tr: '' }));
      cork.active = true;
      cork.t = 0;
      cork.lastChance = shotsLeft <= 3;
      cork.vx = v.vx; cork.vy = v.vy; cork.vz = v.vz;
      cork.mesh.position.set(muzzle.x, muzzle.y, muzzle.z);
      cork.mesh.visible = true;
      ctx.sfx.tap();
      ctx.vibrate(15);
      if (shotsLeft <= 3 && !lastChanceAnnounced) {
        lastChanceAnnounced = true;
        ctx.setHint(ctx.t({ en: 'Last Chance! Score x2!', ja: 'ラストチャンス！てんすう2ばい', es: '¡Última oportunidad! ×2 pts', 'pt-BR': 'Última chance! ×2 pontos', fr: 'Dernière chance! ×2 pts', de: 'Letzte Chance! ×2 Punkte!', it: 'Ultima possibilità! ×2 punti!', ko: '마지막 기회! 점수 2배!', 'zh-Hans': '最后机会！得分×2！', tr: 'Son şans! Puan ×2!' }));
      }
    },

    update: function (ctx, dt) {
      if (ended) return;

      // エイム中: フリックの角度と強さから軌道予測ドットを描く
      if (aiming) {
        var av = aimVelocity(ctx);
        var tp = { x: 0, y: 0, z: 0 };
        for (var ad = 0; ad < AIM_DOTS; ad++) {
          trajPoint(av, 0.12 + ad * 0.115, tp);
          aimDots[ad].position.set(tp.x, tp.y, tp.z);
          aimDots[ad].visible = av.valid && tp.y > 0;
        }
      }

      // 景品の移動(左右ループ)
      for (var i = 0; i < prizes.length; i++) {
        var p = prizes[i];
        if (p.state === PR_MOVING) {
          p.group.position.x += p.speed * (p.isGold ? 1.6 : 1) * p.dir * (shotsLeft <= 3 ? 1.5 : 1) * dt;
          if (p.group.position.x > WRAP_X + p.size) p.group.position.x = -WRAP_X - p.size;
          if (p.group.position.x < -WRAP_X - p.size) p.group.position.x = WRAP_X + p.size;
        } else if (p.state === PR_FALLING) {
          // 当たった景品は回りながら落ちる
          p.vy -= 12 * dt;
          p.group.position.y += p.vy * dt;
          p.group.position.z += dt * 1.2;
          p.group.rotation.x += dt * 5;
          p.group.rotation.z += dt * 3;
          if (p.group.position.y < -1.5) {
            p.state = PR_GONE;
            p.group.visible = false;
            p.t = 0;
          }
        } else {
          // しばらくしたら端から復活
          p.t += dt;
          if (p.t > 2.0) {
            p.state = PR_MOVING;
            p.isGold = ctx.random() < 0.12;
            setGold(p.group, p.isGold);
            p.group.visible = true;
            p.group.rotation.set(0, 0, 0);
            p.group.position.set(p.dir > 0 ? -WRAP_X - p.size : WRAP_X + p.size,
                                 ROWS[p.row].y + 0.08, SHELF_Z);
          }
        }
      }

      // コルク弾の飛行（実弾道: フリックの角度と強さがそのまま軌道になる）
      for (var c = 0; c < corks.length; c++) {
        var ck = corks[c];
        if (!ck.active) continue;
        ck.vy -= G_CORK * dt;
        ck.mesh.position.x += ck.vx * dt;
        ck.mesh.position.y += ck.vy * dt;
        ck.mesh.position.z += ck.vz * dt;
        ck.mesh.rotation.x += dt * 10;
        var arrived = ck.mesh.position.z <= SHELF_Z + 0.4;
        var missedOut = ck.mesh.position.y < 0 || ck.mesh.position.z < SHELF_Z - 1.2;
        if (arrived || missedOut) {
          ck.active = false;
          ck.mesh.visible = false;
          pending--;
          // 着弾判定（棚の面に到達した瞬間のx/yで判定）
          var hit = arrived ? checkHit(ck.mesh.position.x, ck.mesh.position.y) : null;
          if (hit) {
            hit.state = PR_FALLING;
            hit.vy = 1.5;
            comboStreak++;
            var comboMul = comboStreak >= 3 ? 2 : (comboStreak === 2 ? 1.5 : 1);
            // ど真ん中ボーナス: 景品中心への精密ヒットで×1.5
            var precise = Math.abs(ck.mesh.position.x - hit.group.position.x) < hit.size * 0.18;
            var basePts = hit.isGold ? 500 : hit.points;
            var pts = Math.floor(basePts * comboMul * (ck.lastChance ? 2 : 1) * (precise ? 1.5 : 1));
            ctx.addScore(pts);
            ctx.sfx.success();
            ctx.vibrate(40);
            if (hit.isGold) ctx.setHint(ctx.t({ en: 'Golden prize! +', ja: 'きんのけいひん！+', es: '¡Premio dorado! +', 'pt-BR': 'Prêmio dourado! +', fr: 'Prix doré! +', de: 'Goldpreis! +', it: 'Premio dorato! +', ko: '황금 경품! +', 'zh-Hans': '金色奖品！+', tr: 'Altın ödül! +' }) + pts);
            else if (comboMul > 1) ctx.setHint(ctx.t({ en: 'Combo x', ja: 'コンボ x', es: 'Combo x', 'pt-BR': 'Combo x', fr: 'Combo x', de: 'Kombo x', it: 'Combo x', ko: '콤보 x', 'zh-Hans': '连击 x', tr: 'Kombo x' }) + comboMul + ctx.t({ en: '!', ja: '！', es: '!', 'pt-BR': '!', fr: '!', de: '!', it: '!', ko: '!', 'zh-Hans': '！', tr: '!' }));
          } else {
            comboStreak = 0;
            ctx.sfx.bounce();
          }
        }
      }

      // 10発撃ち終えて弾も着弾したら終了(景品落下を少し見せる)
      if (shotsLeft <= 0 && pending <= 0) {
        endTimer += dt;
        if (endTimer > 1.0) {
          ended = true;
          ctx.endGame(ctx.score);
        }
      }
    }
  });
})();
