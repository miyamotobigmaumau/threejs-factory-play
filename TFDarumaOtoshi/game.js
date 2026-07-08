/* =========================================================================
 * TFDarumaOtoshi — だるまおとし
 * ルール: 左右に往復するハンマーが中央（判定窓内）に来た瞬間にタップすると
 *        いちばん下の段が吹き飛び、上が落ちてくる。窓は抜くほど狭くなる。
 *        外すと積みが崩れて終了。セットごとに段数が増える。
 * スコア: 抜いた段数 (だん)
 * ========================================================================= */
(function () {
  'use strict';

  var tierMeshes = [], tiers = [], head, hammer;
  var flying = [];   // 吹き飛び/崩れ中のピース {mesh, vx, vy, vr, active}
  var winZoneL, winZoneR, hitRings = [], dusts = [], stackShadow;
  var hammerPhase, speed, winNow, removed, setCount, setTierCount;
  var state, dropRemain, strikeT, failT, headVy, celebT;
  // state: 0=プレイ 1=落下アニメ 2=崩壊演出 3=セット完了演出

  var G = 12, TIER_H = 0.6, BASE_Y = 0.48, AMP = 2.2;
  // シェル照明で白飛びするため彩度高め・2割暗めの段色
  var TIER_COLORS = [0xb83227, 0x2874a6, 0xc9a015, 0x239b56, 0x7d3c98];

  function makeTatamiTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    g.fillStyle = '#8aa864';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#7a9758';
    g.lineWidth = 2;
    for (var y = 8; y < 128; y += 10) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke();
    }
    g.strokeStyle = '#46603a';
    g.lineWidth = 6;
    g.strokeRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    return tex;
  }

  function makeFaceTexture(THREE) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    // 白い顔面
    g.fillStyle = '#fdf3e3';
    g.beginPath(); g.ellipse(64, 68, 46, 52, 0, 0, Math.PI * 2); g.fill();
    // まゆ
    g.strokeStyle = '#222';
    g.lineWidth = 5;
    g.beginPath(); g.arc(44, 52, 12, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.beginPath(); g.arc(84, 52, 12, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    // 目
    g.fillStyle = '#222';
    g.beginPath(); g.arc(44, 66, 9, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(84, 66, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(47, 63, 3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(87, 63, 3, 0, Math.PI * 2); g.fill();
    // ひげと口
    g.strokeStyle = '#333';
    g.lineWidth = 3;
    g.beginPath(); g.arc(64, 92, 14, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.beginPath(); g.moveTo(30, 84); g.lineTo(48, 88); g.stroke();
    g.beginPath(); g.moveTo(98, 84); g.lineTo(80, 88); g.stroke();
    return new THREE.CanvasTexture(cv);
  }

  function headTopY() { return 0.18 + tiers.length * TIER_H + 0.85; }

  function buildSet() {
    // 前セットの吹き飛び中ピース（同じメッシュを再利用する）を必ず解放しておく
    for (var f = 0; f < flying.length; f++) flying[f].active = false;
    tiers.length = 0;
    setTierCount = Math.min(3 + setCount, 9);
    for (var i = 0; i < tierMeshes.length; i++) tierMeshes[i].visible = false;
    for (i = 0; i < setTierCount; i++) {
      var m = tierMeshes[i];
      m.visible = true;
      m.position.set(0, BASE_Y + i * TIER_H, 0);
      m.rotation.set(0, 0, 0);
      tiers.push(m);
    }
    head.visible = true;
    head.position.set(0, headTopY(), 0);
    head.rotation.set(0, 0, 0);
    winNow = Math.max(0.8 - setCount * 0.08, 0.34);
  }

  function toFly(mesh, vx, vy, vr) {
    for (var i = 0; i < flying.length; i++) {
      if (!flying[i].active) {
        flying[i].active = true;
        flying[i].mesh = mesh;
        flying[i].vx = vx; flying[i].vy = vy; flying[i].vr = vr;
        return;
      }
    }
  }

  Shell.registerGame({
    id: 'TFDarumaOtoshi',
    title: { en: 'Daruma Drop', ja: 'だるまおとし', es: 'Derrumba el Daruma', 'pt-BR': 'Derruba o Daruma', fr: 'Daruma Tombant', de: 'Daruma-Schlag', it: 'Abbatti il Daruma', ko: '다루마 떨어뜨리기', 'zh-Hans': '打达摩', tr: 'Daruma Düşür' },
    howto: { en: 'Tap when the hammer is in the center!\nClear all tiers to add more!\nMiss and it collapses!', ja: 'ハンマーが まんなかなら タップ！\nぜんぶぬくと だんがふえるよ\nはずすと くずれちゃう', es: '¡Toca cuando el martillo esté en el centro!\n¡Elimina todos los niveles para añadir más!\n¡Falla y se derrumba!', 'pt-BR': 'Toque quando o martelo estiver no centro!\nEliminar tudo adiciona mais andares!\nErre e tudo desmorona!', fr: 'Touchez quand le marteau est au centre !\nEliminez tous les étages pour en avoir plus !\nRatez et tout s\'effondre !', de: 'Tippe wenn der Hammer in der Mitte ist!\nAlle Etagen entfernen bringt mehr!\nVerpassen und alles stürzt ein!', it: 'Tocca quando il martello è al centro!\nElimina tutti i livelli per aggiungerne altri!\nManca e tutto crolla!', ko: '해머가 가운데일 때 탭!\n전부 빼면 단이 늘어나!\n놓치면 무너져!', 'zh-Hans': '锤子在中间时点击！\n全部抽出后段数增加！\n失误会倒塌！', tr: 'Çekiç ortadayken dokun!\nHepsini çıkarınca daha fazla katman eklenir!\nKaçırırsan çöker!' },
    scoreLabel: { en: 'tiers', ja: 'だん', es: 'niveles', 'pt-BR': 'andares', fr: 'étages', de: 'Etagen', it: 'livelli', ko: '단', 'zh-Hans': '层', tr: 'kat' },
    bg: 0xf5e3c8,
    cameraFov: 55,
    cameraPos: [0, 3.6, 7.5],
    cameraLookAt: [0, 2.0, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 畳の床
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshLambertMaterial({ map: makeTatamiTexture(THREE) })
      );
      floor.rotation.x = -Math.PI / 2;
      ctx.scene.add(floor);

      // 奥の壁（和室ふう）
      var wall = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 10),
        Style.mat(0xe8d9b8)
      );
      wall.position.set(0, 5, -8);
      ctx.scene.add(wall);
      var beamMat = Style.mat(0x6b4a2f);
      for (var b = 0; b < 4; b++) {
        var beam = new THREE.Mesh(Style.roundedBox(0.25, 10, 0.15), beamMat);
        beam.position.set(b * 5 - 7.5, 5, -7.9);
        ctx.scene.add(beam);
      }

      // 丸窓（雪見障子ふう）＋庭の緑：上部の空白を埋める遠景
      var madoFrame = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.14, 10, 28), Style.mat(0x5a3d28));
      madoFrame.position.set(-4.2, 6.4, -7.7);
      ctx.scene.add(madoFrame);
      var madoGlass = new THREE.Mesh(new THREE.CircleGeometry(1.5, 28), Style.mat(0x9cc47a));
      madoGlass.position.set(-4.2, 6.4, -7.75);
      ctx.scene.add(madoGlass);
      var bush = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), Style.mat(0x4e8c3a));
      bush.position.set(-4.2, 5.6, -7.6); bush.scale.set(1.3, 0.7, 1);
      ctx.scene.add(bush);
      // 掛け軸
      var scroll = new THREE.Mesh(Style.roundedBox(1.3, 3.4, 0.05), Style.mat(0xefe4cf));
      scroll.position.set(4.0, 6.2, -7.7);
      ctx.scene.add(scroll);
      var scrollArt = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0xc0392b }));
      scrollArt.position.set(4.0, 6.6, -7.65);
      ctx.scene.add(scrollArt);
      // 吊り提灯 ×2（暖色の明かり）
      for (var la = 0; la < 2; la++) {
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffb14d }));
        lamp.scale.y = 1.25;
        lamp.position.set(la === 0 ? -2.3 : 2.3, 8.4, -6.5);
        ctx.scene.add(lamp);
        var cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), Style.mat(0x333333));
        cord.position.set(la === 0 ? -2.3 : 2.3, 9.5, -6.5);
        ctx.scene.add(cord);
      }

      // 座布団
      var zabuton = new THREE.Mesh(
        Style.roundedBox(2.6, 0.18, 2.6),
        Style.mat(0x7d5ba6)
      );
      zabuton.position.y = 0.09;
      ctx.scene.add(zabuton);

      // 判定窓の可視化：中央の許容ゾーンを床に半透明の帯で表示（左右2枚で幅を可変）
      var zoneMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
      winZoneL = new THREE.Mesh(new THREE.PlaneGeometry(1, 3.4), zoneMat);
      winZoneL.rotation.x = -Math.PI / 2;
      winZoneL.position.set(0, 0.2, 0.6);
      ctx.scene.add(winZoneL);
      // 窓の縁を示す2本のポール（左右の合図）
      var edgeMat = new THREE.MeshBasicMaterial({ color: 0x27ae60 });
      winZoneR = new THREE.Group();
      // 床際の低い標識コーン（達磨と干渉しない高さ）
      var eL = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), edgeMat);
      var eR = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), edgeMat);
      winZoneR.add(eL); winZoneR.add(eR);
      winZoneR.userData = { eL: eL, eR: eR };
      ctx.scene.add(winZoneR);

      // 胴体（9段までのプール。毎セット再利用）
      var tierGeo = new THREE.CylinderGeometry(0.85, 0.85, TIER_H, 20);
      for (var i = 0; i < 9; i++) {
        var t = new THREE.Mesh(tierGeo,
          Style.mat(TIER_COLORS[i % TIER_COLORS.length]));
        ctx.scene.add(t);
        tierMeshes.push(t);
      }

      // だるまの頭（赤い球＋Canvas の顔プレート）
      head = new THREE.Group();
      var skull = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 16, 14),
        Style.mat(0xc0392b)
      );
      var face = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 20),
        new THREE.MeshBasicMaterial({ map: makeFaceTexture(THREE), transparent: true })
      );
      face.position.z = 0.78;
      head.add(skull, face);
      ctx.scene.add(head);

      // ハンマー（頭が横向きの木づち）
      hammer = new THREE.Group();
      var hhead = new THREE.Mesh(
        Style.roundedBox(0.55, 0.5, 0.9),
        Style.mat(0x9c7040)
      );
      var handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8),
        Style.mat(0xc9a06a)
      );
      handle.rotation.x = Math.PI / 2;
      handle.position.z = 1.0;
      hammer.add(hhead, handle);
      hammer.position.set(0, BASE_Y, 1.5);
      ctx.scene.add(hammer);

      // 積みの接地シャドウ
      stackShadow = Style.softShadow(1.3);
      stackShadow.position.set(0, 0.19, 0);
      ctx.scene.add(stackShadow);

      // ヒット成功リング（金・拡散）プール
      for (var r = 0; r < 4; r++) {
        var ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 24),
          new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        ctx.scene.add(ring);
        hitRings.push({ mesh: ring, t: 0, active: false });
      }
      // 砂ぼこりプール
      var dustGeo = new THREE.SphereGeometry(0.13, 6, 5);
      for (var d = 0; d < 10; d++) {
        var dm = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: 0xd8c9a8, transparent: true, opacity: 0 }));
        dm.visible = false;
        ctx.scene.add(dm);
        dusts.push({ mesh: dm, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      // 吹き飛びプール（9段＋頭）
      for (var f = 0; f < 10; f++) flying.push({ mesh: null, vx: 0, vy: 0, vr: 0, active: false });
    },

    _spawnRing: function (y) {
      for (var i = 0; i < hitRings.length; i++) {
        if (!hitRings[i].active) {
          hitRings[i].active = true; hitRings[i].t = 0;
          hitRings[i].mesh.position.set(0, y, 0);
          hitRings[i].mesh.visible = true;
          return;
        }
      }
    },

    _spawnDust: function (y) {
      var n = 0;
      for (var i = 0; i < dusts.length && n < 6; i++) {
        if (dusts[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        dusts[i].life = 0.45;
        dusts[i].vx = Math.cos(a) * (1.5 + Math.random());
        dusts[i].vy = 0.8 + Math.random();
        dusts[i].vz = Math.sin(a) * (1.5 + Math.random());
        dusts[i].mesh.position.set(0, y, 0);
        dusts[i].mesh.material.opacity = 0.7;
        dusts[i].mesh.visible = true;
        n++;
      }
    },

    start: function (ctx) {
      hammerPhase = 0; speed = 2.2; removed = 0; setCount = 0;
      state = 0; dropRemain = 0; strikeT = 0; failT = 0; headVy = 0; celebT = 0;
      for (var i = 0; i < flying.length; i++) flying[i].active = false;
      buildSet();
      hammer.position.set(0, BASE_Y, 1.5);
      ctx.setHint(ctx.t({ en: 'Tap when in the center!', ja: 'まんなかで タップ！', es: '¡Toca cuando esté en el centro!', 'pt-BR': 'Toque quando estiver no centro!', fr: 'Touchez quand c\'est au centre !', de: 'Tippe wenn es in der Mitte ist!', it: 'Tocca quando è al centro!', ko: '가운데일 때 탭!', 'zh-Hans': '在中间时点击！', tr: 'Ortadayken dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      if (state !== 0) return;
      strikeT = 0.18; // 空振りでもスイングは見せる
      var hx = hammer.position.x;
      if (Math.abs(hx) <= winNow) {
        // ヒット！ 最下段が吹き飛ぶ
        removed++;
        ctx.addScore(1);
        ctx.sfx.bounce();
        ctx.vibrate(25);
        var bottom = tiers.shift();
        var dir = Math.cos(hammerPhase) >= 0 ? 1 : -1; // ハンマーの進行方向へ
        toFly(bottom, dir * (6 + Math.random() * 2), 2.5, dir * (4 + Math.random() * 3));
        this._spawnRing(bottom.position.y);
        this._spawnDust(BASE_Y);
        winNow = Math.max(winNow * 0.88, 0.24);
        speed += 0.18;
        if (tiers.length === 0) {
          // セット完了！ 頭が座布団へ落ちる
          state = 3; headVy = 0; celebT = 0;
          ctx.setHint(setTierCount + ctx.t({ en: ' tiers cleared!', ja: 'だんクリア！', es: ' niveles ¡despejados!', 'pt-BR': ' andares limpos!', fr: ' étages effacés !', de: ' Etagen geschafft!', it: ' livelli eliminati!', ko: '단 클리어!', 'zh-Hans': '层清除！', tr: ' kat temizlendi!' }));
        } else {
          state = 1; dropRemain = TIER_H;
        }
      } else {
        // ミス → 崩壊
        state = 2; failT = 0;
        ctx.sfx.fail();
        ctx.vibrate(100);
        ctx.setHint('');
        for (var i = 0; i < tiers.length; i++) {
          toFly(tiers[i], (Math.random() - 0.5) * 5, 1 + Math.random() * 2,
            (Math.random() - 0.5) * 8);
        }
        toFly(head, (Math.random() - 0.5) * 4, 2 + Math.random() * 2,
          (Math.random() - 0.5) * 6);
        tiers.length = 0;
      }
    },

    update: function (ctx, dt) {
      // ハンマー往復（プレイ中のみ）
      if (state === 0 || state === 1) {
        hammerPhase += speed * dt;
        hammer.position.x = Math.sin(hammerPhase) * AMP;
      }

      // 判定窓の可視化を更新（幅=2*winNow）。ハンマーが窓内なら緑を強く点灯
      var inWin = state === 0 && Math.abs(hammer.position.x) <= winNow;
      winZoneL.scale.x = Math.max(winNow * 2, 0.4);
      winZoneL.material.opacity = inWin ? (0.42 + 0.2 * Math.sin(ctx.elapsed * 12)) : 0.2;
      winZoneR.userData.eL.position.set(-winNow, 0.45, 1.7);
      winZoneR.userData.eR.position.set(winNow, 0.45, 1.7);
      var edgeVis = state === 0;
      winZoneL.visible = edgeVis;
      winZoneR.visible = edgeVis;

      // 成功リング拡散
      for (var ri = 0; ri < hitRings.length; ri++) {
        var hr = hitRings[ri];
        if (!hr.active) continue;
        hr.t += dt;
        var rp = hr.t / 0.5;
        if (rp >= 1) { hr.active = false; hr.mesh.visible = false; }
        else {
          var sc = 1 + rp * 1.8;
          hr.mesh.scale.set(sc, sc, sc);
          hr.mesh.material.opacity = 0.85 * (1 - rp);
        }
      }
      // 砂ぼこり
      for (var di = 0; di < dusts.length; di++) {
        var du = dusts[di];
        if (du.life <= 0) continue;
        du.life -= dt;
        du.mesh.position.x += du.vx * dt;
        du.mesh.position.y += du.vy * dt;
        du.mesh.position.z += du.vz * dt;
        du.vy -= 4 * dt;
        du.mesh.material.opacity = Math.max(0, du.life / 0.45) * 0.7;
        if (du.life <= 0) du.mesh.visible = false;
      }
      // ストライク演出（前へ突いて戻る）
      if (strikeT > 0) {
        strikeT = Math.max(strikeT - dt, 0);
        var prog = 1 - strikeT / 0.18;
        hammer.position.z = 1.5 - Math.sin(prog * Math.PI) * 0.7;
      }

      // 吹き飛び中ピース
      for (var i = 0; i < flying.length; i++) {
        var f = flying[i];
        if (!f.active) continue;
        f.mesh.position.x += f.vx * dt;
        f.mesh.position.y += f.vy * dt;
        f.vy -= G * dt;
        f.mesh.rotation.z += f.vr * dt;
        if (f.mesh.position.y < -2.5) {
          f.active = false;
          f.mesh.visible = false;
        }
      }

      if (state === 1) {
        // 上の段がストンと落ちる
        var d = Math.min(dropRemain, 7 * dt);
        for (var t = 0; t < tiers.length; t++) tiers[t].position.y -= d;
        head.position.y -= d;
        dropRemain -= d;
        if (dropRemain <= 0.0001) state = 0;
      } else if (state === 2) {
        // 崩壊 → ゲームオーバー
        failT += dt;
        if (failT > 1.3) ctx.gameOver(removed);
      } else if (state === 3) {
        // 頭が座布団へストン → 新セット
        var restY = 0.18 + 0.85;
        if (head.position.y > restY) {
          headVy -= G * dt;
          head.position.y = Math.max(head.position.y + headVy * dt, restY);
          if (head.position.y <= restY) {
            ctx.sfx.success();
            ctx.vibrate(30);
            ctx.setHint(setTierCount + ctx.t({ en: ' tiers cleared!', ja: 'だんクリア！', es: ' niveles ¡despejados!', 'pt-BR': ' andares limpos!', fr: ' étages effacés !', de: ' Etagen geschafft!', it: ' livelli eliminati!', ko: '단 클리어!', 'zh-Hans': '层清除！', tr: ' kat temizlendi!' }));
          }
        } else {
          celebT += dt;
          head.rotation.z = Math.sin(celebT * 10) * 0.08; // うれしそうに揺れる
          if (celebT > 1.0) {
            setCount++;
            speed = 2.2 + removed * 0.18 + setCount * 0.5;
            buildSet();
            head.rotation.z = 0;
            state = 0;
          }
        }
      }
    }
  });
})();
