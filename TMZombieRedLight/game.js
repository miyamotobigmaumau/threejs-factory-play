/* =========================================================================
 * TMZombieRedLight — ゾンビがころんだ（役割反転版）
 * ルール: プレイヤーはゾンビ。前方の人間に忍び寄れ。
 *   人間が振り向いている間に動くと見つかり、逃げられて終了。
 *   噛みつき距離まで近づいてタップで噛みつけばステージクリア→次の人間。
 * 操作: 長押しで前進。近づいたらタップで噛みつく。
 * マッシュアップ肝: 人間が振り向く直前に予兆（肩の動き＋効果音）。
 *   ステージが上がるほど振り向きが速く、フェイント（半回転で戻る）が増える。
 *   振り向き直前まで動くと「チキンボーナス」。
 * スコア: 累計距離 m（噛みつき＝ステージ分を加算）＋チキンボーナス
 * allowContinue: true → その場から再開
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------- 定数 ---------- */
  var START_Z = 8;        // プレイヤー（ゾンビ）開始Z
  var HUMAN_Z = -22;      // 人間の位置
  var BITE_DIST = 1.8;    // 噛みつき可能距離
  var COURSE_LEN = START_Z - (HUMAN_Z + BITE_DIST); // 1ステージの距離
  var MOVE_SPEED_BASE = 4.0;  // 最大前進速度(m/s)
  var ACCEL = 3.5;
  var DECEL = 6.0;
  var CHICKEN_BONUS = 3;      // ボーナス(m)

  /* ---------- 状態 ---------- */
  var playerZ, playerSpeed;
  var holding;
  var humanFacing;      // 'away' | 'turning' | 'watching' | 'away_return'
  var humanFaceTimer;
  var human, humanHead, humanShoulderL, humanShoulderR, humanShirtMat;
  var watchEye;         // 人間の頭上の「見ている」目アイコン
  var biteRing;         // 噛みつき圏内マーカー（足元の赤い円）
  var zombiePlayer, zombieArmL, zombieArmR;
  var floorMesh;
  var overFlag;         // 逃げられた/演出中
  var fledAnim;         // 人間逃走アニメ中
  var stageDist, totalDist, bonusDist;
  var stage;
  var fakeFlag;
  var humanBodyYaw;
  var biteAnimT;        // 噛みつきアニメ残り秒
  var biteLock;         // 噛みつき〜次ステージ準備中の連打ガード

  /* ---------- DOM ---------- */
  var warningDiv;
  var vignetteDiv;      // watching中の赤ビネット
  var vignetteVisible;

  function makeWarningDom() {
    if (warningDiv) return;
    warningDiv = document.createElement('div');
    warningDiv.id = 'tm-warn';
    warningDiv.style.cssText = [
      'position:fixed;top:22%;left:50%;transform:translateX(-50%);',
      'font-size:2em;font-weight:bold;color:#ff2222;',
      'text-shadow:0 2px 6px #000;pointer-events:none;z-index:20;display:none;',
      'white-space:nowrap;'
    ].join('');
    warningDiv.textContent = '⚠';
    document.body.appendChild(warningDiv);

    // 画面縁の赤ビネット（人間がこちらを見ている間だけ表示）
    vignetteDiv = document.createElement('div');
    vignetteDiv.style.cssText = [
      'position:fixed;top:0;left:0;right:0;bottom:0;',
      'pointer-events:none;z-index:19;display:none;',
      'box-shadow:inset 0 0 18vmin 4vmin rgba(255,0,0,0.5);'
    ].join('');
    document.body.appendChild(vignetteDiv);
    vignetteVisible = false;
  }

  function setVignette(on) {
    if (on === vignetteVisible) return;
    vignetteVisible = on;
    vignetteDiv.style.display = on ? '' : 'none';
  }

  function flashText(text, color, ms) {
    warningDiv.textContent = text;
    warningDiv.style.color = color || '#ff2222';
    warningDiv.style.display = '';
    if (ms) {
      setTimeout(function () {
        if (!overFlag) warningDiv.style.display = 'none';
      }, ms);
    }
  }

  /* ---------- メッシュ生成 ---------- */
  // 逃げる側の人間（ランドセルの子供）。
  // 顔は local +Z 側に作る: watching = rotation.y = 0（顔がプレイヤー/カメラ側）
  //                        away     = rotation.y = π（背中がこちら＝進んでよい）
  function makeHuman(THREE) {
    var g = new THREE.Group();
    var skin = Style.mat(0xf0c8a0);
    humanShirtMat = Style.mat(0xe05a5a);
    var pants = Style.mat(0x4a5a8a);
    var dark = Style.mat(0x5a3a2a);

    var torsoG = new THREE.Group();
    var torso = new THREE.Mesh(Style.roundedBox(0.6, 0.8, 0.35), humanShirtMat);
    torsoG.add(torso);

    // ランドセル（背中側 = local -Z … away(yaw=π)時にプレイヤーから見える）
    var randoseru = new THREE.Mesh(Style.roundedBox(0.45, 0.55, 0.22), Style.mat(0xc03030));
    randoseru.position.set(0, 0.05, -0.28);
    torsoG.add(randoseru);

    humanShoulderL = new THREE.Group();
    humanShoulderL.position.set(-0.4, 0.2, 0);
    var armL = new THREE.Mesh(Style.roundedBox(0.18, 0.55, 0.18), humanShirtMat);
    armL.position.y = -0.28;
    humanShoulderL.add(armL);
    torsoG.add(humanShoulderL);

    humanShoulderR = new THREE.Group();
    humanShoulderR.position.set(0.4, 0.2, 0);
    var armR = new THREE.Mesh(Style.roundedBox(0.18, 0.55, 0.18), humanShirtMat);
    armR.position.y = -0.28;
    humanShoulderR.add(armR);
    torsoG.add(humanShoulderR);

    torsoG.position.y = 0.95;
    g.add(torsoG);

    humanHead = new THREE.Group();
    humanHead.position.y = 1.55;
    var head = new THREE.Mesh(Style.roundedBox(0.48, 0.48, 0.44), skin);
    humanHead.add(head);
    // 帽子
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.14, 10), Style.mat(0xf2d54a));
    cap.position.y = 0.26;
    humanHead.add(cap);
    var brim = new THREE.Mesh(Style.roundedBox(0.3, 0.05, 0.2), Style.mat(0xf2d54a));
    brim.position.set(0, 0.2, 0.28); // 顔側（+Z が顔）
    humanHead.add(brim);
    // 目（顔は +Z 側: watching=yaw0 のときプレイヤー向き / away=π のとき奥向き）
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    [-0.12, 0.12].forEach(function (ex) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), eyeMat);
      eye.position.set(ex, 0.04, 0.23);
      humanHead.add(eye);
    });
    // 驚きの口
    var mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8), Style.mat(0x883333));
    mouth.rotation.x = Math.PI / 2;
    mouth.position.set(0, -0.12, 0.23);
    humanHead.add(mouth);
    g.add(humanHead);

    [[-0.18, 0], [0.18, 0]].forEach(function (pos) {
      var leg = new THREE.Mesh(Style.roundedBox(0.2, 0.65, 0.2), pants);
      leg.position.set(pos[0], 0.33, 0);
      g.add(leg);
    });

    // 頭上の「見ている」目アイコン（watching中のみ表示。watching時は
    // human.rotation.y=0 なので +Z がプレイヤー側を向く）
    watchEye = new THREE.Group();
    var eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eyeWhite.scale.set(1.5, 1, 0.5);
    watchEye.add(eyeWhite);
    var eyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eyePupil.position.set(0, 0, 0.14);
    watchEye.add(eyePupil);
    watchEye.position.y = 2.15;
    watchEye.visible = false;
    g.add(watchEye);

    // 噛みつき圏内マーカー（足元の赤い円）
    biteRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 24),
      new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.7, side: 2, depthWrite: false }));
    biteRing.rotation.x = -Math.PI / 2;
    biteRing.position.y = 0.02;
    biteRing.visible = false;
    g.add(biteRing);

    return g;
  }

  // プレイヤーのゾンビ（両腕を前に突き出したシルエット・背面ビュー）
  function makeZombiePlayer(THREE) {
    var g = new THREE.Group();
    var skin = Style.mat(0x7db87d);
    var cloth = Style.mat(0x556b55);
    var dark = Style.mat(0x334433);

    var torso = new THREE.Mesh(Style.roundedBox(0.7, 0.9, 0.4), cloth);
    torso.position.y = 0.95;
    g.add(torso);

    // 前に突き出した両腕（-Z 方向 = 進行方向）
    zombieArmL = new THREE.Group();
    zombieArmL.position.set(-0.42, 1.15, 0);
    var armL = new THREE.Mesh(Style.roundedBox(0.18, 0.18, 0.7), skin);
    armL.position.z = -0.38;
    zombieArmL.add(armL);
    g.add(zombieArmL);

    zombieArmR = new THREE.Group();
    zombieArmR.position.set(0.42, 1.15, 0);
    var armR = new THREE.Mesh(Style.roundedBox(0.18, 0.18, 0.7), skin);
    armR.position.z = -0.38;
    zombieArmR.add(armR);
    g.add(zombieArmR);

    var headG = new THREE.Group();
    headG.position.y = 1.55;
    var head = new THREE.Mesh(Style.roundedBox(0.5, 0.5, 0.45), skin);
    headG.add(head);
    // 目（黄色い光点・顔は -Z 側 = 進行方向）
    var zEyeMat = new THREE.MeshBasicMaterial({ color: 0xffe14a });
    [-0.12, 0.12].forEach(function (ex) {
      var ze = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), zEyeMat);
      ze.position.set(ex, 0.06, -0.24);
      headG.add(ze);
    });
    // 傾いた口（ゾンビらしい歪み）
    var zMouth = new THREE.Mesh(Style.roundedBox(0.2, 0.05, 0.03), dark);
    zMouth.rotation.z = 0.35;
    zMouth.position.set(0.02, -0.12, -0.24);
    headG.add(zMouth);
    g.add(headG);

    [[-0.2, 0], [0.2, 0]].forEach(function (pos) {
      var leg = new THREE.Mesh(Style.roundedBox(0.22, 0.7, 0.22), dark);
      leg.position.set(pos[0], 0.35, 0);
      g.add(leg);
    });

    return g;
  }

  /* ---------- ステージパラメータ ---------- */
  function stageParams(s) {
    var watchMin = Math.max(0.5, 1.8 - s * 0.15);
    var watchMax = Math.max(0.8, 2.8 - s * 0.2);
    var awayMin = Math.max(1.2, 2.5 - s * 0.15);
    var awayMax = Math.max(1.5, 4.0 - s * 0.2);
    var fakeProb = Math.min(0.5, 0.1 + s * 0.08);
    var turnSpeed = Math.min(12, 3.5 + s * 0.8);
    return { watchMin: watchMin, watchMax: watchMax, awayMin: awayMin, awayMax: awayMax,
             fakeProb: fakeProb, turnSpeed: turnSpeed };
  }

  function scheduleNextPhase(sp) {
    humanFacing = 'away';
    humanFaceTimer = sp.awayMin + Math.random() * (sp.awayMax - sp.awayMin);
    warningDiv.style.display = 'none';
  }

  var SHIRT_COLORS = [0xe05a5a, 0x5a8ae0, 0x5ac08a, 0xe0a05a, 0xb07ae0, 0xe07aa0];

  function resetHuman(s) {
    human.position.set(0, 0, HUMAN_Z);
    human.rotation.y = Math.PI;
    humanBodyYaw = Math.PI;
    humanHead.rotation.y = 0;
    humanShoulderL.rotation.z = 0;
    humanShoulderR.rotation.z = 0;
    humanShirtMat.color.setHex(SHIRT_COLORS[s % SHIRT_COLORS.length]);
    watchEye.visible = false;
    biteRing.visible = false;
    fledAnim = false;
  }

  /* ---------- Shell.registerGame ---------- */
  Shell.registerGame({
    id: 'TMZombieRedLight',
    title: { en: 'Zombie Red Light', ja: 'ゾンビがころんだ', es: 'Zombi Luz Roja', 'pt-BR': 'Zumbi Sinal Vermelho', fr: 'Zombie Feu Rouge', de: 'Zombie Rotes Licht', it: 'Zombie Semaforo Rosso', ko: '좀비 무궁화꽃이', 'zh-Hans': '僵尸红绿灯', tr: 'Zombi Kırmızı Işık' },
    howto: { en: 'Hold to sneak forward!\nFreeze when the human turns around!\nGet close then tap to bite!', ja: 'ながおしでしのびよる！\n人間がふりむいたら止まれ！\nちかづいてタップでかみつけ！', es: '¡Mantén pulsado para acercarte!\n¡Para cuando el humano se gire!\n¡Acércate y toca para morder!', 'pt-BR': 'Segure para se aproximar!\nPare quando o humano se virar!\nAproximou? Toque para morder!', fr: 'Maintenez pour ramper !\nStoppez quand l\'humain se retourne !\nApprochez puis touchez pour mordre !', de: 'Halten zum Schleichen!\nStoppen wenn der Mensch umschaut!\nNah ran dann tippen zum Beißen!', it: 'Tieni premuto per avvicinarti!\nFermati quando l\'umano si gira!\nAvvicinati poi tocca per mordere!', ko: '길게 눌러 살금살금!\n인간이 돌아보면 멈춰!\n가까워지면 탭해서 물어라!', 'zh-Hans': '长按悄悄靠近！\n人类转身时停下！\n靠近后点击咬他！', tr: 'Basılı tut ve gizlice yaklaş!\nİnsan döndüğünde dur!\nYaklaşınca ısırmak için dokun!' },
    scoreLabel: 'm',
    bg: 0x8a6b5a,
    fogNear: 20, fogFar: 55,
    cameraFov: 60,
    fitWidth: 7,
    cameraPos: [0, 4, 14],
    cameraLookAt: [0, 1, 0],
    allowContinue: true,

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 廊下床（夕暮れ学校・木板）
      var floorCv = document.createElement('canvas');
      floorCv.width = 128; floorCv.height = 512;
      var fcx = floorCv.getContext('2d');
      fcx.fillStyle = '#d4a96a';
      fcx.fillRect(0, 0, 128, 512);
      for (var fy = 0; fy < 512; fy += 32) {
        fcx.fillStyle = 'rgba(120,80,40,0.35)';
        fcx.fillRect(0, fy, 128, 2);
        fcx.fillStyle = 'rgba(255,230,180,0.'+ (fy % 96 === 0 ? '12' : '06') +')';
        fcx.fillRect(0, fy + 2, 128, 30);
      }
      fcx.fillStyle = 'rgba(120,80,40,0.3)';
      fcx.fillRect(63, 0, 2, 512);
      var floorTex = new THREE.CanvasTexture(floorCv);
      floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
      floorTex.repeat.set(2, 6);
      floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 50),
        new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 })
      );
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(0, 0, -12);
      ctx.scene.add(floorMesh);

      // 壁と夕焼けの窓
      var wallMat = Style.mat(0xe8d5b0);
      [-3.2, 3.2].forEach(function (wx) {
        var wall = new THREE.Mesh(new THREE.PlaneGeometry(50, 4), wallMat);
        wall.rotation.y = wx < 0 ? Math.PI / 2 : -Math.PI / 2;
        wall.position.set(wx, 2, -12);
        ctx.scene.add(wall);
        var winMat = new THREE.MeshBasicMaterial({ color: 0xffb74d });
        var frameMat = Style.mat(0x6d4c41);
        for (var wz = -32; wz <= 6; wz += 7) {
          var frame = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), frameMat);
          frame.rotation.y = wx < 0 ? Math.PI / 2 : -Math.PI / 2;
          frame.position.set(wx - (wx < 0 ? -0.01 : 0.01) * 1, 2.2, wz);
          ctx.scene.add(frame);
          var win = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.3), winMat);
          win.rotation.y = frame.rotation.y;
          win.position.set(wx - (wx < 0 ? -0.02 : 0.02) * 1, 2.2, wz);
          ctx.scene.add(win);
          var sashV = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 1.3), frameMat);
          sashV.rotation.y = frame.rotation.y;
          sashV.position.set(wx - (wx < 0 ? -0.03 : 0.03) * 1, 2.2, wz);
          ctx.scene.add(sashV);
        }
      });

      human = makeHuman(THREE);
      ctx.scene.add(human);

      zombiePlayer = makeZombiePlayer(THREE);
      ctx.scene.add(zombiePlayer);

      makeWarningDom();
    },

    start: function (ctx) {
      playerZ = START_Z;
      playerSpeed = 0;
      holding = false;
      overFlag = false;
      stageDist = 0;
      totalDist = 0;
      bonusDist = 0;
      stage = 0;
      fakeFlag = false;
      biteAnimT = 0;
      biteLock = false;

      zombiePlayer.position.set(0, 0, playerZ);
      resetHuman(0);
      warningDiv.style.display = 'none';
      setVignette(false);

      var sp = stageParams(stage);
      scheduleNextPhase(sp);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Hold to sneak forward!', ja: 'ながおしでしのびよれ！', es: '¡Mantén pulsado para acercarte!', 'pt-BR': 'Segure para se aproximar!', fr: 'Maintenez pour ramper !', de: 'Halten zum Schleichen!', it: 'Tieni premuto per avvicinarti!', ko: '길게 눌러 살금살금!', 'zh-Hans': '长按悄悄靠近！', tr: 'Basılı tut ve yaklaş!' }));
    },

    onContinue: function (ctx) {
      overFlag = false;
      playerSpeed = 0;
      biteLock = false;
      resetHuman(stage);
      var sp = stageParams(stage);
      scheduleNextPhase(sp);
      ctx.setHint(ctx.t({ en: 'Hold to sneak forward!', ja: 'ながおしでしのびよれ！', es: '¡Mantén pulsado para acercarte!', 'pt-BR': 'Segure para se aproximar!', fr: 'Maintenez pour ramper !', de: 'Halten zum Schleichen!', it: 'Tieni premuto per avvicinarti!', ko: '길게 눌러 살금살금!', 'zh-Hans': '长按悄悄靠近！', tr: 'Basılı tut ve yaklaş!' }));
    },

    onPointerDown: function (ctx, p) {
      holding = true;

      if (overFlag || biteLock) return;
      // 噛みつき判定
      var dist = playerZ - HUMAN_Z;
      if (dist <= BITE_DIST + 0.2) {
        if (humanFacing === 'watching') {
          // 見られている時に飛びかかる → 逃げられる
          this._flee(ctx);
        } else {
          this._bite(ctx);
        }
      }
    },

    onPointerUp: function (ctx, p) {
      holding = false;
    },

    /* --- 内部: 噛みつき成功 --- */
    _bite: function (ctx) {
      biteLock = true;
      biteAnimT = 0.4;
      stage++;
      totalDist = stage * COURSE_LEN;
      stageDist = 0;
      ctx.sfx.success();
      ctx.vibrate(80);
      flashText('🧟', '#66dd44', 900);
      ctx.setScore(Math.floor(totalDist + bonusDist));

      // 次のステージへリセット
      setTimeout(function () {
        if (overFlag) return;
        playerZ = START_Z;
        playerSpeed = 0;
        zombiePlayer.position.set(0, 0, playerZ);
        resetHuman(stage);
        var sp = stageParams(stage);
        scheduleNextPhase(sp);
        biteLock = false;
        ctx.setHint(ctx.t({ en: 'Stage ', ja: 'ステージ', es: 'Nivel ', 'pt-BR': 'Fase ', fr: 'Étape ', de: 'Stufe ', it: 'Livello ', ko: '스테이지 ', 'zh-Hans': '第', tr: 'Aşama ' }) + stage + ctx.t({ en: ' clear! Next human is faster!', ja: 'クリア！つぎの人間はすばやい！', es: ' superado! ¡El siguiente humano es más rápido!', 'pt-BR': ' completa! O próximo humano é mais rápido!', fr: ' terminée ! L\'humain suivant est plus rapide !', de: ' geschafft! Nächster Mensch ist schneller!', it: ' superato! Il prossimo umano è più veloce!', ko: ' 클리어! 다음 인간은 더 빠르다!', 'zh-Hans': ' 通关！下一个人类更快！', tr: ' tamamlandı! Sonraki insan daha hızlı!' }));
      }, 450);
    },

    /* --- 内部: 見つかって逃げられる --- */
    _flee: function (ctx) {
      overFlag = true;
      fledAnim = true;
      setVignette(false);
      watchEye.visible = false;
      biteRing.visible = false;
      ctx.sfx.fail();
      ctx.vibrate(100);
      flashText('😱', '#ff2222');
      setTimeout(function () {
        ctx.gameOver(Math.floor(totalDist + stageDist + bonusDist));
      }, 900);
    },

    update: function (ctx, dt) {
      // 逃走アニメ（人間が走り去る）
      if (fledAnim) {
        human.rotation.y = Math.PI; // 奥へ向いて
        human.position.z -= 14 * dt;
        human.position.y = Math.abs(Math.sin(ctx.elapsed * 14)) * 0.12;
        return;
      }
      if (overFlag) return;

      // 噛みつき〜リセット間: 演出のみ（移動・状態機械・スコア更新を止める）
      if (biteLock) {
        if (biteAnimT > 0) {
          biteAnimT -= dt;
          zombiePlayer.rotation.x = -Math.sin(Math.max(0, biteAnimT) / 0.4 * Math.PI) * 0.5;
        } else {
          zombiePlayer.rotation.x = 0;
        }
        return;
      }

      var sp = stageParams(stage);

      /* --- プレイヤー移動 --- */
      if (holding) {
        playerSpeed = Math.min(MOVE_SPEED_BASE, playerSpeed + ACCEL * dt);
      } else {
        playerSpeed = Math.max(0, playerSpeed - DECEL * dt);
      }

      // 「watching」中に動いていたら見つかる → 逃げられる
      if (humanFacing === 'watching' && playerSpeed > 0.15) {
        this._flee(ctx);
        return;
      }

      if (humanFacing !== 'watching') {
        var maxZ = HUMAN_Z + BITE_DIST * 0.6; // 人間にめり込まない
        playerZ = Math.max(maxZ, playerZ - playerSpeed * dt);
        stageDist = Math.min(COURSE_LEN, START_Z - playerZ);
        ctx.setScore(Math.floor(totalDist + stageDist + bonusDist));
      }

      zombiePlayer.position.set(0, 0, playerZ);

      // ゾンビの歩き（ゆらゆら＋腕の上下）
      if (playerSpeed > 0.1) {
        zombiePlayer.position.y = Math.abs(Math.sin(ctx.elapsed * 6)) * 0.06;
        zombiePlayer.rotation.z = Math.sin(ctx.elapsed * 6) * 0.05;
        zombieArmL.rotation.x = Math.sin(ctx.elapsed * 6) * 0.15;
        zombieArmR.rotation.x = -Math.sin(ctx.elapsed * 6) * 0.15;
      } else {
        zombiePlayer.rotation.z *= 0.9;
      }

      // 噛みつきアニメ（前のめり）
      if (biteAnimT > 0) {
        biteAnimT -= dt;
        zombiePlayer.rotation.x = -Math.sin(Math.max(0, biteAnimT) / 0.4 * Math.PI) * 0.5;
      } else {
        zombiePlayer.rotation.x = 0;
      }

      /* --- 危険サイン: watching中は赤ビネット＋頭上の目アイコン --- */
      var watching = (humanFacing === 'watching');
      setVignette(watching);
      watchEye.visible = watching;
      if (watching) {
        watchEye.position.y = 2.15 + Math.sin(ctx.elapsed * 6) * 0.06;
      }

      // 噛みつき圏内マーカー（足元の赤い円・脈動）
      var dist = playerZ - HUMAN_Z;
      var inBiteRange = dist <= BITE_DIST + 0.2;
      biteRing.visible = inBiteRange;
      if (inBiteRange) {
        biteRing.material.opacity = 0.5 + Math.sin(ctx.elapsed * 10) * 0.3;
      }

      // 噛みつき圏内ヒント
      if (dist <= BITE_DIST + 0.2 && humanFacing !== 'watching' && biteAnimT <= 0) {
        ctx.setHint(ctx.t({ en: 'Tap to bite!', ja: 'タップでかみつけ！', es: '¡Toca para morder!', 'pt-BR': 'Toque para morder!', fr: 'Touchez pour mordre !', de: 'Tippe zum Beißen!', it: 'Tocca per mordere!', ko: '탭해서 물어라!', 'zh-Hans': '点击咬他！', tr: 'Isırmak için dokun!' }));
      }

      // カメラ追従
      ctx.camera.position.z = playerZ + 13;
      ctx.camera.position.y = 4;
      ctx.camera.lookAt(0, 1, playerZ + 2);

      /* --- 人間の状態機械 --- */
      humanFaceTimer -= dt;

      if (humanFacing === 'away') {
        // 後ろ向き（歩き続ける小芝居: その場で腕振り）
        humanShoulderL.rotation.x = Math.sin(ctx.elapsed * 4) * 0.2;
        humanShoulderR.rotation.x = -Math.sin(ctx.elapsed * 4) * 0.2;
        // 残り0.5秒で予兆（肩がピクッ＋ハッ…）
        if (humanFaceTimer < 0.5) {
          var shake = Math.sin(ctx.elapsed * 20) * 0.08;
          humanShoulderL.rotation.z = shake;
          humanShoulderR.rotation.z = -shake;
          warningDiv.textContent = '⚠';
          warningDiv.style.color = '#ff2222';
          warningDiv.style.display = '';
        }
        if (humanFaceTimer <= 0) {
          // チキンボーナス判定: 振り向き開始時点でまだ勢いよく動いていたか
          // （惰性減速の残り速度では発動しない = ギリギリまで粘った時だけ）
          if (playerSpeed > 2.5) {
            bonusDist += CHICKEN_BONUS;
            ctx.sfx.score();
            flashText('🐔 +' + CHICKEN_BONUS, '#ffcc00', 700);
            ctx.setScore(Math.floor(totalDist + stageDist + bonusDist));
          }
          fakeFlag = Math.random() < sp.fakeProb;
          humanFacing = 'turning';
          humanShoulderL.rotation.z = 0;
          humanShoulderR.rotation.z = 0;
          humanShoulderL.rotation.x = 0;
          humanShoulderR.rotation.x = 0;
          if (warningDiv.textContent === '⚠') warningDiv.style.display = 'none';
        }
      } else if (humanFacing === 'turning') {
        var targetYaw = fakeFlag ? Math.PI * 0.5 : 0;
        var diff = Math.atan2(Math.sin(targetYaw - humanBodyYaw), Math.cos(targetYaw - humanBodyYaw));
        if (Math.abs(diff) < 0.05) {
          humanBodyYaw = targetYaw;
          if (fakeFlag) {
            fakeFlag = false;
            humanFacing = 'away';
            humanFaceTimer = 0.3;
          } else {
            humanFacing = 'watching';
            humanFaceTimer = sp.watchMin + Math.random() * (sp.watchMax - sp.watchMin);
          }
        } else {
          humanBodyYaw += Math.sign(diff) * sp.turnSpeed * dt;
        }
        human.rotation.y = humanBodyYaw;
        // 頭だけ先に振り向く（body yaw π→0 に対して頭が先行 = 相対ヨーをマイナス側へ）
        humanHead.rotation.y = Math.max(-0.6, (humanBodyYaw - Math.PI) * 0.5);
      } else if (humanFacing === 'watching') {
        humanBodyYaw = 0;
        human.rotation.y = 0;
        humanHead.rotation.y = 0;
        if (humanFaceTimer <= 0) {
          fakeFlag = false;
          humanBodyYaw = 0;
          humanFacing = 'away_return';
          humanFaceTimer = 0;
        }
      } else if (humanFacing === 'away_return') {
        var retDiff = Math.atan2(Math.sin(Math.PI - humanBodyYaw), Math.cos(Math.PI - humanBodyYaw));
        if (Math.abs(retDiff) < 0.05) {
          humanBodyYaw = Math.PI;
          human.rotation.y = Math.PI;
          scheduleNextPhase(sp);
        } else {
          humanBodyYaw += Math.sign(retDiff) * sp.turnSpeed * dt;
          human.rotation.y = humanBodyYaw;
        }
      }
    }
  });
})();
