/* =========================================================================
 * TFCubeMemory — そっくりキューブ
 * ルール: 台の上のキューブをタップでめくって、同じ絵（絵文字）を2つ
 *        そろえると飛んでいって消える。全ペアで次の盤面（4×5）。
 *        60秒でどこまでそろえられるか。ミスペナルティなし。
 * 操作: キューブをタップ。
 * スコア: そろえたペア数 (ぺあ)
 * ========================================================================= */
(function () {
  'use strict';

  var TIME_LIMIT = 60;
  var CUBE_MAX = 20;         // 最大キューブ数（4×5）
  var SIZE = 1.15, GAP = 1.5;
  var EMOJIS = ['🍎', '🍌', '🐶', '🐱', '🚗', '⭐', '🍓', '🐸', '🎈', '⚽'];
  var PASTELS = [0xffd1dc, 0xc9e4ff, 0xd4f0c0, 0xfff3b0, 0xe8d5ff];

  var cubes = [];            // {mesh, emoji, state, t, vx, vy, rs, py}
  var emojiMats = [], coverMat, sideMat;
  var raycaster, pointer;    // Raycaster は init で1個だけ作って使い回す
  var timeLeft, lastHintSec, boardIdx, alivePairs, rebuildT;
  var revealed = [];         // いま表になっているキューブ（最大2）
  var judgeT, judgeMode;     // 判定待ちタイマー: 'match' | 'miss' | null
  var stars = [], rings = [], plusPool = [], bulbs = [];  // エフェクトプール＋電飾
  var starTop = null;        // 舞台てっぺんの金の星（ゆっくり回る）
  var tGlobal = 0, twinkleT = 0;

  // 角丸矩形パス（カード面の描画用）
  function roundRect(c2, x, y, w, h, r) {
    c2.beginPath();
    c2.moveTo(x + r, y);
    c2.arcTo(x + w, y, x + w, y + h, r);
    c2.arcTo(x + w, y + h, x, y + h, r);
    c2.arcTo(x, y + h, x, y, r);
    c2.arcTo(x, y, x + w, y, r);
    c2.closePath();
  }

  // 絵文字を Canvas に描いてテクスチャ化（白い角丸カード＋色縁＋隅ドット）
  function makeFaceTexture(THREE, emoji, bgColor) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var c2 = cv.getContext('2d');
    c2.fillStyle = bgColor;
    c2.fillRect(0, 0, 128, 128);
    c2.fillStyle = '#ffffff';
    roundRect(c2, 8, 8, 112, 112, 18);
    c2.fill();
    c2.fillStyle = bgColor;
    var dots = [[24, 24], [104, 24], [24, 104], [104, 104]];
    for (var d = 0; d < 4; d++) {
      c2.beginPath();
      c2.arc(dots[d][0], dots[d][1], 5, 0, Math.PI * 2);
      c2.fill();
    }
    c2.font = '72px sans-serif';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(emoji, 64, 68);
    return new THREE.CanvasTexture(cv);
  }

  // ── エフェクト（プール方式・update内で new しない） ──
  function spawnBurst(x, y, n) {
    var used = 0;
    for (var i = 0; i < stars.length && used < n; i++) {
      var s = stars[i];
      if (s.life > 0) continue;
      s.life = s.max = 0.5 + Math.random() * 0.25;
      s.mesh.visible = true;
      s.mesh.position.set(x, y, 0.7);
      s.mesh.scale.set(1, 1, 1);
      var a = (used / n) * Math.PI * 2 + Math.random() * 0.6;
      var sp = 2.5 + Math.random() * 2.5;
      s.vx = Math.cos(a) * sp;
      s.vy = Math.sin(a) * sp + 1.2;
      s.rs = 5 + Math.random() * 6;
      used++;
    }
  }
  function spawnRing(x, y) {
    for (var i = 0; i < rings.length; i++) {
      if (rings[i].life > 0) continue;
      rings[i].life = 0.4;
      rings[i].mesh.visible = true;
      rings[i].mesh.position.set(x, y, 0.85);
      return;
    }
  }
  function spawnPlus(x, y) {
    for (var i = 0; i < plusPool.length; i++) {
      if (plusPool[i].life > 0) continue;
      plusPool[i].life = 0.8;
      plusPool[i].spr.visible = true;
      plusPool[i].spr.position.set(x, y, 1.3);
      plusPool[i].spr.material.opacity = 1;
      return;
    }
  }

  // 盤面を組む（cols×rows、ペアをシャッフル配置）
  function buildBoard(ctx, cols, rows) {
    var n = cols * rows;
    var pairs = n / 2;
    alivePairs = pairs;
    revealed.length = 0;
    judgeMode = null;

    // 絵文字ID列（ペア×2）をシャッフル
    var ids = [];
    var i, j, tmp;
    for (i = 0; i < pairs; i++) { ids.push(i); ids.push(i); }
    for (i = ids.length - 1; i > 0; i--) {
      j = Math.floor(ctx.random() * (i + 1));
      tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }

    for (i = 0; i < CUBE_MAX; i++) {
      var c = cubes[i];
      if (i < n) {
        var col = i % cols, row = Math.floor(i / cols);
        c.emoji = ids[i];
        c.state = 'hidden';
        c.t = 0;
        c.mesh.visible = true;
        c.py = 1.1 + (rows - 1 - row) * GAP;
        c.mesh.position.set(
          (col - (cols - 1) / 2) * GAP,
          c.py,
          0
        );
        c.mesh.rotation.set(0, Math.PI, 0); // 裏（？マーク）を手前に
        c.mesh.scale.set(1, 1, 1);
        // マテリアル配列: [+x,-x,+y,-y,+z(絵),-z(カバー)]
        c.mesh.material = [sideMat, sideMat, sideMat, sideMat, emojiMats[ids[i]], coverMat];
      } else {
        c.state = 'gone';
        c.mesh.visible = false;
      }
    }
  }

  Shell.registerGame({
    id: 'TFCubeMemory',
    title: { en: 'Cube Memory', ja: 'そっくりキューブ', es: 'Cubos de Memoria', 'pt-BR': 'Cubos da Memória', fr: 'Cubes Mémoire', de: 'Gedächtnis-Würfel', it: 'Cubi Memoria', ko: '짝꿍 큐브', 'zh-Hans': '记忆方块', tr: 'Hafıza Küpleri' },
    howto: { en: 'Tap cubes to flip them!\nMatch 2 same pictures to clear them!', ja: 'キューブをタップしてめくろう\nおなじえを2つそろえるときえるよ！', es: '¡Toca los cubos para voltearlos!\n¡Haz coincidir 2 iguales para eliminarlos!', 'pt-BR': 'Toque nos cubos para virá-los!\nCombine 2 iguais para eliminá-los!', fr: 'Touchez les cubes pour les retourner !\nAssortissez 2 identiques pour les éliminer !', de: 'Tippe um Würfel umzudrehen!\nGleiche 2 gleiche ab um sie zu entfernen!', it: 'Tocca i cubi per girarli!\nAbbina 2 uguali per eliminarli!', ko: '큐브를 탭해서 뒤집어라!\n같은 그림 2개를 맞추면 사라져!', 'zh-Hans': '点击方块翻面！\n配对2个相同图案即可消除！', tr: 'Küpleri çevirmek için dokun!\n2 aynı resmi eşleştir ve yok et!' },
    scoreLabel: { en: 'pairs', ja: 'ぺあ', es: 'pares', 'pt-BR': 'pares', fr: 'paires', de: 'Paare', it: 'coppie', ko: '쌍', 'zh-Hans': '对', tr: 'çift' },
    bg: 0xfff0f5,
    cameraFov: 60,
    cameraPos: [0, 4.2, 12],
    cameraLookAt: [0, 4.0, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      raycaster = new THREE.Raycaster();
      pointer = new THREE.Vector2();

      // 子供部屋: 床＋壁（パステル）
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        new THREE.MeshLambertMaterial({ color: 0xf7e0c8 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.6;
      ctx.scene.add(floor);
      var wall = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        new THREE.MeshLambertMaterial({ color: 0xd8ecff })
      );
      wall.position.set(0, 15, -6);
      ctx.scene.add(wall);

      // 丸ラグ（プレイエリアの輪郭: 台の足元を締める）
      var rug = new THREE.Mesh(
        new THREE.CircleGeometry(5.6, 36),
        new THREE.MeshLambertMaterial({ color: 0xe0b184 })
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = -0.585;
      ctx.scene.add(rug);
      var rugRim = new THREE.Mesh(
        new THREE.RingGeometry(5.6, 6.15, 36),
        new THREE.MeshLambertMaterial({ color: 0xc08a52 })
      );
      rugRim.rotation.x = -Math.PI / 2;
      rugRim.position.y = -0.583;
      ctx.scene.add(rugRim);

      // 台
      var stand = new THREE.Mesh(
        new THREE.BoxGeometry(8.5, 0.6, 3),
        new THREE.MeshLambertMaterial({ color: 0xf0c6d8 })
      );
      stand.position.set(0, 0.1, 0);
      ctx.scene.add(stand);

      // ── 盤面の舞台化: 濃紺フェルトパネル＋木枠＋電飾＋金の星 ──
      // （パステルのキューブ面を濃色で浮き上がらせるコントラスト担当）
      // ※縦画面(390x844)の可視幅は z=0 で約±3.2 → 枠・小物はその内側に置く
      var panel = new THREE.Mesh(
        Style.roundedBox(6.7, 9.4, 0.5, 0.18),
        new THREE.MeshLambertMaterial({ color: 0x2b3564 })
      );
      panel.position.set(0, 4.0, -0.85);
      ctx.scene.add(panel);
      var frameMat = new THREE.MeshLambertMaterial({ color: 0x8a5f33 });
      var barTop = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.5, 0.7), frameMat);
      barTop.position.set(0, 8.85, -0.85);
      ctx.scene.add(barTop);
      var barL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9.9, 0.7), frameMat);
      barL.position.set(-3.15, 4.0, -0.85);
      ctx.scene.add(barL);
      var barR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9.9, 0.7), frameMat);
      barR.position.set(3.15, 4.0, -0.85);
      ctx.scene.add(barR);
      starTop = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42),
        new THREE.MeshBasicMaterial({ color: 0xd9a23a })
      );
      starTop.position.set(0, 9.55, -0.85);
      ctx.scene.add(starTop);
      // マーキー電飾（クリア時にきらめく）
      var bulbGeo = new THREE.SphereGeometry(0.14, 8, 8);
      var bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd257 });
      var bulbPos = [
        [-2.6, 8.85], [-1.3, 8.85], [0, 8.85], [1.3, 8.85], [2.6, 8.85],
        [-3.15, 6.6], [3.15, 6.6], [-3.15, 1.7], [3.15, 1.7]
      ];
      for (var b = 0; b < bulbPos.length; b++) {
        var bl = new THREE.Mesh(bulbGeo, bulbMat);
        bl.position.set(bulbPos[b][0], bulbPos[b][1], -0.42);
        ctx.scene.add(bl);
        bulbs.push(bl);
      }

      // ── 遠景: 窓×2（空・雲・お日さま）＋ガーランド旗（Canvas 1枚ずつ） ──
      var cvW = document.createElement('canvas');
      cvW.width = 256; cvW.height = 256;
      var cw = cvW.getContext('2d');
      var sky = cw.createLinearGradient(0, 0, 0, 256);
      sky.addColorStop(0, '#7fc4e8');
      sky.addColorStop(1, '#c9e9f7');
      cw.fillStyle = sky; cw.fillRect(0, 0, 256, 256);
      cw.fillStyle = '#ffdf80';
      cw.beginPath(); cw.arc(190, 60, 30, 0, Math.PI * 2); cw.fill();
      cw.fillStyle = '#ffffff';
      var cl = [[60, 90, 26], [95, 100, 20], [150, 170, 24], [110, 165, 18]];
      for (var q = 0; q < cl.length; q++) {
        cw.beginPath(); cw.arc(cl[q][0], cl[q][1], cl[q][2], 0, Math.PI * 2); cw.fill();
      }
      cw.strokeStyle = '#f5f0e6'; cw.lineWidth = 22;
      cw.strokeRect(11, 11, 234, 234);
      cw.lineWidth = 10;
      cw.beginPath(); cw.moveTo(128, 0); cw.lineTo(128, 256); cw.moveTo(0, 128); cw.lineTo(256, 128); cw.stroke();
      var winMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvW) });
      var winGeo = new THREE.PlaneGeometry(4.4, 4.4);
      var winL = new THREE.Mesh(winGeo, winMat);
      winL.position.set(-3.7, 11.3, -5.9);
      ctx.scene.add(winL);
      var winR = new THREE.Mesh(winGeo, winMat);
      winR.position.set(3.7, 11.3, -5.9);
      ctx.scene.add(winR);
      var cvG = document.createElement('canvas');
      cvG.width = 1024; cvG.height = 128;
      var cg = cvG.getContext('2d');
      cg.strokeStyle = '#c9a06a'; cg.lineWidth = 6;
      cg.beginPath(); cg.moveTo(0, 14); cg.quadraticCurveTo(512, 60, 1024, 14); cg.stroke();
      var flagCols = ['#e57373', '#ffd257', '#7ec8a8', '#7eb2e0', '#cfa6e8'];
      for (var f = 0; f < 10; f++) {
        var fx = 50 + f * 102;
        var fy = 16 + Math.sin((fx / 1024) * Math.PI) * 42;
        cg.fillStyle = flagCols[f % 5];
        cg.beginPath();
        cg.moveTo(fx - 34, fy); cg.lineTo(fx + 34, fy); cg.lineTo(fx, fy + 76);
        cg.closePath(); cg.fill();
      }
      var garland = new THREE.Mesh(
        new THREE.PlaneGeometry(23, 2.9),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvG), transparent: true, depthWrite: false })
      );
      garland.position.set(0, 12.4, -5.85);
      ctx.scene.add(garland);

      // ── ミッドプロップ: 画面下隅からのぞく積み木＋ボール（接地影つき） ──
      // （縦画面では隅にチラ見え、横画面ではしっかり見える配置）
      var blk1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.75, 0.75),
        new THREE.MeshLambertMaterial({ color: 0x86b986 })
      );
      blk1.position.set(-2.75, -0.22, 2.6);
      blk1.rotation.y = 0.4;
      ctx.scene.add(blk1);
      var blk1b = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.58, 0.58),
        new THREE.MeshLambertMaterial({ color: 0x6a9fd8 })
      );
      blk1b.position.set(-2.7, 0.44, 2.6);
      blk1b.rotation.y = 0.15;
      ctx.scene.add(blk1b);
      var blk2 = new THREE.Mesh(
        new THREE.ConeGeometry(0.6, 1, 4),
        new THREE.MeshLambertMaterial({ color: 0xe0a050 })
      );
      blk2.position.set(5.4, -0.1, 1.5);
      ctx.scene.add(blk2);
      var ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 18, 14),
        new THREE.MeshLambertMaterial({ color: 0xc95a5a })
      );
      ball.position.set(2.8, -0.05, 2.7);
      ctx.scene.add(ball);
      var ballStripe = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.06, 8, 24),
        new THREE.MeshLambertMaterial({ color: 0xfaf3e0 })
      );
      ballStripe.position.copy(ball.position);
      ballStripe.rotation.x = Math.PI / 2 - 0.3;
      ctx.scene.add(ballStripe);
      var shBlk = Style.softShadow(1.0);
      shBlk.position.set(-2.75, -0.58, 2.6);
      ctx.scene.add(shBlk);
      var shCone = Style.softShadow(1.0);
      shCone.position.set(5.4, -0.58, 1.5);
      ctx.scene.add(shCone);
      var shBall = Style.softShadow(0.9);
      shBall.position.set(2.8, -0.58, 2.7);
      ctx.scene.add(shBall);

      // 台の前面にスカラップ（波形の飾り縁）テープ
      var cvS = document.createElement('canvas');
      cvS.width = 512; cvS.height = 64;
      var cs = cvS.getContext('2d');
      cs.fillStyle = '#e0a3bd';
      cs.fillRect(0, 0, 512, 20);
      for (var sc = 0; sc < 16; sc++) {
        cs.beginPath();
        cs.arc(16 + sc * 32, 20, 16, 0, Math.PI);
        cs.fill();
      }
      var scallop = new THREE.Mesh(
        new THREE.PlaneGeometry(8.5, 0.55),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvS), transparent: true, depthWrite: false })
      );
      scallop.position.set(0, 0.14, 1.51);
      ctx.scene.add(scallop);

      // 共有マテリアル: 側面（パステル）とカバー（濃ローズ水玉＋？マーク）
      // カバーは濃紺パネルに映える深めのローズ（白飛び対策で2割暗いhex）
      sideMat = new THREE.MeshLambertMaterial({ color: PASTELS[1] });
      var cvQ = document.createElement('canvas');
      cvQ.width = 128; cvQ.height = 128;
      var c2 = cvQ.getContext('2d');
      c2.fillStyle = '#c2557e';
      c2.fillRect(0, 0, 128, 128);
      c2.fillStyle = 'rgba(255,255,255,0.15)';
      for (var pr = 0; pr < 4; pr++) {
        for (var pc = 0; pc < 4; pc++) {
          c2.beginPath();
          c2.arc(16 + pc * 32 + (pr % 2) * 16, 16 + pr * 32, 6, 0, Math.PI * 2);
          c2.fill();
        }
      }
      c2.strokeStyle = '#ffffff';
      c2.lineWidth = 6;
      roundRect(c2, 10, 10, 108, 108, 16);
      c2.stroke();
      c2.fillStyle = '#ffffff';
      c2.font = 'bold 72px sans-serif';
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      c2.fillText('？', 64, 68);
      coverMat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cvQ) });

      // 絵文字マテリアル（10種・使い回し）
      for (var e = 0; e < EMOJIS.length; e++) {
        emojiMats.push(new THREE.MeshLambertMaterial({
          map: makeFaceTexture(THREE, EMOJIS[e], '#' + PASTELS[e % PASTELS.length].toString(16))
        }));
      }

      // キューブプール（最大20個を init で作って使い回す）
      // 角丸ボックスで積み木のやわらかさを出す（面グループは Box と同じ6面）
      var geo = Style.roundedBox(SIZE, SIZE, SIZE, 0.1, 4);
      for (var i = 0; i < CUBE_MAX; i++) {
        var mesh = new THREE.Mesh(geo, [sideMat, sideMat, sideMat, sideMat, coverMat, coverMat]);
        mesh.visible = false;
        mesh.userData.idx = i;
        ctx.scene.add(mesh);
        cubes.push({ mesh: mesh, emoji: -1, state: 'gone', t: 0, vx: 0, vy: 0, rs: 0, py: 0 });
      }

      // ── エフェクトプール: 星バースト20＋リング2＋「+1」3 ──
      var starCols = [0xffd257, 0xe58fab, 0x6fb8dd, 0x8cd98c, 0xb996e0];
      var starGeo = new THREE.OctahedronGeometry(0.16);
      var starMats = [];
      for (i = 0; i < starCols.length; i++) {
        starMats.push(new THREE.MeshBasicMaterial({ color: starCols[i] }));
      }
      for (i = 0; i < 20; i++) {
        var sm = new THREE.Mesh(starGeo, starMats[i % starMats.length]);
        sm.visible = false;
        ctx.scene.add(sm);
        stars.push({ mesh: sm, life: 0, max: 1, vx: 0, vy: 0, rs: 0 });
      }
      for (i = 0; i < 2; i++) {
        var rg = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.62, 24),
          new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        );
        rg.visible = false;
        ctx.scene.add(rg);
        rings.push({ mesh: rg, life: 0 });
      }
      var cvP = document.createElement('canvas');
      cvP.width = 128; cvP.height = 64;
      var cp = cvP.getContext('2d');
      cp.font = 'bold 46px sans-serif';
      cp.textAlign = 'center';
      cp.textBaseline = 'middle';
      cp.strokeStyle = '#ffffff'; cp.lineWidth = 9;
      cp.strokeText('+1', 64, 32);
      cp.fillStyle = '#e8971f';
      cp.fillText('+1', 64, 32);
      var texP = new THREE.CanvasTexture(cvP);
      for (i = 0; i < 3; i++) {
        var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: texP, transparent: true, depthWrite: false }));
        spr.scale.set(1.7, 0.85, 1);
        spr.visible = false;
        ctx.scene.add(spr);
        plusPool.push({ spr: spr, life: 0 });
      }
    },

    start: function (ctx) {
      timeLeft = TIME_LIMIT;
      lastHintSec = -1;
      boardIdx = 0;
      rebuildT = 0;
      judgeT = 0; judgeMode = null;
      buildBoard(ctx, 4, 4);  // 最初は4×4
      ctx.setHint(ctx.t({ en: 'Left: ', ja: 'のこり ', es: 'Quedan: ', 'pt-BR': 'Restam: ', fr: 'Restent: ', de: 'Rest: ', it: 'Rimangono: ', ko: '남은: ', 'zh-Hans': '剩余: ', tr: 'Kalan: ' }) + TIME_LIMIT + ctx.t({ en: 's', ja: ' びょう', es: 's', 'pt-BR': 's', fr: 's', de: 's', it: 's', ko: '초', 'zh-Hans': '秒', tr: 's' }));
    },

    onPointerDown: function (ctx, p) {
      if (revealed.length >= 2 || judgeMode) return;
      pointer.x = p.nx; pointer.y = p.ny;
      raycaster.setFromCamera(pointer, ctx.camera);
      // めくれるキューブだけ判定
      var best = null, bestDist = Infinity;
      for (var i = 0; i < CUBE_MAX; i++) {
        var c = cubes[i];
        if (c.state !== 'hidden') continue;
        var hits = raycaster.intersectObject(c.mesh);
        if (hits.length > 0 && hits[0].distance < bestDist) {
          bestDist = hits[0].distance;
          best = c;
        }
      }
      if (!best) return;
      best.state = 'flipping';
      best.t = 0;
      revealed.push(best);
      ctx.sfx.tap();
      ctx.vibrate(10);
    },

    update: function (ctx, dt) {
      var i, c;
      tGlobal += dt;

      // ── 演出アニメーション（星・リング・+1・電飾・てっぺんの星） ──
      for (i = 0; i < stars.length; i++) {
        var st = stars[i];
        if (st.life <= 0) continue;
        st.life -= dt;
        if (st.life <= 0) { st.mesh.visible = false; continue; }
        st.vy -= 7 * dt;
        st.mesh.position.x += st.vx * dt;
        st.mesh.position.y += st.vy * dt;
        st.mesh.rotation.z += st.rs * dt;
        var sk = st.life / st.max;
        st.mesh.scale.set(sk, sk, sk);
      }
      for (i = 0; i < rings.length; i++) {
        var rn = rings[i];
        if (rn.life <= 0) continue;
        rn.life -= dt;
        if (rn.life <= 0) { rn.mesh.visible = false; rn.mesh.material.opacity = 0; continue; }
        var rk = 1 - rn.life / 0.4;
        var rsc = 1 + rk * 2.4;
        rn.mesh.scale.set(rsc, rsc, 1);
        rn.mesh.material.opacity = 0.85 * (1 - rk);
      }
      for (i = 0; i < plusPool.length; i++) {
        var pl = plusPool[i];
        if (pl.life <= 0) continue;
        pl.life -= dt;
        if (pl.life <= 0) { pl.spr.visible = false; continue; }
        pl.spr.position.y += 1.6 * dt;
        pl.spr.material.opacity = Math.min(1, pl.life / 0.4);
      }
      if (twinkleT > 0) twinkleT -= dt;
      for (i = 0; i < bulbs.length; i++) {
        var bsc = 1 + (twinkleT > 0
          ? 0.55 * Math.sin(tGlobal * 16 + i * 2.1)
          : 0.12 * Math.sin(tGlobal * 2.4 + i * 1.3));
        bulbs[i].scale.set(bsc, bsc, bsc);
      }
      if (starTop) starTop.rotation.y += dt * 1.4;

      // タイマー
      timeLeft -= dt;
      var sec = Math.ceil(timeLeft);
      if (sec !== lastHintSec) {
        lastHintSec = sec;
        ctx.setHint(ctx.t({ en: 'Left: ', ja: 'のこり ', es: 'Quedan: ', 'pt-BR': 'Restam: ', fr: 'Restent: ', de: 'Rest: ', it: 'Rimangono: ', ko: '남은: ', 'zh-Hans': '剩余: ', tr: 'Kalan: ' }) + Math.max(0, sec) + ctx.t({ en: 's', ja: ' びょう', es: 's', 'pt-BR': 's', fr: 's', de: 's', it: 's', ko: '초', 'zh-Hans': '秒', tr: 's' }));
      }
      if (timeLeft <= 0) {
        ctx.endGame(ctx.score);
        return;
      }

      // 盤面クリア後の再構築待ち
      if (rebuildT > 0) {
        rebuildT -= dt;
        if (rebuildT <= 0) buildBoard(ctx, 4, 5);
      }

      // キューブアニメーション
      for (i = 0; i < CUBE_MAX; i++) {
        c = cubes[i];
        // 盤面が生きて見える呼吸（そっと上下、位相はマスごとにずらす）
        if (c.state === 'hidden' || c.state === 'shown' ||
            c.state === 'flipping' || c.state === 'unflipping') {
          c.mesh.position.y = c.py + Math.sin(tGlobal * 1.7 + i * 0.8) * 0.05;
        }
        if (c.state === 'flipping') {
          // 裏(π)→表(0) へ 0.22秒（めくりの山でふくらむポップ付き）
          c.t += dt;
          var k = Math.min(1, c.t / 0.22);
          c.mesh.rotation.y = Math.PI * (1 - k * (2 - k)); // イーズアウト
          var pop = 1 + Math.sin(k * Math.PI) * 0.12;
          c.mesh.scale.set(pop, pop, pop);
          if (k >= 1) {
            c.mesh.rotation.y = 0;
            c.mesh.scale.set(1, 1, 1);
            c.state = 'shown';
          }
        } else if (c.state === 'unflipping') {
          c.t += dt;
          var k2 = Math.min(1, c.t / 0.22);
          c.mesh.rotation.y = Math.PI * k2 * k2;
          if (k2 >= 1) { c.mesh.rotation.y = Math.PI; c.state = 'hidden'; }
        } else if (c.state === 'flying') {
          // そろったペアが飛んでいく
          c.t += dt;
          c.mesh.position.x += c.vx * dt;
          c.mesh.position.y += c.vy * dt;
          c.mesh.rotation.x += c.rs * dt;
          c.mesh.rotation.z += c.rs * 0.7 * dt;
          if (c.mesh.position.y > 14) {
            c.state = 'gone';
            c.mesh.visible = false;
          }
        }
      }

      // 2枚めくれたら判定開始
      if (revealed.length === 2 && !judgeMode &&
          revealed[0].state === 'shown' && revealed[1].state === 'shown') {
        if (revealed[0].emoji === revealed[1].emoji) {
          judgeMode = 'match'; judgeT = 0.35;
        } else {
          judgeMode = 'miss'; judgeT = 0.75;
        }
      }

      // 判定待ち → 実行
      if (judgeMode) {
        // 不一致は「ちがうよ」の首ふりシェイク（判定待ちの前半0.35秒）
        if (judgeMode === 'miss' && revealed.length === 2) {
          var el = 0.75 - judgeT;
          var amp = Math.max(0, 1 - el / 0.35) * 0.09;
          revealed[0].mesh.rotation.z = Math.sin(el * 42) * amp;
          revealed[1].mesh.rotation.z = -Math.sin(el * 42) * amp;
        }
        judgeT -= dt;
        if (judgeT <= 0) {
          if (judgeMode === 'match') {
            var mx = 0, my = 0;
            for (i = 0; i < 2; i++) {
              c = revealed[i];
              c.state = 'flying';
              c.t = 0;
              c.vx = (ctx.random() - 0.5) * 8;
              c.vy = 9 + ctx.random() * 3;
              c.rs = 4 + ctx.random() * 4;
              mx += c.mesh.position.x * 0.5;
              my += c.mesh.position.y * 0.5;
              spawnBurst(c.mesh.position.x, c.mesh.position.y, 6);
            }
            spawnRing(mx, my);
            spawnPlus(mx, my + 0.6);
            alivePairs--;
            ctx.addScore(1);
            ctx.sfx.score();
            ctx.vibrate(25);
            if (alivePairs <= 0) {
              // 盤面クリア → 電飾きらめき＋祝砲、最後のペアが飛んでから次の 4×5
              boardIdx++;
              ctx.sfx.success();
              rebuildT = 0.45;
              twinkleT = 1.5;
              spawnBurst(0, 8.0, 8);
            }
          } else {
            for (i = 0; i < 2; i++) {
              revealed[i].mesh.rotation.z = 0;
              revealed[i].state = 'unflipping';
              revealed[i].t = 0;
            }
          }
          revealed.length = 0;
          judgeMode = null;
        }
      }
    }
  });
})();
