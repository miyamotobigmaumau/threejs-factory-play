/* =========================================================================
 * TFCanTumble — カンたおし
 * ルール: 夏祭りの屋台。ラウンドごとに大きくなる空き缶ピラミッドへ投げる。
 *        スワイプの方向と強さで山なり投球。各ラウンド3球で合計点をきそう。
 *        倒した缶 ×100点、台から落とした缶 ×200点。
 * 操作: スワイプ投球（3球）
 * スコア: 合計点 (ぽいんと)
 * ========================================================================= */
(function () {
  'use strict';

  var G = 12;                       // 重力
  var CAN_R = 0.3, CAN_H = 0.72;
  var TY = 1.05;                    // 台の天板高さ
  var TZ = -6;                      // 台の中心 z
  var TX_HALF = 3.2, TZ_HALF = 0.9; // 台の広さ（半分）
  var BALL_START = [0, 1.3, -0.8];
  var MAX_CANS = 45, MAX_ROUND = 6;

  var WOBBLE_DUR = 3.5;             // 揺れの持続（この間は倒しやすい＝追い打ちのタイミング要素）
  var cans = [];      // {mesh, home, vel, state:0立|1動|2静, scored, spinX, spinZ, supports, req, wobbleT}
  var ball, ballVel;
  var lanterns = [];
  var rowLabelMats = [];            // 段ごとのラベル材質（下段ほど濃い＝頑丈の記号）
  var throwing, ballDone, ballsLeft, turnT, ending, endT, roundNo, activeCanCount;
  var downX, downY;

  // 缶ラベル（Canvas 2D → CanvasTexture、外部アセット不要）
  function canTexture() {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var c = cv.getContext('2d');
    c.fillStyle = '#e53935'; c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#ffffff'; c.fillRect(0, 44, 128, 40);
    c.fillStyle = '#e53935';
    c.font = 'bold 30px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('カン', 64, 64);
    c.fillStyle = '#b71c1c'; c.fillRect(0, 0, 128, 10); c.fillRect(0, 118, 128, 10);
    return new THREE.CanvasTexture(cv);
  }

  // 屋台のしましま屋根テクスチャ
  function stripeTexture() {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 32;
    var c = cv.getContext('2d');
    for (var i = 0; i < 8; i++) {
      c.fillStyle = (i % 2 === 0) ? '#ef5350' : '#ffffff';
      c.fillRect(i * 16, 0, 16, 32);
    }
    return new THREE.CanvasTexture(cv);
  }

  function onTable(x, z) {
    return x >= -TX_HALF && x <= TX_HALF && z >= TZ - TZ_HALF && z <= TZ + TZ_HALF;
  }

  // 缶が倒れて確定 → 得点
  function award(ctx, can, pts) {
    if (can.scored) return;
    can.scored = true;
    ctx.addScore(pts);
    ctx.sfx.score();
    ctx.vibrate(20);
  }

  function wakeCan(can, vx, vy, vz) {
    if (can.state === 1) return;
    can.state = 1;
    can.wobbleT = 0;
    can.mesh.rotation.set(0, 0, 0);
    can.vel.set(vx, vy, vz);
    can.spinX = (Math.random() - 0.5) * 8;
    can.spinZ = (Math.random() - 0.5) * 8;
  }

  // 弱い衝撃 → 倒れず「ガタッ」と揺れるだけ（揺れ中は必要衝撃が半減＝追い打ちチャンス）
  function wobbleCan(ctx, can) {
    can.wobbleT = WOBBLE_DUR;
    ctx.sfx.tap();
    ctx.vibrate(12);
  }

  // 缶の実効必要衝撃（揺れ中は半減以下）
  function reqOf(can) {
    return can.wobbleT > 0 ? can.req * 0.45 : can.req;
  }

  function anyDynamic() {
    for (var i = 0; i < activeCanCount; i++) if (cans[i].state === 1) return true;
    return false;
  }

  function roundRows(round) {
    var rows = [];
    var base = Math.min(round + 3, 9);
    var total = 0;
    for (var len = base; len >= 1 && total + len <= MAX_CANS; len--) {
      rows.push(len);
      total += len;
    }
    return rows;
  }

  function setupRound(ctx) {
    var rows = roundRows(roundNo);
    activeCanCount = 0;
    var rowStarts = [];
    for (var row = 0; row < rows.length; row++) {
      rowStarts[row] = activeCanCount;
      var load = rows.length - 1 - row; // 上に載っている段数 = 荷重
      for (var k = 0; k < rows[row]; k++) {
        var c = cans[activeCanCount];
        var x = (k - (rows[row] - 1) * 0.5) * 0.62;
        var y = TY + CAN_H / 2 + row * CAN_H;
        c.home.set(x, y, TZ);
        c.mesh.position.copy(c.home);
        c.mesh.rotation.set(0, 0, 0);
        c.mesh.visible = true;
        c.vel.set(0, 0, 0);
        c.state = 0;
        c.scored = false;
        c.supports = row === 0 ? null : [rowStarts[row - 1] + k, rowStarts[row - 1] + k + 1];
        // 荷重が大きい（下段）ほど強い衝撃でないと倒れない
        c.req = 3.2 + load * 1.35;
        c.wobbleT = 0;
        // 下段ほど濃いラベル＝「頑丈そう」の視覚記号
        c.mesh.material = [rowLabelMats[Math.min(load, rowLabelMats.length - 1)],
                           c.mesh.material[1], c.mesh.material[2]];
        activeCanCount++;
      }
    }
    for (var i = activeCanCount; i < cans.length; i++) {
      cans[i].mesh.visible = false;
      cans[i].state = 2;
      cans[i].scored = true;
      cans[i].supports = null;
    }
    ballsLeft = 3;
    resetBall(ctx);
    ctx.setHint(ctx.t({ en: 'Round ', ja: 'ラウンド', es: 'Ronda ', 'pt-BR': 'Rodada ', fr: 'Tour ', de: 'Runde ', it: 'Round ', ko: '라운드 ', 'zh-Hans': '第', tr: 'Tur ' }) + roundNo + ctx.t({ en: '! Cans: ', ja: '！カン', es: '! Latas: ', 'pt-BR': '! Latas: ', fr: ' ! Boîtes: ', de: '! Dosen: ', it: '! Lattine: ', ko: '! 캔: ', 'zh-Hans': '轮！罐子: ', tr: '! Kutu: ' }) + activeCanCount + ctx.t({ en: '!', ja: 'こ！', es: '!', 'pt-BR': '!', fr: ' !', de: '!', it: '!', ko: '개!', 'zh-Hans': '个！', tr: '!' }));
  }

  function resetBall(ctx) {
    ball.position.set(BALL_START[0], BALL_START[1], BALL_START[2]);
    ballVel.set(0, 0, 0);
    ball.visible = true;
    throwing = false;
    ballDone = false;
    turnT = 0;
    ctx.setHint(ctx.t({ en: 'Swipe to throw! Balls left: ', ja: 'スワイプでなげる！ のこり ', es: '¡Desliza para lanzar! Tiros: ', 'pt-BR': 'Deslize para lançar! Restam: ', fr: 'Glissez pour lancer ! Restants: ', de: 'Wischen zum Werfen! Übrig: ', it: 'Scorri per lanciare! Rimasti: ', ko: '스와이프로 던져! 남은 공: ', 'zh-Hans': '滑动投球！剩余: ', tr: 'Atmak için kaydır! Kalan: ' }) + ballsLeft + ctx.t({ en: '', ja: 'きゅう', es: '', 'pt-BR': '', fr: '', de: '', it: '', ko: '개', 'zh-Hans': '球', tr: '' }));
  }

  Shell.registerGame({
    id: 'TFCanTumble',
    title: { en: 'Can Tumble', ja: 'カンたおし', es: 'Derriba Latas', 'pt-BR': 'Derruba Latas', fr: 'Renverse les Boîtes', de: 'Dosen Werfen', it: 'Abbatti le Lattine', ko: '캔 쓰러뜨리기', 'zh-Hans': '打罐子', tr: 'Kutu Devir' },
    howto: { en: 'Swipe to throw — angle & power matter!\nBottom cans carry weight: hit them HARD!\nWobbling cans are easy to finish!', ja: 'スワイプでなげる！角度と強さが命\nしたのカンは おもくてかたい→つよく！\nゆれてるカンは 追いうちのチャンス！', es: '¡Desliza para lanzar: ángulo y fuerza!\nLas latas de abajo aguantan peso: ¡pégales FUERTE!\n¡Las que tiemblan caen fácil!', 'pt-BR': 'Deslize para lançar — ângulo e força!\nAs latas de baixo aguentam peso: acerte FORTE!\nLatas balançando caem fácil!', fr: 'Glissez pour lancer : angle et force !\nLes boîtes du bas portent du poids : frappez FORT !\nCelles qui tremblent tombent vite !', de: 'Wischen zum Werfen — Winkel & Kraft zählen!\nUntere Dosen tragen Gewicht: HART treffen!\nWackelnde Dosen fallen leicht!', it: 'Scorri per lanciare: angolo e forza!\nLe lattine in basso reggono peso: colpisci FORTE!\nQuelle che tremano cadono subito!', ko: '스와이프로 던져! 각도와 세기가 중요\n아래 캔은 무거워서 단단해→세게!\n흔들리는 캔은 마무리 찬스!', 'zh-Hans': '滑动投掷——角度和力度是关键！\n下层罐子承重更结实：用力砸！\n晃动的罐子一碰就倒！', tr: 'Kaydırarak fırlat — açı ve güç önemli!\nAlttaki kutular yük taşır: SERT vur!\nSallanan kutular kolay devrilir!' },
    scoreLabel: { en: 'pts', ja: 'ぽいんと', es: 'pts', 'pt-BR': 'pts', fr: 'pts', de: 'Pkt', it: 'pts', ko: '점', 'zh-Hans': '分', tr: 'puan' },
    bg: 0x1b2a4d,
    cameraFov: 60,
    cameraPos: [0, 2.6, 2.2],
    cameraLookAt: [0, 1.7, -6],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 夜の地面
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        Style.mat(0x4a4136)
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.scene.add(ground);
      // 月
      var moon = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 14, 12),
        new THREE.MeshBasicMaterial({ color: 0xfff3c4 })
      );
      moon.position.set(-8, 12, -24);
      ctx.scene.add(moon);

      // 屋台の台（天板＋脚）
      var woodMat = Style.mat(0x8d6e4a);
      var top = new THREE.Mesh(Style.roundedBox(TX_HALF * 2, 0.12, TZ_HALF * 2), woodMat);
      top.position.set(0, TY - 0.06, TZ);
      ctx.scene.add(top);
      var legGeo = Style.roundedBox(0.12, TY - 0.12, 0.12);
      for (var lx = -1; lx <= 1; lx += 2) {
        for (var lz = -1; lz <= 1; lz += 2) {
          var leg = new THREE.Mesh(legGeo, woodMat);
          leg.position.set(lx * (TX_HALF - 0.15), (TY - 0.12) / 2, TZ + lz * (TZ_HALF - 0.15));
          ctx.scene.add(leg);
        }
      }

      // 屋台の柱と屋根（紅白）
      var poleMat = Style.mat(0x6d4c2f);
      var poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8);
      for (var px = -1; px <= 1; px += 2) {
        var pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(px * 2.2, 1.6, TZ - 0.6);
        ctx.scene.add(pole);
      }
      var roof = new THREE.Mesh(
        new THREE.PlaneGeometry(5.2, 1.6),
        new THREE.MeshLambertMaterial({ map: stripeTexture(), side: THREE.DoubleSide })
      );
      roof.position.set(0, 3.5, TZ - 0.1);
      roof.rotation.x = -0.5;
      ctx.scene.add(roof);

      // 提灯（ゆらゆら）
      var lantMat = new THREE.MeshBasicMaterial({ color: 0xffb74d });
      var strMat = Style.mat(0x333333);
      for (var li = 0; li < 5; li++) {
        var grp = new THREE.Group();
        var str = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), strMat);
        str.position.y = -0.2;
        grp.add(str);
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lantMat);
        lamp.scale.y = 1.25;
        lamp.position.y = -0.62;
        grp.add(lamp);
        grp.position.set(-1.7 + li * 0.85, 3.1, TZ + 0.6);
        ctx.scene.add(grp);
        lanterns.push({ grp: grp, phase: li * 1.3 });
      }

      // 空き缶ピラミッド（最大45缶までのプール。テクスチャ・ジオメトリ共有）
      var canGeo = new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_H, 12);
      var canTex = canTexture();
      // 段（荷重）ごとのラベル材質: 荷重0=明るい → 荷重大=濃い（頑丈の記号）
      for (var rm = 0; rm < 9; rm++) {
        var shade = 1.0 - Math.min(rm, 6) * 0.09;
        var m2 = new THREE.MeshLambertMaterial({ map: canTex });
        m2.color.setRGB(shade, shade, shade);
        rowLabelMats.push(m2);
      }
      var lidMat = Style.mat(0xcfd8dc);
      var canMats = [rowLabelMats[0], lidMat, lidMat];
      for (var idx = 0; idx < MAX_CANS; idx++) {
        var mesh = new THREE.Mesh(canGeo, canMats);
        mesh.visible = false;
        ctx.scene.add(mesh);
        cans.push({
          mesh: mesh,
          home: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          state: 0, scored: false, spinX: 0, spinZ: 0,
          supports: null
        });
      }

      // 投げるボール
      ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 14, 12),
        new THREE.MeshPhongMaterial({ color: 0xffa726, shininess: 40 })
      );
      ballVel = new THREE.Vector3();
      ctx.scene.add(ball);
    },

    start: function (ctx) {
      roundNo = 1;
      activeCanCount = 0;
      ending = false; endT = 0;
      downX = 0; downY = 0;
      ctx.setScore(0);
      setupRound(ctx);
    },

    onPointerDown: function (ctx, p) {
      downX = p.x; downY = p.y;
    },

    onPointerUp: function (ctx, p) {
      if (throwing || ending || ballsLeft <= 0) return;
      var dy = downY - p.y; // 上向きスワイプ量(px)
      if (dy < 40) return;
      var power = Math.min(9 + (dy / ctx.height) * 16, 20);
      ballVel.set(
        Math.max(-3.5, Math.min(3.5, (p.x - downX) * 0.014)),
        2.0 + power * 0.18,
        -power
      );
      throwing = true;
      turnT = 0;
      ctx.setHint('');
      ctx.sfx.tap();
      ctx.vibrate(20);
    },

    update: function (ctx, dt) {
      var i, j, c;

      // 提灯のゆらゆら
      for (i = 0; i < lanterns.length; i++) {
        lanterns[i].grp.rotation.z = Math.sin(ctx.elapsed * 1.8 + lanterns[i].phase) * 0.12;
      }

      // ボール飛行
      if (throwing && !ballDone) {
        ballVel.y -= G * dt;
        ball.position.x += ballVel.x * dt;
        ball.position.y += ballVel.y * dt;
        ball.position.z += ballVel.z * dt;

        // 台にバウンド
        if (ballVel.y < 0 && onTable(ball.position.x, ball.position.z) &&
            ball.position.y <= TY + 0.22) {
          ball.position.y = TY + 0.22;
          ballVel.y *= -0.45;
          ballVel.x *= 0.7; ballVel.z *= 0.7;
          ctx.sfx.bounce();
        }
        // 地面にバウンド
        if (ball.position.y <= 0.22 && ballVel.y < 0) {
          ball.position.y = 0.22;
          ballVel.y *= -0.4;
          ballVel.x *= 0.6; ballVel.z *= 0.6;
        }
        // 止まった or 飛びすぎ
        if (ballVel.lengthSq() < 0.6 || ball.position.z < -20 || ball.position.z > 4) {
          ballDone = true;
        }

        // ボール vs 缶
        for (i = 0; i < cans.length; i++) {
          c = cans[i];
          if (!c.mesh.visible) continue;
          var dx = c.mesh.position.x - ball.position.x;
          var dyy = c.mesh.position.y - ball.position.y;
          var dz = c.mesh.position.z - ball.position.z;
          var d2 = dx * dx + dyy * dyy + dz * dz;
          if (d2 < 0.52 * 0.52) {
            if (c.state === 0) {
              // 衝撃 = ボール速度。荷重（必要衝撃）を越えないと倒れない
              var impact = ballVel.length();
              if (impact >= reqOf(c)) {
                wakeCan(c,
                  ballVel.x * 0.5,
                  Math.max(ballVel.y * 0.3, 0) + 1.5,
                  ballVel.z * 0.5);
                ctx.sfx.bounce();
                ctx.vibrate(25);
              } else {
                // 弱い！ガタッと揺れるだけ（揺れ中に追い打ちすれば倒せる）
                wobbleCan(ctx, c);
              }
            }
            ballVel.multiplyScalar(0.45);
            // 押し出し
            var d = Math.sqrt(d2) || 0.01;
            ball.position.x = c.mesh.position.x - dx / d * 0.53;
            ball.position.z = c.mesh.position.z - dz / d * 0.53;
          }
        }
      }

      // 缶の物理
      for (i = 0; i < cans.length; i++) {
        c = cans[i];

        // 揺れアニメ（弱い衝撃を受けた立ち缶。倒れやすい状態の可視化）
        if (c.state === 0 && c.wobbleT > 0) {
          c.wobbleT -= dt;
          if (c.wobbleT <= 0) {
            c.wobbleT = 0;
            c.mesh.rotation.z = 0;
            c.mesh.position.x = c.home.x;
          } else {
            var wamp = 0.1 * Math.min(c.wobbleT / 1.0, 1);
            c.mesh.rotation.z = Math.sin(ctx.elapsed * 26) * wamp;
            c.mesh.position.x = c.home.x + Math.sin(ctx.elapsed * 26) * wamp * 0.18;
          }
        }

        // 立っている缶: 支えを失うと崩れる
        if (c.state === 0 && c.supports) {
          for (j = 0; j < c.supports.length; j++) {
            var s = cans[c.supports[j]];
            var moved = Math.abs(s.mesh.position.x - s.home.x) +
                        Math.abs(s.mesh.position.z - s.home.z) +
                        Math.abs(s.mesh.position.y - s.home.y);
            if (s.state !== 0 || moved > 0.2) {
              wakeCan(c, (Math.random() - 0.5) * 1.2, 0.3, 0.3 + (Math.random() - 0.5) * 0.8);
              break;
            }
          }
        }

        if (c.state !== 1) continue;

        // 動いている缶
        c.vel.y -= G * dt;
        c.mesh.position.x += c.vel.x * dt;
        c.mesh.position.y += c.vel.y * dt;
        c.mesh.position.z += c.vel.z * dt;
        c.mesh.rotation.x += c.spinX * dt;
        c.mesh.rotation.z += c.spinZ * dt;

        // ほかの立ち缶を巻き込む
        for (j = 0; j < cans.length; j++) {
          if (i === j) continue;
          var o = cans[j];
          if (o.state !== 0) continue;
          var ddx = o.mesh.position.x - c.mesh.position.x;
          var ddy = o.mesh.position.y - c.mesh.position.y;
          var ddz = o.mesh.position.z - c.mesh.position.z;
          if (ddx * ddx + ddy * ddy + ddz * ddz < 0.6 * 0.6) {
            // 巻き込みも衝撃判定（倒れた缶がぶつかる勢い vs 相手の荷重）
            if (c.vel.length() >= reqOf(o) * 0.55) {
              wakeCan(o, c.vel.x * 0.6, 0.8, c.vel.z * 0.6 + 0.3);
            } else if (o.wobbleT <= 0) {
              wobbleCan(ctx, o);
            }
            c.vel.multiplyScalar(0.65);
          }
        }

        // 台の上に落ち着く
        if (c.vel.y < 0 && onTable(c.mesh.position.x, c.mesh.position.z) &&
            c.mesh.position.y <= TY + CAN_R) {
          if (c.vel.lengthSq() < 2.2 * 2.2) {
            c.mesh.position.y = TY + CAN_R;
            c.mesh.rotation.set((Math.random() - 0.5) * 0.3, 0, Math.PI / 2);
            c.vel.set(0, 0, 0);
            c.state = 2;
            award(ctx, c, 100); // 倒した！
          } else {
            c.mesh.position.y = TY + CAN_R;
            c.vel.y *= -0.35;
            c.vel.x *= 0.7; c.vel.z *= 0.7;
          }
        }
        // 地面に落ちた（台から落とした！）
        if (c.mesh.position.y <= CAN_R && c.vel.y < 0) {
          c.mesh.position.y = CAN_R;
          c.mesh.rotation.set((Math.random() - 0.5) * 0.3, 0, Math.PI / 2);
          c.vel.set(0, 0, 0);
          c.state = 2;
          award(ctx, c, 200);
        }
      }

      // ターン管理
      if (throwing && !ending) {
        turnT += dt;
        var settled = turnT > 3.4 || (ballDone && !anyDynamic() && turnT > 1.2);
        if (settled) {
          // まだ動きかけの缶は強制確定
          var allScored = true;
          for (i = 0; i < activeCanCount; i++) {
            c = cans[i];
            if (c.state === 1) {
              var offTable = !onTable(c.mesh.position.x, c.mesh.position.z) ||
                             c.mesh.position.y < TY - 0.2;
              c.vel.set(0, 0, 0);
              c.state = 2;
              c.mesh.rotation.set(0, 0, Math.PI / 2);
              c.mesh.position.y = offTable ? CAN_R : TY + CAN_R; // 空中固定を防ぐ
              award(ctx, c, offTable ? 200 : 100);
            }
            if (!c.scored) allScored = false;
          }
          ballsLeft--;
          if (allScored) {
            if (roundNo >= MAX_ROUND) {
              ending = true;
              endT = 0.8;
              ctx.sfx.success();
            } else {
              roundNo++;
              ctx.sfx.success();
              setupRound(ctx);
            }
          } else if (ballsLeft <= 0) {
            ending = true;
            endT = 0.8;
          } else {
            resetBall(ctx);
          }
        }
      }

      if (ending) {
        endT -= dt;
        if (endT <= 0) ctx.endGame(ctx.score);
      }
    }
  });
})();
