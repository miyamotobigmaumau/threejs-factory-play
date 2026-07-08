/* =========================================================================
 * TFJenga — つみきひきぬき
 * ルール: 3本×10段の塔から、崩さないように積み木をタップで引き抜く。
 *        あかるい木は「ゆるい」、くらい木は「かたい」＝リスク大。
 *        安定度が0になると崩壊。「やめる」でスコア確定もできる。
 * 操作: ブロックをタップ／「やめる」ボタン
 * スコア: 抜いた本数 (ほん)
 * ========================================================================= */
(function () {
  'use strict';

  var LAYERS = 10, SLOTS = 3;
  var BLOCK_H = 0.6, GAP = 0.02, PITCH = 1.0;

  var tower, blocks = [], meshList = [];
  var raycaster, pointerV2;
  var looseMat, tightMat;
  var stability, pulled, collapsing, collapseT, wobbleT, wobbleAmp;
  var quitBtn, meterBg, meterFill;
  var ctxRef = null;
  var chips = [], chipPool = [];      // 木くずパーティクル（プール）
  var dusts = [], dustPool = [];      // 崩壊時の土煙（プール）
  var towerShadow;

  function spawnChips(x, y, z, count) {
    for (var i = 0; i < count; i++) {
      var c = null;
      for (var ci = 0; ci < chipPool.length; ci++) {
        if (!chipPool[ci].visible) { c = chipPool[ci]; break; }
      }
      if (!c) return;
      c.position.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
      c.userData.vx = (Math.random() - 0.5) * 3;
      c.userData.vy = 1.5 + Math.random() * 2;
      c.userData.vz = (Math.random() - 0.5) * 3;
      c.userData.life = 0.5 + Math.random() * 0.3;
      c.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      c.visible = true;
      chips.push(c);
    }
  }

  function spawnDust(count) {
    for (var i = 0; i < count; i++) {
      var d = null;
      for (var di = 0; di < dustPool.length; di++) {
        if (!dustPool[di].visible) { d = dustPool[di]; break; }
      }
      if (!d) return;
      var ang = Math.random() * Math.PI * 2;
      d.userData.vx = Math.cos(ang) * (2 + Math.random() * 2);
      d.userData.vz = Math.sin(ang) * (2 + Math.random() * 2);
      d.userData.life = 0.6 + Math.random() * 0.3;
      d.userData.maxLife = d.userData.life;
      d.position.set((Math.random() - 0.5) * 1.5, 0.2, (Math.random() - 0.5) * 1.5);
      d.scale.set(1, 1, 1);
      d.visible = true;
      dusts.push(d);
    }
  }

  function baseY(layer) { return BLOCK_H / 2 + layer * (BLOCK_H + GAP); }

  // ブロックの定位置をセット
  function placeBlock(b) {
    var even = b.layer % 2 === 0;
    b.mesh.rotation.set(0, even ? 0 : Math.PI / 2, 0);
    b.mesh.position.set(
      even ? (b.slot - 1) * PITCH : 0,
      baseY(b.layer),
      even ? 0 : (b.slot - 1) * PITCH
    );
  }

  function countInLayer(layer) {
    var n = 0;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].layer === layer && blocks[i].state === 'in') n++;
    }
    return n;
  }

  function topLayer() {
    for (var L = LAYERS - 1; L >= 0; L--) if (countInLayer(L) > 0) return L;
    return 0;
  }

  // まだ抜ける手が残っているか
  function anyValidMove() {
    var top = topLayer();
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.state === 'in' && b.layer !== top && countInLayer(b.layer) > 1) return true;
    }
    return false;
  }

  function setMeter(v) {
    var w = Math.max(0, Math.round(v));
    meterFill.style.width = w + '%';
    meterFill.style.background = w > 50 ? '#66bb6a' : (w > 25 ? '#ffa726' : '#ef5350');
  }

  function hideUI() {
    quitBtn.style.display = 'none';
    meterBg.style.display = 'none';
  }

  function collapse(ctx) {
    collapsing = true; collapseT = 0;
    setMeter(0);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.state === 'in' || b.state === 'pull') {
        b.state = 'fall';
        b.vx = (Math.random() - 0.5) * 5;
        b.vy = 1 + Math.random() * 3;
        b.vz = (Math.random() - 0.5) * 5;
        b.rx = (Math.random() - 0.5) * 6;
        b.rz = (Math.random() - 0.5) * 6;
      }
    }
    hideUI();
    spawnDust(10);
    ctx.sfx.fail();
    ctx.vibrate(120);
    ctx.setHint(ctx.t({ en: 'It collapsed! 💥', ja: 'くずれたーっ！', es: '¡Se derrumbó! 💥', 'pt-BR': 'Desmoronou! 💥', fr: 'Effondrement ! 💥', de: 'Eingestürzt! 💥', it: 'Crollato! 💥', ko: '무너졌다! 💥', 'zh-Hans': '倒塌了！💥', tr: 'Çöktü! 💥' }));
  }

  Shell.registerGame({
    id: 'TFJenga',
    title: { en: 'Block Pull', ja: 'つみきひきぬき', es: 'Saca el Bloque', 'pt-BR': 'Puxa o Bloco', fr: 'Tirez les Blocs', de: 'Blockziehen', it: 'Tira i Blocchi', ko: '블록 빼기', 'zh-Hans': '抽积木', tr: 'Blok Çek' },
    howto: { en: 'Pull blocks one by one without toppling!\nLight wood = loose, dark wood = tight', ja: 'くずさないように 1本ずつひきぬこう！\nあかるい木はゆるい・くらい木はかたい', es: '¡Saca bloques sin derribar la torre!\nClaro = suelto, oscuro = firme', 'pt-BR': 'Retire blocos sem derrubar a torre!\nClaro = solto, escuro = firme', fr: 'Retirez les blocs sans faire tomber la tour !\nClair = souple, foncé = solide', de: 'Ziehe Blöcke heraus ohne den Turm umzustürzen!\nHell = locker, dunkel = fest', it: 'Estrai i blocchi senza far cadere la torre!\nChiaro = morbido, scuro = rigido', ko: '탑을 무너뜨리지 않고 블록을 빼세요!\n밝은 나무=느슨함, 어두운 나무=단단함', 'zh-Hans': '小心地逐一抽出积木！\n浅色=松, 深色=紧', tr: 'Kuleyi yıkmadan blokları tek tek çek!\nAçık=gevşek, koyu=sıkı' },
    scoreLabel: { en: 'pcs', ja: 'ほん', es: 'pzas', 'pt-BR': 'pças', fr: 'pcs', de: 'Stk', it: 'pz', ko: '개', 'zh-Hans': '根', tr: 'adet' },
    bg: 0xf3e6cd,
    cameraFov: 55,
    cameraPos: [5.5, 7.5, 11],
    cameraLookAt: [0, 3.2, 0],

    init: function (ctx) {
      var THREE = ctx.THREE, i;
      ctxRef = ctx;

      // 畳の床
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(36, 36),
        new THREE.MeshLambertMaterial({ color: 0xa9b26b })
      );
      floor.rotation.x = -Math.PI / 2;
      ctx.scene.add(floor);
      // 畳のへり（濃い帯）
      var heriMat = new THREE.MeshLambertMaterial({ color: 0x6b7345 });
      for (i = -1; i <= 1; i++) {
        var heri = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 36), heriMat);
        heri.position.set(i * 6, 0.011, 0);
        ctx.scene.add(heri);
      }
      // 緋毛氈（塔の下に敷く。ベージュの塔をベージュの畳から分離する差し色）
      var felt = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), Style.mat(0x8c2f39));
      felt.rotation.x = -Math.PI / 2;
      felt.position.y = 0.02;
      ctx.scene.add(felt);
      var feltHem = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 6.0), Style.mat(0x5e1f26));
      feltHem.rotation.x = -Math.PI / 2;
      feltHem.position.y = 0.015;
      ctx.scene.add(feltHem);

      // 塔の接地影
      towerShadow = Style.softShadow(2.3);
      towerShadow.position.y = 0.03;
      ctx.scene.add(towerShadow);

      // 座布団（2枚。対局の気配）
      var zabuton = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.7, 0.35, 16),
        new THREE.MeshLambertMaterial({ color: 0xc0574f })
      );
      zabuton.position.set(-4.5, 0.18, 4);
      ctx.scene.add(zabuton);
      var zabuton2 = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.7, 0.35, 16),
        new THREE.MeshLambertMaterial({ color: 0x4a6b8a })
      );
      zabuton2.position.set(4.8, 0.18, 4.2);
      ctx.scene.add(zabuton2);

      // 障子の壁（背面と左奥。和室の遠景を作る）
      function makeShoji(w, h) {
        var g = new THREE.Group();
        var paper = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: 0xfdf6e3 }));
        g.add(paper);
        var barMat = Style.mat(0x5a4632);
        var nx = 4;
        for (var bx = 0; bx <= nx; bx++) {
          var vb = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.08), barMat);
          vb.position.set(-w / 2 + (w / nx) * bx, 0, 0.05);
          g.add(vb);
        }
        for (var by = 0; by <= 3; by++) {
          var hb = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.08), barMat);
          hb.position.set(0, -h / 2 + (h / 3) * by, 0.05);
          g.add(hb);
        }
        return g;
      }
      var shojiB = makeShoji(16, 9);
      shojiB.position.set(0, 4.5, -9);
      ctx.scene.add(shojiB);
      var shojiL = makeShoji(12, 9);
      shojiL.rotation.y = Math.PI / 2;
      shojiL.position.set(-10, 4.5, -3);
      ctx.scene.add(shojiL);

      // 床の間の掛け軸（背面壁のアクセント）
      var scroll = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 4.2),
        new THREE.MeshBasicMaterial({ color: 0xf0e0c0 }));
      scroll.position.set(6.2, 4.6, -8.8);
      ctx.scene.add(scroll);
      var scrollMark = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20),
        new THREE.MeshBasicMaterial({ color: 0xb5443c }));
      scrollMark.position.set(6.2, 5.2, -8.75);
      ctx.scene.add(scrollMark);
      var scrollRod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8), Style.mat(0x3a2a1a));
      scrollRod.rotation.z = Math.PI / 2;
      scrollRod.position.set(6.2, 6.8, -8.75);
      ctx.scene.add(scrollRod);

      // 茶卓＋湯呑み（ミッドプロップ）
      var table = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.18, 14), Style.mat(0x4a3222));
      table.position.set(-5.2, 0.65, -3.5);
      ctx.scene.add(table);
      var tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.6, 8), Style.mat(0x3a2718));
      tableLeg.position.set(-5.2, 0.3, -3.5);
      ctx.scene.add(tableLeg);
      var cup = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.28, 10), Style.mat(0x4a7c6f));
      cup.position.set(-4.9, 0.88, -3.3);
      ctx.scene.add(cup);
      var pot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), Style.mat(0x37505e));
      pot.position.set(-5.5, 0.95, -3.7);
      ctx.scene.add(pot);

      // 盆栽（ミッドプロップ）
      var bonsaiPot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.4, 10), Style.mat(0x8a5a3a));
      bonsaiPot.position.set(5.5, 0.2, -5.5);
      ctx.scene.add(bonsaiPot);
      var bonsaiTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.9, 6), Style.mat(0x5a4028));
      bonsaiTrunk.position.set(5.5, 0.8, -5.5);
      bonsaiTrunk.rotation.z = 0.3;
      ctx.scene.add(bonsaiTrunk);
      [[5.3, 1.35, -5.5, 0.42], [5.75, 1.15, -5.35, 0.3]].forEach(function (bl) {
        var leaf = new THREE.Mesh(new THREE.SphereGeometry(bl[3], 8, 6), Style.mat(0x3f6b32, { flat: true }));
        leaf.position.set(bl[0], bl[1], bl[2]);
        leaf.scale.y = 0.6;
        ctx.scene.add(leaf);
      });

      // 木の材質（ゆるい=明るい / かたい=暗い）
      looseMat = new THREE.MeshLambertMaterial({ color: 0xdcab6b });
      tightMat = new THREE.MeshLambertMaterial({ color: 0x8b5e34 });

      // 塔
      tower = new THREE.Group();
      ctx.scene.add(tower);
      var geo = Style.roundedBox(0.97, BLOCK_H, 3.0, 0.07);
      for (var L = 0; L < LAYERS; L++) {
        for (var s = 0; s < SLOTS; s++) {
          var mesh = new THREE.Mesh(geo, looseMat);
          mesh.userData.b = blocks.length;
          tower.add(mesh);
          meshList.push(mesh);
          blocks.push({
            mesh: mesh, layer: L, slot: s, state: 'in', tight: false,
            t: 0, dirX: 0, dirZ: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0
          });
        }
      }

      // レイキャスターは1個だけ作って使い回す
      raycaster = new THREE.Raycaster();
      pointerV2 = new THREE.Vector2();

      // 木くず＋土煙プール
      var chipGeo = new THREE.BoxGeometry(0.12, 0.05, 0.18);
      var chipMat = new THREE.MeshBasicMaterial({ color: 0xc89b62 });
      for (i = 0; i < 14; i++) {
        var chip = new THREE.Mesh(chipGeo, chipMat);
        chip.visible = false;
        ctx.scene.add(chip);
        chipPool.push(chip);
      }
      var dustGeo = new THREE.SphereGeometry(0.22, 5, 4);
      for (i = 0; i < 12; i++) {
        var dust = new THREE.Mesh(dustGeo,
          new THREE.MeshBasicMaterial({ color: 0xd8c9a8, transparent: true, opacity: 0.8 }));
        dust.visible = false;
        ctx.scene.add(dust);
        dustPool.push(dust);
      }

      // 安定度メーター（DOM）
      meterBg = document.createElement('div');
      meterBg.style.cssText = 'position:fixed;bottom:74px;left:50%;transform:translateX(-50%);' +
        'width:56vw;height:12px;background:rgba(0,0,0,.25);border-radius:6px;z-index:11;display:none;';
      meterFill = document.createElement('div');
      meterFill.style.cssText = 'height:100%;width:100%;background:#66bb6a;border-radius:6px;';
      meterBg.appendChild(meterFill);
      document.body.appendChild(meterBg);

      // 「やめる」ボタン（DOM。ラベルは start で10言語セット）
      quitBtn = document.createElement('button');
      quitBtn.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
        'padding:10px 22px;border-radius:22px;border:2px solid rgba(255,255,255,.7);' +
        'background:rgba(0,0,0,.35);color:#fff;font-size:15px;font-weight:bold;z-index:11;display:none;';
      document.body.appendChild(quitBtn);
      quitBtn.addEventListener('click', function () {
        if (collapsing) return;
        hideUI();
        ctxRef.sfx.success();
        ctxRef.endGame(pulled);
      });
    },

    start: function (ctx) {
      stability = 100;
      pulled = 0;
      collapsing = false; collapseT = 0;
      wobbleT = 10; wobbleAmp = 0;
      tower.rotation.set(0, 0, 0);
      // 全ブロックを組み直し・ゆるい/かたいを再抽選
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        b.state = 'in';
        b.tight = Math.random() < 0.45;
        b.mesh.material = b.tight ? tightMat : looseMat;
        b.mesh.visible = true;
        placeBlock(b);
      }
      setMeter(100);
      meterBg.style.display = '';
      quitBtn.textContent = '✋ ' + ctx.t({ en: 'Stop (bank score)', ja: 'やめる（かくてい）', es: 'Parar (asegurar)', 'pt-BR': 'Parar (garantir)', fr: 'Stop (valider)', de: 'Stopp (sichern)', it: 'Stop (conferma)', ko: '그만 (확정)', 'zh-Hans': '停手（确定）', tr: 'Dur (kesinleştir)' });
      quitBtn.style.display = '';
      for (var pi = chips.length - 1; pi >= 0; pi--) chips[pi].visible = false;
      chips.length = 0;
      for (pi = dusts.length - 1; pi >= 0; pi--) dusts[pi].visible = false;
      dusts.length = 0;
      ctx.setHint(ctx.t({ en: 'Light wood is loose & safe!', ja: 'あかるい木は ゆるくてあんぜん！', es: '¡La madera clara es suelta y segura!', 'pt-BR': 'Madeira clara é solta e segura!', fr: 'Le bois clair est souple et sûr !', de: 'Helles Holz ist locker & sicher!', it: 'Il legno chiaro è morbido e sicuro!', ko: '밝은 나무는 느슨하고 안전해요!', 'zh-Hans': '浅色木块比较松，更安全！', tr: 'Açık renkli tahta gevşek ve güvenli!' }));
    },

    onPointerDown: function (ctx, p) {
      if (collapsing) return;
      pointerV2.set(p.nx, p.ny);
      raycaster.setFromCamera(pointerV2, ctx.camera);
      var hits = raycaster.intersectObjects(meshList);
      var b = null;
      for (var i = 0; i < hits.length; i++) {
        var cand = blocks[hits[i].object.userData.b];
        if (cand.state === 'in') { b = cand; break; }
      }
      if (!b) return;

      var top = topLayer();
      if (b.layer === top) {
        ctx.setHint(ctx.t({ en: "Can't pull the top layer!", ja: 'いちばん上は ぬけない！', es: '¡No puedes sacar la capa superior!', 'pt-BR': 'Não pode tirar a camada do topo!', fr: 'Impossible de retirer la couche du haut !', de: 'Oberste Schicht nicht ziehbar!', it: 'Non puoi togliere lo strato in cima!', ko: '맨 위 층은 뺄 수 없어요!', 'zh-Hans': '最顶层不能抽！', tr: 'En üst katı çekemezsin!' }));
        ctx.sfx.bounce();
        return;
      }
      var inLayer = countInLayer(b.layer);
      if (inLayer <= 1) {
        ctx.setHint(ctx.t({ en: "Can't pull the last one!", ja: 'さいごの1本は ぬけない！', es: '¡No puedes sacar el último!', 'pt-BR': 'Não pode tirar o último!', fr: 'Impossible de retirer le dernier !', de: 'Den letzten Stein nicht ziehbar!', it: 'Non puoi togliere l\'ultimo!', ko: '마지막 하나는 뺄 수 없어요!', 'zh-Hans': '最后一块不能抽！', tr: 'Son bloğu çekemezsin!' }));
        ctx.sfx.bounce();
        return;
      }

      // 引き抜き開始
      b.state = 'pull';
      b.t = 0;
      var even = b.layer % 2 === 0;
      b.dirX = even ? 0 : 1;
      b.dirZ = even ? 1 : 0;

      // コスト計算（かたさ×抜いた後の配置×低さ×進行度）
      var base = (b.tight ? 13 : 6) + Math.random() * 4;
      var remain = inLayer - 1;
      var factor;
      // 真ん中を抜いて両はしが残る形がいちばん安定
      if (remain === 2) factor = b.slot === 1 ? 0.9 : 1.25;
      else { // 残り1本
        // 真ん中が残るなら安定・端が残るなら大グラ
        var centerStays = false;
        for (var j = 0; j < blocks.length; j++) {
          var o = blocks[j];
          if (o !== b && o.layer === b.layer && o.state === 'in' && o.slot === 1) centerStays = true;
        }
        factor = centerStays ? 1.6 : 2.4;
      }
      var heightF = 1 + (LAYERS - b.layer) * 0.05; // 下の段ほどキケン
      var escalate = 1 + pulled * 0.04;
      var cost = base * factor * heightF * escalate * (0.85 + Math.random() * 0.3);

      stability -= cost;
      pulled++;
      ctx.addScore(1);
      setMeter(stability);

      // グラッと揺れる演出＋木くず
      wobbleT = 0;
      wobbleAmp = Math.min(0.055, cost * 0.0012);
      spawnChips(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z, b.tight ? 6 : 3);
      ctx.sfx.tap();
      ctx.vibrate(20);
      ctx.setHint(b.tight ? ctx.t({ en: 'Tight…! Wobble! 😨', ja: 'かたい…！グラグラ！', es: '¡Firme…! ¡Tambalea! 😨', 'pt-BR': 'Firme…! Tremendo! 😨', fr: 'Solide…! Ça tremble ! 😨', de: 'Fest…! Wackelt! 😨', it: 'Rigido…! Barcolla! 😨', ko: '단단해…! 흔들흔들! 😨', 'zh-Hans': '很紧…！摇摇晃晃！😨', tr: 'Sıkı…! Sallantı! 😨' }) : ctx.t({ en: 'Smooth! 😄', ja: 'するっ！', es: '¡Suave! 😄', 'pt-BR': 'Suave! 😄', fr: 'Facile ! 😄', de: 'Glatt! 😄', it: 'Scorrevole! 😄', ko: '쑥! 😄', 'zh-Hans': '顺滑！😄', tr: 'Pürüzsüz! 😄' }));

      if (stability <= 0) {
        collapse(ctx);
        return;
      }
      if (!anyValidMove()) {
        // 抜ける手がなくなった → 完抜きクリア
        hideUI();
        ctx.sfx.success();
        ctx.endGame(pulled);
      }
    },

    update: function (ctx, dt) {
      var i, b;

      // 塔の揺れ（減衰サイン）＋安定度が低いときは常時ゆらゆら（危険のテレグラフ）
      wobbleT += dt;
      var baseWobble = (!collapsing && stability > 0 && stability < 25)
        ? Math.sin(wobbleT * 5) * 0.012 : 0;
      tower.rotation.z = Math.sin(wobbleT * 16) * wobbleAmp * Math.exp(-wobbleT * 2.5) + baseWobble;

      // 木くず
      for (i = chips.length - 1; i >= 0; i--) {
        var ch = chips[i];
        ch.userData.life -= dt;
        ch.userData.vy -= 9.8 * dt;
        ch.position.x += ch.userData.vx * dt;
        ch.position.y += ch.userData.vy * dt;
        ch.position.z += ch.userData.vz * dt;
        ch.rotation.x += 8 * dt;
        if (ch.userData.life <= 0 || ch.position.y < 0) { ch.visible = false; chips.splice(i, 1); }
      }
      // 土煙
      for (i = dusts.length - 1; i >= 0; i--) {
        var du = dusts[i];
        du.userData.life -= dt;
        du.position.x += du.userData.vx * dt;
        du.position.z += du.userData.vz * dt;
        var lr = Math.max(du.userData.life / du.userData.maxLife, 0);
        du.material.opacity = 0.8 * lr;
        du.scale.setScalar(1 + (1 - lr) * 2.2);
        if (du.userData.life <= 0) { du.visible = false; dusts.splice(i, 1); }
      }

      for (i = 0; i < blocks.length; i++) {
        b = blocks[i];
        if (b.state === 'pull') {
          // 長い軸方向へスライド → そのまま落下して退場
          b.t += dt;
          if (b.t < 0.55) {
            b.mesh.position.x += b.dirX * 3.5 * dt;
            b.mesh.position.z += b.dirZ * 3.5 * dt;
          } else {
            b.mesh.position.x += b.dirX * 4 * dt;
            b.mesh.position.z += b.dirZ * 4 * dt;
            b.vy -= 9.8 * dt;
            b.mesh.position.y += b.vy * dt;
            b.mesh.rotation.x += b.dirZ * 2 * dt;
            b.mesh.rotation.z -= b.dirX * 2 * dt;
            if (b.mesh.position.y < -4) { b.state = 'out'; b.mesh.visible = false; b.vy = 0; }
          }
        } else if (b.state === 'fall') {
          // 崩壊のバラバラ落下
          b.vy -= 9.8 * dt;
          b.mesh.position.x += b.vx * dt;
          b.mesh.position.y += b.vy * dt;
          b.mesh.position.z += b.vz * dt;
          b.mesh.rotation.x += b.rx * dt;
          b.mesh.rotation.z += b.rz * dt;
          if (b.mesh.position.y < BLOCK_H / 2 && b.vy < 0) {
            b.mesh.position.y = BLOCK_H / 2;
            b.vy *= -0.3;
            b.vx *= 0.7; b.vz *= 0.7;
            b.rx *= 0.5; b.rz *= 0.5;
          }
        }
      }

      if (collapsing) {
        collapseT += dt;
        if (collapseT > 2.0) ctx.gameOver(pulled);
      }
    }
  });
})();
