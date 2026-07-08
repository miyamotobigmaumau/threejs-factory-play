/* =========================================================================
 * TFSpinTop — コマまわし
 * ルール: 5びょう間スワイプ連打で回転をチャージ→CPUゴマと土俵で勝負。
 *        ぶつかると回転を削り合い、土俵外か先に倒れると負け。
 * 操作: チャージ中に画面を連続スワイプ（こするほどチャージ）
 * スコア: 勝ち抜き数 (しょう)
 * ========================================================================= */
(function () {
  'use strict';

  var topG, spinner, cpuTopG, cpuSpinner, windG, windRing, windDisc;
  var gaugeBar, gaugeBg;
  var blurP, blurC;         // 高回転時のモーションブラー円盤
  var sparks = [];          // 衝突・チャージの火花プール
  var demoEl;               // チャージ操作の指ゴーストデモ(DOM)
  var strokeFxCool, camShake;

  var CHARGE_TIME = 5;      // チャージ秒数
  var SPIN_MAX = 100;       // 回転量の上限
  var ARENA_R = 4.9;        // 土俵の内壁半径（コマ中心の可動域）
  var SPIN_VIS = 0.55;      // 見た目の回転倍率（ベイブレード感）

  // 状態
  var phase;                // 'charge' | 'drop' | 'spin' | 'roundWin' | 'fall'
  var spin, cpuSpin, chargeLeft, roundNo, wins, roundT, cpuOut, playerOut;
  var velX, velZ, cpuVelX, cpuVelZ, wandAX, wandAZ, wanderT;
  var windActive, windTimer, windLife;
  var spinStartE, wobPhase, cpuWobPhase, fallT, finalScore;

  // 火花を散らす（チャージのこすり・衝突で使用）
  function burstSparks(x, y, z, n, speed) {
    var used = 0;
    for (var i = 0; i < sparks.length && used < n; i++) {
      var s = sparks[i];
      if (s.life > 0) continue;
      var a = Math.random() * Math.PI * 2;
      s.life = 0.3 + Math.random() * 0.2;
      s.mesh.position.set(x, y, z);
      s.vx = Math.cos(a) * speed * (0.5 + Math.random());
      s.vy = 1.5 + Math.random() * 2.5;
      s.vz = Math.sin(a) * speed * (0.5 + Math.random());
      s.mesh.visible = true;
      used++;
    }
  }

  /* こま柄（渦巻き）を Canvas で生成 */
  function makeTopTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    var c = cv.getContext('2d');
    c.fillStyle = '#f7e8c8';
    c.fillRect(0, 0, 256, 256);
    var cols = ['#e53935', '#1e88e5', '#fdd835'];
    for (var k = 0; k < 3; k++) {
      c.strokeStyle = cols[k];
      c.lineWidth = 17;
      c.beginPath();
      var a0 = k * Math.PI * 2 / 3;
      for (var t = 0; t <= 1.001; t += 0.02) {
        var ang = a0 + t * Math.PI * 4;   // 2周の渦
        var r = 6 + t * 112;
        var x = 128 + Math.cos(ang) * r, y = 128 + Math.sin(ang) * r;
        if (t === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    return new THREE.CanvasTexture(cv);
  }

  function makeTop(THREE, bodyColor) {
    var g = new THREE.Group();           // 位置・かたむき用
    var spinGroup = new THREE.Group();   // 回転（rotation.y）用
    g.add(spinGroup);

    var matWood = Style.mat(0xb97b48);
    var matRed = Style.mat(bodyColor || 0xd84334);
    var tex = makeTopTexture(THREE);
    var matTopFace = new THREE.MeshLambertMaterial({ map: tex });

    // 先端（下向きコーン）
    var tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.8, 14), matWood);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.4;
    spinGroup.add(tip);
    // 胴（すそ広がり）
    var body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.55, 0.5, 20), matRed);
    body.position.y = 1.05;
    spinGroup.add(body);
    // 天板（渦巻き柄: [側面, 上面, 下面]）
    var disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 24),
      [matRed, matTopFace, matWood]);
    disc.position.y = 1.4;
    spinGroup.add(disc);
    // 軸
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 8), matWood);
    stem.position.y = 1.72;
    spinGroup.add(stem);
    return { group: g, spinner: spinGroup };
  }

  function startCharge(ctx) {
    phase = 'charge';
    spin = 0; cpuSpin = 45 + ctx.random() * 25;
    cpuSpin *= 1 + (roundNo - 1) * 0.1;
    chargeLeft = CHARGE_TIME;
    velX = velZ = cpuVelX = cpuVelZ = 0;
    playerOut = false; cpuOut = false;
    wobPhase = 0; cpuWobPhase = 0; fallT = 0; roundT = 0;
    topG.position.set(-1.6, 3, 0);
    cpuTopG.position.set(1.6, 3, 0);
    topG.rotation.set(0, 0, 0);
    cpuTopG.rotation.set(0, 0, 0);
    spinner.rotation.set(0, 0, 0);
    cpuSpinner.rotation.set(0, 0, 0);
    windG.visible = false;
    gaugeBar.style.width = '0%';
    gaugeBar.style.background = '#ff7043';
    gaugeBg.style.display = '';
    ctx.setHint(roundNo + ctx.t({ en: ' Round! Swipe to charge!', ja: 'かいせん！こすってチャージ！', es: ' Ronda! ¡Desliza para cargar!', 'pt-BR': ' Round! Deslize para carregar!', fr: ' Tour! Glissez pour charger!', de: ' Runde! Wische zum Laden!', it: ' Round! Scorri per caricare!', ko: ' 라운드! 스와이프로 충전!', 'zh-Hans': ' 局！滑动充能！', tr: ' Tur! Kaydırarak doldur!' }));
  }

  Shell.registerGame({
    id: 'TFSpinTop',
    title: { en: 'Spin Top', ja: 'コマまわし', es: 'Trompo', 'pt-BR': 'Pião', fr: 'Toupie', de: 'Kreisel', it: 'Trottola', ko: '팽이 대결', 'zh-Hans': '转陀螺', tr: 'Topaç' },
    howto: { en: 'Swipe for 5 sec to charge!\nBattle the CPU top\nFirst to fall loses!', ja: '5びょうかん こすってチャージ！\nCPUゴマと しょうぶするよ\nさきに たおれたら まけ', es: '¡Desliza 5 seg para cargar!\nBatalla contra el trompo CPU\n¡El que cae primero pierde!', 'pt-BR': 'Deslize por 5 seg para carregar!\nBatalle contra o pião CPU\nQuem cair primeiro perde!', fr: 'Glissez 5 sec pour charger!\nBataillez contre la toupie CPU\nLe premier à tomber perd!', de: '5 Sek wischen zum Laden!\nKreiselduel gegen CPU\nWer zuerst fällt, verliert!', it: 'Scorri 5 sec per caricare!\nSfida la trottola CPU\nChi cade per primo perde!', ko: '5초간 스와이프로 충전!\nCPU 팽이와 대결\n먼저 쓰러지면 패배!', 'zh-Hans': '滑动5秒充能！\n与CPU陀螺对战\n先倒下者输！', tr: '5 sn kaydırarak doldur!\nCPU topaçına karşı dövüş\nÖnce düşen kaybeder!' },
    scoreLabel: { en: 'win', ja: 'しょう', es: 'victoria', 'pt-BR': 'vitória', fr: 'victoire', de: 'Sieg', it: 'vittoria', ko: '승', 'zh-Hans': '胜', tr: 'galibiyet' },
    bg: 0xf0e0c0,
    cameraFov: 60,
    cameraPos: [0, 8.5, 11],
    cameraLookAt: [0, 1, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 座敷: 畳の床
      var tatami = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        Style.mat(0x97a25e)
      );
      tatami.rotation.x = -Math.PI / 2;
      tatami.position.y = -0.62;
      ctx.scene.add(tatami);
      // 畳のへり（濃い線）
      var heriMat = Style.mat(0x556033);
      for (var i = -2; i <= 2; i++) {
        var heri = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 60), heriMat);
        heri.rotation.x = -Math.PI / 2;
        heri.position.set(i * 8, -0.61, 0);
        ctx.scene.add(heri);
      }
      // 金屏風
      var byobu = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 9),
        Style.mat(0xd9b84a)
      );
      byobu.position.set(0, 3.8, -14);
      ctx.scene.add(byobu);
      var sun = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 24),
        new THREE.MeshBasicMaterial({ color: 0xd84334 })
      );
      sun.position.set(-6, 4.5, -13.9);
      ctx.scene.add(sun);

      // 土俵
      var dohyo = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 6.4, 0.6, 36),
        Style.mat(0xd8b878)
      );
      dohyo.position.y = -0.3;
      ctx.scene.add(dohyo);
      var rim = new THREE.Mesh(
        new THREE.TorusGeometry(6, 0.22, 10, 36),
        Style.mat(0x8a6a3c)
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.05;
      ctx.scene.add(rim);

      // おいかぜゾーン（リング＋薄い円盤、使い回し）
      windG = new THREE.Group();
      windRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.6, 0.09, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.9 })
      );
      windRing.rotation.x = -Math.PI / 2;
      windRing.position.y = 0.06;
      windDisc = new THREE.Mesh(
        new THREE.CircleGeometry(1.6, 24),
        new THREE.MeshBasicMaterial({ color: 0x80f0ff, transparent: true, opacity: 0.22 })
      );
      windDisc.rotation.x = -Math.PI / 2;
      windDisc.position.y = 0.05;
      windG.add(windRing, windDisc);
      windG.visible = false;
      ctx.scene.add(windG);

      // コマ
      var playerTop = makeTop(THREE, 0xd84334);
      topG = playerTop.group;
      spinner = playerTop.spinner;
      ctx.scene.add(topG);
      var cpuTop = makeTop(THREE, 0x1e88e5);
      cpuTopG = cpuTop.group;
      cpuSpinner = cpuTop.spinner;
      ctx.scene.add(cpuTopG);

      // チャージゲージ（DOM）
      gaugeBg = document.createElement('div');
      gaugeBg.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
        'width:60vw;height:14px;background:rgba(0,0,0,.25);border-radius:7px;z-index:11;display:none;';
      gaugeBar = document.createElement('div');
      gaugeBar.style.cssText = 'height:100%;width:0%;background:#ff7043;border-radius:7px;';
      gaugeBg.appendChild(gaugeBar);
      document.body.appendChild(gaugeBg);

      // 指ゴーストデモ（チャージのやり方を非言語で見せる。こすり始めたら消える）
      demoEl = document.createElement('div');
      demoEl.textContent = '👆';
      demoEl.style.cssText = 'position:fixed;left:50%;top:60%;z-index:14;font-size:52px;' +
        'pointer-events:none;transform:translate(-50%,-50%);display:none;' +
        'filter:drop-shadow(0 3px 5px rgba(0,0,0,.4));';
      document.body.appendChild(demoEl);

      // モーションブラー円盤（高回転の表現。外殻グループに追加＝自転しない）
      var blurGeo = new THREE.CircleGeometry(1.18, 28);
      blurP = new THREE.Mesh(blurGeo,
        new THREE.MeshBasicMaterial({ color: 0xffd0c0, transparent: true, opacity: 0, depthWrite: false }));
      blurP.rotation.x = -Math.PI / 2;
      blurP.position.y = 1.52;
      topG.add(blurP);
      blurC = new THREE.Mesh(blurGeo,
        new THREE.MeshBasicMaterial({ color: 0xc0d8ff, transparent: true, opacity: 0, depthWrite: false }));
      blurC.rotation.x = -Math.PI / 2;
      blurC.position.y = 1.52;
      cpuTopG.add(blurC);

      // 火花プール
      var sparkGeo = new THREE.SphereGeometry(0.09, 6, 4);
      for (var sp = 0; sp < 16; sp++) {
        var sm = new THREE.Mesh(sparkGeo,
          new THREE.MeshBasicMaterial({ color: 0xffe082 }));
        sm.visible = false;
        ctx.scene.add(sm);
        sparks.push({ mesh: sm, vx: 0, vy: 0, vz: 0, life: 0 });
      }
    },

    start: function (ctx) {
      roundNo = 1;
      wins = 0;
      velX = 0; velZ = 0; cpuVelX = 0; cpuVelZ = 0; wandAX = 0; wandAZ = 0; wanderT = 0;
      windActive = false; windTimer = 4; windLife = 0;
      finalScore = 0; spinStartE = 0;
      strokeFxCool = 0; camShake = 0;
      for (var si = 0; si < sparks.length; si++) { sparks[si].life = 0; sparks[si].mesh.visible = false; }
      cpuTopG.visible = true;
      ctx.setScore(0);
      startCharge(ctx);
    },

    onPointerDown: function (ctx, p) {
      if (phase === 'charge') spin = Math.min(SPIN_MAX, spin + 1);
    },

    onPointerMove: function (ctx, p) {
      if (phase === 'charge') {
        // スワイプ量ぶんチャージ
        spin = Math.min(SPIN_MAX, spin + (Math.abs(p.dx) + Math.abs(p.dy)) * 0.025);
        // こすった手応え: コマから火花＋短い音（絞り気味に）
        strokeFxCool -= 0.016;
        if (strokeFxCool <= 0 && (Math.abs(p.dx) + Math.abs(p.dy)) > 8) {
          strokeFxCool = 0.09;
          burstSparks(topG.position.x, 1.5, topG.position.z, 2, 1.6);
          if (Math.random() < 0.35) ctx.sfx.tap();
        }
      }
    },

    update: function (ctx, dt) {
      // 火花の更新（全フェーズ共通）
      for (var si = 0; si < sparks.length; si++) {
        var sk = sparks[si];
        if (sk.life <= 0) continue;
        sk.life -= dt;
        sk.vy -= 9 * dt;
        sk.mesh.position.x += sk.vx * dt;
        sk.mesh.position.y += sk.vy * dt;
        sk.mesh.position.z += sk.vz * dt;
        if (sk.life <= 0) sk.mesh.visible = false;
      }
      // 画面シェイク（衝突の衝撃）
      if (camShake > 0) {
        camShake -= dt;
        ctx.camera.position.x = Math.sin(camShake * 55) * 0.12 * camShake;
        ctx.camera.position.y = 8.5 + Math.sin(camShake * 47) * 0.08 * camShake;
        if (camShake <= 0) { ctx.camera.position.x = 0; ctx.camera.position.y = 8.5; }
      }
      // モーションブラー円盤: 回転が速いほど濃く（ベイブレード感）
      blurP.material.opacity = Math.min(0.5, Math.max(0, spin - 25) / SPIN_MAX * 0.75);
      blurC.material.opacity = Math.min(0.5, Math.max(0, cpuSpin - 25) / SPIN_MAX * 0.75);

      if (phase === 'charge') {
        chargeLeft -= dt;
        spinner.rotation.y += spin * SPIN_VIS * dt;
        cpuSpinner.rotation.y += cpuSpin * 0.2 * dt;
        gaugeBar.style.width = (spin / SPIN_MAX * 100) + '%';
        if (spin >= SPIN_MAX) gaugeBar.style.background = '#ffee58';
        // 指ゴーストデモ: こすり方を見せる（チャージが進んだら退場）
        if (spin < 14) {
          demoEl.style.display = '';
          var dp = ctx.elapsed * 7;
          demoEl.style.left = (50 + Math.sin(dp) * 13) + '%';
          demoEl.style.top = (58 + Math.cos(dp * 0.5) * 7) + '%';
        } else {
          demoEl.style.display = 'none';
        }
        ctx.setHint(roundNo + ctx.t({ en: ' Round! Time: ', ja: 'かいせん！ のこり ', es: ' Ronda! Tiempo: ', 'pt-BR': ' Round! Tempo: ', fr: ' Tour! Temps: ', de: ' Runde! Zeit: ', it: ' Round! Tempo: ', ko: ' 라운드! 남은 시간: ', 'zh-Hans': ' 局！剩余: ', tr: ' Tur! Süre: ' }) + Math.max(0, chargeLeft).toFixed(1));
        if (chargeLeft <= 0) {
          phase = 'drop';
          gaugeBg.style.display = 'none';
          demoEl.style.display = 'none';
          ctx.setHint('');
          ctx.sfx.tap();
        }
        return;
      }

      if (phase === 'drop') {
        spinner.rotation.y += spin * SPIN_VIS * dt;
        cpuSpinner.rotation.y += cpuSpin * SPIN_VIS * dt;
        topG.position.y -= 11 * dt;
        cpuTopG.position.y -= 11 * dt;
        if (topG.position.y <= 0) {
          topG.position.y = 0;
          cpuTopG.position.y = 0;
          phase = 'spin';
          // チャージが全くなかった場合でも最低限回転する
          if (spin < 5) spin = 5;
          spinStartE = ctx.elapsed;
          var a = ctx.random() * Math.PI * 2;
          velX = Math.cos(a) * 0.8;
          velZ = Math.sin(a) * 0.8;
          cpuVelX = -velX;
          cpuVelZ = -velZ;
          // 着地の衝撃（土煙がわりの火花＋シェイク）
          burstSparks(topG.position.x, 0.3, topG.position.z, 5, 2.5);
          burstSparks(cpuTopG.position.x, 0.3, cpuTopG.position.z, 5, 2.5);
          camShake = 0.3;
          ctx.sfx.bounce();
          ctx.vibrate(25);
          ctx.setHint(ctx.t({ en: 'Fight!', ja: 'はっけよい！', es: '¡Lucha!', 'pt-BR': 'Lute!', fr: 'Combat!', de: 'Los!', it: 'Via!', ko: '시작!', 'zh-Hans': '开始！', tr: 'Dövüş!' }));
        }
        return;
      }

      if (phase === 'spin') {
        spinner.rotation.y += spin * SPIN_VIS * dt;
        cpuSpinner.rotation.y += cpuSpin * SPIN_VIS * dt;

        // 摩擦減衰
        spin -= (2.1 + roundNo * 0.08) * dt;
        cpuSpin -= (2.0 + roundNo * 0.05) * dt;

        // ふらふら移動と、相手へ寄る力
        wanderT -= dt;
        if (wanderT <= 0) {
          wanderT = 0.7;
          wandAX = (ctx.random() - 0.5) * 1.4;
          wandAZ = (ctx.random() - 0.5) * 1.4;
        }
        var dx = cpuTopG.position.x - topG.position.x;
        var dz = cpuTopG.position.z - topG.position.z;
        var d2 = dx * dx + dz * dz;
        var invD = 1 / (Math.sqrt(d2) || 1);
        var ax = dx * invD * 1.1;
        var az = dz * invD * 1.1;
        velX += (wandAX + ax) * dt;
        velZ += (wandAZ + az) * dt;
        cpuVelX += (-wandAX * 0.8 - ax) * dt;
        cpuVelZ += (-wandAZ * 0.8 - az) * dt;
        var sp2 = velX * velX + velZ * velZ;
        if (sp2 > 6.76) { var s = 2.6 / Math.sqrt(sp2); velX *= s; velZ *= s; }
        var csp2 = cpuVelX * cpuVelX + cpuVelZ * cpuVelZ;
        if (csp2 > 6.76) { var cs = 2.6 / Math.sqrt(csp2); cpuVelX *= cs; cpuVelZ *= cs; }
        topG.position.x += velX * dt;
        topG.position.z += velZ * dt;
        cpuTopG.position.x += cpuVelX * dt;
        cpuTopG.position.z += cpuVelZ * dt;

        // 衝突: 運動量交換＋回転の削り合い（回転が強い方が優位＝チャージの意味）
        if (d2 < 1.7 * 1.7) {
          var nx = dx * invD, nz = dz * invD;
          var pv = velX * nx + velZ * nz;
          var cv = cpuVelX * nx + cpuVelZ * nz;
          var swap = pv - cv;
          velX -= swap * nx * 1.15;
          velZ -= swap * nz * 1.15;
          cpuVelX += swap * nx * 1.15;
          cpuVelZ += swap * nz * 1.15;
          topG.position.x -= nx * 0.09;
          topG.position.z -= nz * 0.09;
          cpuTopG.position.x += nx * 0.09;
          cpuTopG.position.z += nz * 0.09;
          // 回転差で削り量が変わる: 強い方は削られにくく、弱い方は大きく削られる
          var diff = spin - cpuSpin;
          spin = Math.max(0, spin - Math.max(0.8, 2.4 - diff * 0.05));
          cpuSpin = Math.max(0, cpuSpin - Math.max(0.8, 2.2 + diff * 0.06));
          // 激突の火花＋シェイク（ベイブレード感）
          var mx = (topG.position.x + cpuTopG.position.x) / 2;
          var mz = (topG.position.z + cpuTopG.position.z) / 2;
          burstSparks(mx, 1.2, mz, 8, 4.5);
          camShake = 0.25;
          ctx.sfx.bounce();
          ctx.vibrate(30);
        }

        var pd = Math.sqrt(topG.position.x * topG.position.x + topG.position.z * topG.position.z);
        var cd = Math.sqrt(cpuTopG.position.x * cpuTopG.position.x + cpuTopG.position.z * cpuTopG.position.z);
        playerOut = pd > ARENA_R || spin <= 2.5;
        cpuOut = cd > ARENA_R || cpuSpin <= 2.5;

        // 回転が弱いほど大きくみそすり運動
        var tiltF = Math.max(0, Math.min(1, 1 - spin / 22));
        var cpuTiltF = Math.max(0, Math.min(1, 1 - cpuSpin / 22));
        wobPhase += dt * (2.5 + spin * 0.12);
        cpuWobPhase += dt * (2.5 + cpuSpin * 0.12);
        topG.rotation.x = Math.sin(wobPhase) * tiltF * 0.45;
        topG.rotation.z = Math.cos(wobPhase) * tiltF * 0.45;
        cpuTopG.rotation.x = Math.sin(cpuWobPhase) * cpuTiltF * 0.45;
        cpuTopG.rotation.z = Math.cos(cpuWobPhase) * cpuTiltF * 0.45;

        if (playerOut && !cpuOut) {
          phase = 'fall';
          fallT = 0;
          finalScore = wins;
          ctx.sfx.bounce();
          ctx.vibrate(40);
          ctx.setHint(ctx.t({ en: 'You lost...', ja: 'まけ...', es: 'Perdiste...', 'pt-BR': 'Perdeu...', fr: 'Perdu...', de: 'Verloren...', it: 'Hai perso...', ko: '졌어...', 'zh-Hans': '输了...', tr: 'Kaybettin...' }));
        } else if (cpuOut && !playerOut) {
          wins++;
          ctx.setScore(wins);
          phase = 'roundWin';
          roundT = 1.0;
          ctx.sfx.success();
          ctx.vibrate(35);
          ctx.setHint(wins + ctx.t({ en: ' win(s)!', ja: 'しょう！', es: ' victoria(s)!', 'pt-BR': ' vitória(s)!', fr: ' victoire(s)!', de: ' Sieg(e)!', it: ' vittoria(e)!', ko: ' 승!', 'zh-Hans': ' 胜！', tr: ' galibiyet!' }));
        } else if (playerOut && cpuOut) {
          phase = 'fall';
          fallT = 0;
          finalScore = wins;
          ctx.sfx.fail();
          ctx.setHint(ctx.t({ en: 'Draw — you lose...', ja: 'ひきわけまけ...', es: 'Empate — pierdes...', 'pt-BR': 'Empate — perdeu...', fr: 'Nul — tu perds...', de: 'Unentschieden — du verlierst...', it: 'Pareggio — hai perso...', ko: '무승부 — 패배...', 'zh-Hans': '平局 — 你输了...', tr: 'Beraberlik — kaybettin...' }));
        }
        return;
      }

      if (phase === 'roundWin') {
        roundT -= dt;
        cpuTopG.rotation.z = Math.min(1.4, cpuTopG.rotation.z + dt * 3);
        if (roundT <= 0) {
          roundNo++;
          startCharge(ctx);
        }
        return;
      }

      if (phase === 'fall') {
        fallT += dt;
        var k = Math.min(1, fallT / 0.7);
        topG.rotation.z = k * 1.45;
        topG.rotation.x *= 0.9;
        topG.position.y = -k * 0.3;
        spinner.rotation.y += spin * 0.2 * (1 - k) * dt;
        if (fallT >= 0.9) ctx.gameOver(finalScore);
      }
    }
  });
})();
