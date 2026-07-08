/* =========================================================================
 * TFEraserSumo — けしごむずもう
 * ルール: 消しゴムを引っぱって弾き、相手を机から落とせ。自分が落ちたら負け。
 * 操作: 自分のターンに画面をドラッグ→離すと引いた逆方向へ発射（パチンコ式）。
 *       交互ターン。相手AIは精度ランダム（勝つほど強くなる）。
 * スコア: 勝ち抜き数 (しょう)
 * ========================================================================= */
(function () {
  'use strict';

  // 机の遊び領域（中心が縁を越えたら落下）
  var DESK_HX = 4.4, DESK_HZ = 5.4;
  var ERASER_Y = 0.18;      // 消しゴムの高さ(半分)
  var FRICTION = 5.5;       // 摩擦減速 (units/s^2)
  var HIT_DIST = 1.25;      // 衝突判定距離
  var MAX_SPEED = 15;

  var player, enemy, arrow, pShadow, eShadow;
  var sparks = [];          // 衝突火花プール
  var state;                // 'player' | 'moving' | 'aiwait' | 'done'
  var lastShooter;          // 'player' | 'ai'
  var round, aiErr, aiPow, aiTimer;
  var dragStart = null, dragCur = null;

  // 消しゴム生成（本体＋紙スリーブ）
  function makeEraser(THREE, bodyColor, sleeveColor) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(
      Style.roundedBox(1.3, 0.36, 0.75),
      Style.mat(bodyColor)
    );
    var sleeve = new THREE.Mesh(
      Style.roundedBox(0.85, 0.4, 0.79),
      Style.mat(sleeveColor)
    );
    g.add(body, sleeve);
    // 物理状態はグループに直接持たせる
    g.userData = { vx: 0, vz: 0, vy: 0, falling: false, gone: false };
    return g;
  }

  function resetEraser(e, x, z) {
    e.position.set(x, ERASER_Y, z);
    e.rotation.set(0, 0, 0);
    e.visible = true;
    e.userData.vx = 0; e.userData.vz = 0; e.userData.vy = 0;
    e.userData.falling = false; e.userData.gone = false;
  }

  function speedOf(e) {
    var u = e.userData;
    return Math.sqrt(u.vx * u.vx + u.vz * u.vz);
  }

  function resetRound(ctx) {
    resetEraser(player, 0, 3.4);
    resetEraser(enemy, 0, -3.4);
    state = 'player';
    ctx.setHint(ctx.t({ en: 'Pull & release! (Match ', ja: 'ひっぱって はなす！（', es: '¡Jala y suelta! (Combate ', 'pt-BR': 'Puxe e solte! (Combate ', fr: 'Tirez et relâchez ! (Match ', de: 'Ziehen & loslassen! (Runde ', it: 'Tieni e rilascia! (Round ', ko: '당겨서 놓기! (', 'zh-Hans': '拉动后松开！（第', tr: 'Çek ve bırak! (Maç ' }) + round + ctx.t({ en: ')', ja: 'かいせんめ）', es: ')', 'pt-BR': ')', fr: ')', de: ')', it: ')', ko: '번째)', 'zh-Hans': '场）', tr: ')' }));
  }

  Shell.registerGame({
    id: 'TFEraserSumo',
    title: { en: 'Eraser Sumo', ja: 'けしごむずもう', es: 'Sumo de Goma', 'pt-BR': 'Sumô de Borracha', fr: 'Sumo Gomme', de: 'Radierer-Sumo', it: 'Sumo Gomma', ko: '지우개 씨름', 'zh-Hans': '橡皮相扑', tr: 'Silgi Sumo' },
    howto: { en: 'Pull and flick the eraser!\nKnock the opponent off the desk!', ja: 'けしごむをひっぱってはじいて\nあいてをつくえからおとそう！', es: '¡Jala y lanza la goma!\n¡Haz caer al rival del escritorio!', 'pt-BR': 'Puxe e arremesse a borracha!\nJogue o adversário para fora da mesa!', fr: 'Tirez et lancez la gomme !\nFaites tomber l\'adversaire du bureau !', de: 'Ziehe und schleudere den Radierer!\nWerfe den Gegner vom Tisch!', it: 'Tira e lancia la gomma!\nButta fuori il rivale dalla scrivania!', ko: '지우개를 당겨서 튕겨라!\n상대를 책상에서 떨어뜨려!', 'zh-Hans': '拉动橡皮并弹射出去！\n把对手推下桌子！', tr: 'Silgiyi çek ve fırlat!\nRakibi masadan düşür!' },
    scoreLabel: { en: 'wins', ja: 'しょう', es: 'victorias', 'pt-BR': 'vitórias', fr: 'victoires', de: 'Siege', it: 'vittorie', ko: '승', 'zh-Hans': '胜', tr: 'galibiyet' },
    bg: 0xbfe3f2,
    cameraFov: 55,
    cameraPos: [0, 11.5, 9.5],
    cameraLookAt: [0, 0, -0.5],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 教室の床
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        Style.mat(0xc9a878)
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -6;
      ctx.scene.add(floor);

      // 机（天板＋脚）。遊び領域よりわずかに大きい見た目
      var desk = new THREE.Mesh(
        Style.roundedBox(DESK_HX * 2 + 0.3, 0.5, DESK_HZ * 2 + 0.3),
        Style.mat(0xdcb87e)
      );
      desk.position.y = -0.25;
      ctx.scene.add(desk);

      // 机の縁の危険標示（紅白ボーダー＝落ちたら負けのゾーンを明示）
      var edgeMat = new THREE.MeshBasicMaterial({ color: 0xd94f4f });
      var edgeMatW = new THREE.MeshBasicMaterial({ color: 0xffffff });
      var segN = 10;
      for (var ex = 0; ex < segN; ex++) {
        for (var side = 0; side < 2; side++) {
          var seg = new THREE.Mesh(new THREE.PlaneGeometry(DESK_HX * 2 / segN * 0.85, 0.22),
            ex % 2 === 0 ? edgeMat : edgeMatW);
          seg.rotation.x = -Math.PI / 2;
          seg.position.set(-DESK_HX + (ex + 0.5) * (DESK_HX * 2 / segN), 0.015, side === 0 ? -DESK_HZ : DESK_HZ);
          ctx.scene.add(seg);
        }
      }
      for (var ez = 0; ez < segN; ez++) {
        for (var side2 = 0; side2 < 2; side2++) {
          var seg2 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, DESK_HZ * 2 / segN * 0.85),
            ez % 2 === 0 ? edgeMat : edgeMatW);
          seg2.rotation.x = -Math.PI / 2;
          seg2.position.set(side2 === 0 ? -DESK_HX : DESK_HX, 0.015, -DESK_HZ + (ez + 0.5) * (DESK_HZ * 2 / segN));
          ctx.scene.add(seg2);
        }
      }

      var legGeo = new THREE.CylinderGeometry(0.12, 0.12, 5.6, 8);
      var legMat = Style.mat(0x8a8f96);
      var lx = DESK_HX - 0.4, lz = DESK_HZ - 0.4;
      var legPos = [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]];
      for (var i = 0; i < 4; i++) {
        var leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(legPos[i][0], -3.3, legPos[i][1]);
        ctx.scene.add(leg);
      }

      // 小道具: ノート（Canvas罫線テクスチャの薄板・当たり無し）
      var cv = document.createElement('canvas');
      cv.width = 128; cv.height = 160;
      var c2 = cv.getContext('2d');
      c2.fillStyle = '#ffffff'; c2.fillRect(0, 0, 128, 160);
      c2.strokeStyle = '#9fc3e8'; c2.lineWidth = 2;
      for (var yy = 24; yy < 160; yy += 18) {
        c2.beginPath(); c2.moveTo(8, yy); c2.lineTo(120, yy); c2.stroke();
      }
      c2.strokeStyle = '#e88'; c2.beginPath(); c2.moveTo(16, 8); c2.lineTo(16, 152); c2.stroke();
      var note = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 3.3),
        new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) })
      );
      note.rotation.x = -Math.PI / 2;
      note.rotation.z = 0.25;
      note.position.set(-2.2, 0.01, 0.3);
      ctx.scene.add(note);

      // 小道具: 鉛筆（当たり無し・机の隅）
      var pencil = new THREE.Group();
      var pBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 2.4, 6),
        Style.mat(0xf3c522)
      );
      var pTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.3, 6),
        Style.mat(0xe0b98a)
      );
      pTip.position.y = 1.35;
      pencil.add(pBody, pTip);
      pencil.rotation.z = Math.PI / 2;
      pencil.rotation.y = 0.4;
      pencil.position.set(2.6, 0.1, 1.2);
      ctx.scene.add(pencil);

      // 小道具: 定規（机の隅・当たり無し）
      var ruler = new THREE.Mesh(Style.roundedBox(0.5, 0.06, 3.4, 0.03), Style.mat(0x6fc3a0));
      ruler.position.set(3.2, 0.04, -1.5);
      ruler.rotation.y = -0.2;
      ctx.scene.add(ruler);
      // 小道具: 消しカスの山
      var shavMat = Style.mat(0xd8d0c0);
      for (var sv = 0; sv < 5; sv++) {
        var shav = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.04, 5, 4), shavMat);
        shav.position.set(-3.1 + (Math.random() - 0.5) * 0.5, 0.05, 2.6 + (Math.random() - 0.5) * 0.5);
        shav.scale.set(1.5, 0.5, 1);
        ctx.scene.add(shav);
      }

      // 消しゴム: 自分(青)・相手(赤)＋接地影
      player = makeEraser(THREE, 0x3a66c8, 0xeef3ff);
      enemy = makeEraser(THREE, 0xc83a3a, 0xfff2ee);
      ctx.scene.add(player, enemy);
      pShadow = Style.softShadow(0.85);
      pShadow.position.y = 0.02;
      ctx.scene.add(pShadow);
      eShadow = Style.softShadow(0.85);
      eShadow.position.y = 0.02;
      ctx.scene.add(eShadow);

      // 衝突火花プール
      var sparkGeo = new THREE.SphereGeometry(0.08, 5, 4);
      for (var sp = 0; sp < 12; sp++) {
        var sm = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0 }));
        sm.visible = false;
        ctx.scene.add(sm);
        sparks.push({ mesh: sm, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      // 発射方向の矢印（三角ポリゴン1枚）
      var aGeo = new THREE.BufferGeometry();
      aGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0.35, 0, 0, -0.35, 0, 0, 0, 0, -1
      ], 3));
      aGeo.computeVertexNormals();
      arrow = new THREE.Mesh(aGeo, new THREE.MeshBasicMaterial({
        color: 0xffee58, side: THREE.DoubleSide, transparent: true, opacity: 0.85
      }));
      arrow.position.y = 0.45;
      arrow.visible = false;
      ctx.scene.add(arrow);
    },

    start: function (ctx) {
      round = 1;
      aiErr = 0.55;   // AIの狙い角ブレ(rad) — 勝つたび小さく
      aiPow = 8.0;    // AIの弾き強さ — 勝つたび強く
      aiTimer = 0;
      dragStart = null;
      arrow.visible = false;
      lastShooter = 'player';
      resetRound(ctx);
    },

    onPointerDown: function (ctx, p) {
      if (state !== 'player') return;
      dragStart = { x: p.x, y: p.y };
      dragCur = { x: p.x, y: p.y };
    },

    onPointerMove: function (ctx, p) {
      if (state !== 'player' || !dragStart) return;
      dragCur.x = p.x; dragCur.y = p.y;
      // 引いた逆方向へ発射 → 矢印プレビュー
      var vx = (dragStart.x - dragCur.x) * 0.05;
      var vz = (dragStart.y - dragCur.y) * 0.05;
      var sp = Math.sqrt(vx * vx + vz * vz);
      if (sp > 0.5) {
        arrow.visible = true;
        arrow.position.x = player.position.x;
        arrow.position.z = player.position.z;
        arrow.rotation.y = Math.atan2(-vx, -vz);
        var len = Math.min(sp, MAX_SPEED) * 0.22;
        arrow.scale.set(1, 1, Math.max(0.5, len));
      } else {
        arrow.visible = false;
      }
    },

    onPointerUp: function (ctx, p) {
      if (state !== 'player' || !dragStart) return;
      var vx = (dragStart.x - p.x) * 0.05;
      var vz = (dragStart.y - p.y) * 0.05;
      dragStart = null;
      arrow.visible = false;
      var sp = Math.sqrt(vx * vx + vz * vz);
      if (sp < 1.2) return; // 弱すぎは不発
      if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vz *= MAX_SPEED / sp; }
      player.userData.vx = vx;
      player.userData.vz = vz;
      state = 'moving';
      lastShooter = 'player';
      ctx.setHint('');
      ctx.sfx.tap();
      ctx.vibrate(15);
    },

    _spark: function (x, z) {
      var n = 0;
      for (var i = 0; i < sparks.length && n < 7; i++) {
        if (sparks[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        sparks[i].life = 0.3;
        sparks[i].vx = Math.cos(a) * (2 + Math.random() * 2);
        sparks[i].vy = 1.5 + Math.random() * 1.5;
        sparks[i].vz = Math.sin(a) * (2 + Math.random() * 2);
        sparks[i].mesh.position.set(x, 0.4, z);
        sparks[i].mesh.material.opacity = 1;
        sparks[i].mesh.visible = true;
        n++;
      }
    },

    update: function (ctx, dt) {
      // 接地影を追従（落下中は消す）
      pShadow.visible = !player.userData.gone && !player.userData.falling;
      eShadow.visible = !enemy.userData.gone && !enemy.userData.falling;
      pShadow.position.x = player.position.x; pShadow.position.z = player.position.z;
      eShadow.position.x = enemy.position.x; eShadow.position.z = enemy.position.z;
      // 火花更新
      for (var si = 0; si < sparks.length; si++) {
        var sk = sparks[si];
        if (sk.life <= 0) continue;
        sk.life -= dt;
        sk.mesh.position.x += sk.vx * dt;
        sk.mesh.position.y += sk.vy * dt;
        sk.mesh.position.z += sk.vz * dt;
        sk.vy -= 9 * dt;
        sk.mesh.material.opacity = Math.max(0, sk.life / 0.3);
        if (sk.life <= 0) sk.mesh.visible = false;
      }

      // AI 思考待ち → 発射
      if (state === 'aiwait') {
        aiTimer -= dt;
        if (aiTimer <= 0) {
          var dx = player.position.x - enemy.position.x;
          var dz = player.position.z - enemy.position.z;
          var ang = Math.atan2(dx, dz) + (ctx.random() - 0.5) * 2 * aiErr;
          var pow = aiPow + ctx.random() * 3;
          enemy.userData.vx = Math.sin(ang) * pow;
          enemy.userData.vz = Math.cos(ang) * pow;
          state = 'moving';
          lastShooter = 'ai';
          ctx.sfx.tap();
        }
        return;
      }
      if (state !== 'moving') return;

      var list = [player, enemy];
      var i, e, u;
      for (i = 0; i < list.length; i++) {
        e = list[i]; u = e.userData;
        if (u.gone) continue;
        e.position.x += u.vx * dt;
        e.position.z += u.vz * dt;
        if (u.falling) {
          // 落下中: 重力＋回転
          u.vy -= 28 * dt;
          e.position.y += u.vy * dt;
          e.rotation.x += 4 * dt;
          e.rotation.z += 3 * dt;
          if (e.position.y < -5) { u.gone = true; e.visible = false; u.vx = 0; u.vz = 0; }
        } else {
          // 摩擦減速
          var sp = speedOf(e);
          if (sp > 0) {
            var ns = Math.max(0, sp - FRICTION * dt);
            u.vx *= ns / sp; u.vz *= ns / sp;
          }
          // 机の縁を越えたら落下開始
          if (Math.abs(e.position.x) > DESK_HX || Math.abs(e.position.z) > DESK_HZ) {
            u.falling = true;
            ctx.sfx.bounce();
            ctx.vibrate(30);
          }
        }
      }

      // 衝突（運動量交換: 等質量の弾性衝突・法線成分を入れ替え）
      var pu = player.userData, eu = enemy.userData;
      if (!pu.falling && !eu.falling && !pu.gone && !eu.gone) {
        var ddx = enemy.position.x - player.position.x;
        var ddz = enemy.position.z - player.position.z;
        var d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > 0.001 && d < HIT_DIST) {
          var nx = ddx / d, nz = ddz / d;
          var rel = (pu.vx - eu.vx) * nx + (pu.vz - eu.vz) * nz;
          if (rel > 0) {
            pu.vx -= rel * nx; pu.vz -= rel * nz;
            eu.vx += rel * nx; eu.vz += rel * nz;
            this._spark((player.position.x + enemy.position.x) / 2, (player.position.z + enemy.position.z) / 2);
            ctx.sfx.bounce();
            ctx.vibrate(20);
          }
          // めり込み解消
          var push = (HIT_DIST - d) / 2;
          player.position.x -= nx * push; player.position.z -= nz * push;
          enemy.position.x += nx * push; enemy.position.z += nz * push;
        }
      }

      // 全停止＆落下完了で決着判定
      var settled =
        (pu.gone || (!pu.falling && speedOf(player) < 0.08)) &&
        (eu.gone || (!eu.falling && speedOf(enemy) < 0.08));
      if (!settled) return;
      // 速度を完全停止
      pu.vx = 0; pu.vz = 0; eu.vx = 0; eu.vz = 0;

      if (pu.gone) {
        // 自分が落ちた → 負けで終了（相手も落ちていても負け）
        state = 'done';
        ctx.gameOver(ctx.score);
      } else if (eu.gone) {
        // 相手を落とした → 1勝。次ラウンドはAIが強くなる
        ctx.addScore(1);
        ctx.sfx.success();
        ctx.vibrate(50);
        round++;
        aiErr = Math.max(0.08, aiErr * 0.75);
        aiPow = Math.min(14, aiPow + 1.1);
        resetRound(ctx);
      } else {
        // どちらも残った → ターン交代
        if (lastShooter === 'player') {
          state = 'aiwait';
          aiTimer = 0.8;
          ctx.setHint(ctx.t({ en: 'Opponent\'s turn…', ja: 'あいてのばん…', es: 'Turno del rival…', 'pt-BR': 'Vez do adversário…', fr: 'Tour de l\'adversaire…', de: 'Gegner ist dran…', it: 'Turno del rivale…', ko: '상대 차례…', 'zh-Hans': '对手回合…', tr: 'Rakibin sırası…' }));
        } else {
          state = 'player';
          ctx.setHint(ctx.t({ en: 'Pull & release!', ja: 'ひっぱって はなす！', es: '¡Jala y suelta!', 'pt-BR': 'Puxe e solte!', fr: 'Tirez et relâchez !', de: 'Ziehen und loslassen!', it: 'Tieni e rilascia!', ko: '당겨서 놓기!', 'zh-Hans': '拉动后松开！', tr: 'Çek ve bırak!' }));
        }
      }
    }
  });
})();
