/* =========================================================================
 * TFBoxPack — はこづめめいじん
 * ルール: 透明な箱(4×4×高さ4)に上から落ちてくるバー(1×1〜1×3)を
 *         きっちり詰める。1段そろうと「ぎゅっ」と圧縮されてボーナス。
 *         箱の縁からあふれたら終了。
 * 操作: ドラッグで移動(横=X・縦=Z)、タップで90°回転
 * スコア: 詰めたブロック数 + 段ボーナス (こ)
 * ========================================================================= */
(function () {
  'use strict';

  var W = 4, D = 4, H = 4;   // 箱: 4×4×高さ4
  var CELL = 1;              // 1セル=1ワールド単位
  var DROP_START_Y = 6.2;    // 落下開始高さ(セル座標)

  var grid = [];             // grid[y][x][z] = 0(空) or 色番号+1
  var cellMeshes = [];       // 64個のプールしたキューブ
  var palette = [];          // 共有マテリアル
  var pieceMesh;             // 落下中のバー(1個を伸縮して使い回す)
  var piece;                 // { len, orient(0:X,1:Z), gx, gz, y }
  var placed, ended, dragX, dragY, moved, squishT;
  var stackGroup;            // 圧縮演出用に全セルを入れるグループ
  var ghostMesh;             // 着地予測ゴースト（操作の因果を光らせる）
  var rimMat, rims = [];     // 箱の上縁リム（あふれ危険で赤点滅）
  var stars = [], landRings = [], plusSpr = null, plusLife = 0;
  var landT = -1;            // 着地バウンス
  var tGlobal = 0;

  /* ── エフェクト（プール方式・update内で new しない） ── */
  function spawnBurst(x, y, z, n) {
    var used = 0;
    for (var i = 0; i < stars.length && used < n; i++) {
      var s = stars[i];
      if (s.life > 0) continue;
      s.life = s.max = 0.55 + Math.random() * 0.25;
      s.mesh.visible = true;
      s.mesh.position.set(x, y, z);
      s.mesh.scale.set(1, 1, 1);
      var a = (used / n) * Math.PI * 2 + Math.random() * 0.5;
      var sp = 2 + Math.random() * 2;
      s.vx = Math.cos(a) * sp;
      s.vy = 3.5 + Math.random() * 2;
      s.vz = Math.sin(a) * sp;
      s.rs = 5 + Math.random() * 5;
      used++;
    }
  }
  function spawnLandRing(x, y, z) {
    for (var i = 0; i < landRings.length; i++) {
      if (landRings[i].life > 0) continue;
      landRings[i].life = 0.35;
      landRings[i].mesh.visible = true;
      landRings[i].mesh.position.set(x, y + 0.03, z);
      return;
    }
  }
  function spawnPlus8() {
    if (!plusSpr) return;
    plusLife = 0.9;
    plusSpr.visible = true;
    plusSpr.position.set(0, H + 1.0, 0);
    plusSpr.material.opacity = 1;
  }

  /* セル座標→ワールド座標 */
  function wx(gx) { return (gx - (W - 1) / 2) * CELL; }
  function wz(gz) { return (gz - (D - 1) / 2) * CELL; }
  function wy(gy) { return gy + 0.5; }

  /* 足元の占有状況からピースが着地する段を求める */
  function landingLevel(len, orient, gx, gz) {
    var top = 0;
    for (var k = 0; k < len; k++) {
      var x = orient === 0 ? gx + k : gx;
      var z = orient === 0 ? gz : gz + k;
      for (var y = H - 1; y >= 0; y--) {
        if (grid[y][x][z]) { if (y + 1 > top) top = y + 1; break; }
      }
    }
    return top;
  }

  /* grid の中身をプールキューブに反映 */
  function syncCells() {
    var i = 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        for (var z = 0; z < D; z++) {
          var m = cellMeshes[i++];
          var c = grid[y][x][z];
          if (c) {
            m.visible = true;
            m.material = palette[c - 1];
            m.position.set(wx(x), wy(y), wz(z));
          } else {
            m.visible = false;
          }
        }
      }
    }
  }

  /* 新しいピースを出す */
  function spawnPiece(random) {
    var len = 1 + Math.floor(random() * 3); // 1〜3
    var orient = random() < 0.5 ? 0 : 1;
    var maxX = orient === 0 ? W - len : W - 1;
    var maxZ = orient === 0 ? D - 1 : D - len;
    piece = {
      len: len,
      orient: orient,
      gx: Math.floor(random() * (maxX + 1)),
      gz: Math.floor(random() * (maxZ + 1)),
      y: DROP_START_Y,
      color: Math.floor(random() * palette.length)
    };
    updatePieceMesh();
    pieceMesh.visible = true;
  }

  function updatePieceMesh() {
    pieceMesh.material = palette[piece.color];
    if (piece.orient === 0) {
      pieceMesh.scale.set(piece.len * 0.98, 0.98, 0.98);
      pieceMesh.position.x = wx(piece.gx) + (piece.len - 1) / 2;
      pieceMesh.position.z = wz(piece.gz);
    } else {
      pieceMesh.scale.set(0.98, 0.98, piece.len * 0.98);
      pieceMesh.position.x = wx(piece.gx);
      pieceMesh.position.z = wz(piece.gz) + (piece.len - 1) / 2;
    }
    pieceMesh.position.y = piece.y + 0.5;
    // 着地予測ゴースト: どこに積まれるかを常に見せる（判定は不変・表示のみ）
    if (ghostMesh) {
      var lv = landingLevel(piece.len, piece.orient, piece.gx, piece.gz);
      if (lv < H) {
        ghostMesh.visible = pieceMesh.visible;
        ghostMesh.scale.copy(pieceMesh.scale);
        ghostMesh.position.set(pieceMesh.position.x, lv + 0.5, pieceMesh.position.z);
      } else {
        ghostMesh.visible = false;
      }
    }
  }

  /* 位置・向き変更が可能か(範囲内かつ、すでに落ちた高さより下の柱に食い込まない) */
  function canPlace(len, orient, gx, gz) {
    var maxX = orient === 0 ? W - len : W - 1;
    var maxZ = orient === 0 ? D - 1 : D - len;
    if (gx < 0 || gx > maxX || gz < 0 || gz > maxZ) return false;
    // 現在の高さより高い柱の中には移動できない
    return piece.y >= landingLevel(len, orient, gx, gz) - 0.001;
  }

  Shell.registerGame({
    id: 'TFBoxPack',
    title: { en: 'Box Packing Master', ja: 'はこづめめいじん', es: 'Maestro del Empaque', 'pt-BR': 'Mestre do Empacotamento', fr: 'Maître de l\'Emballage', de: 'Packmeister', it: 'Maestro dell\'Imballaggio', ko: '상자 채우기 달인', 'zh-Hans': '装箱达人', tr: 'Kutu Doldurma Ustası' },
    howto: { en: 'Drag to move, tap to rotate!\nPack the box neatly!', ja: 'ドラッグでうごかして タップでくるっ！\nはこに きっちり つめよう', es: '¡Arrastra para mover, toca para girar!\n¡Empaca la caja con cuidado!', 'pt-BR': 'Arraste para mover, toque para girar!\nEmpacote a caixa com cuidado!', fr: 'Glissez pour déplacer, touchez pour tourner !\nRemplissez la boîte soigneusement !', de: 'Ziehe zum Bewegen, tippe zum Drehen!\nPacke die Box sorgfältig voll!', it: 'Trascina per muovere, tocca per ruotare!\nRiempi la scatola con ordine!', ko: '드래그로 이동, 탭으로 회전!\n상자를 꽉꽉 채워봐!', 'zh-Hans': '拖动移动，点击旋转！\n把箱子装得整整齐齐！', tr: 'Sürükle taşı, dokun döndür!\nKutuyu düzgün doldur!' },
    scoreLabel: { en: 'pcs', ja: 'こ', es: 'uds', 'pt-BR': 'pçs', fr: 'pcs', de: 'Stk', it: 'pz', ko: '개', 'zh-Hans': '个', tr: 'adet' },
    bg: 0xf2e2c4,
    cameraFov: 55,
    cameraPos: [0, 8.2, 8.6],
    cameraLookAt: [0, 1.8, 0],

    init: function (ctx) {
      var THREE = ctx.THREE;

      // 引っ越しダンボールの部屋: フローリング（Canvas板目テクスチャ）
      var cvF = document.createElement('canvas');
      cvF.width = 256; cvF.height = 256;
      var cf = cvF.getContext('2d');
      cf.fillStyle = '#a87c53';
      cf.fillRect(0, 0, 256, 256);
      cf.strokeStyle = 'rgba(90,60,35,0.35)';
      cf.lineWidth = 3;
      for (var fl = 0; fl < 8; fl++) {
        cf.beginPath(); cf.moveTo(0, fl * 32); cf.lineTo(256, fl * 32); cf.stroke();
        // 板の継ぎ目（互い違い）
        cf.beginPath();
        cf.moveTo((fl % 2) * 128 + 64, fl * 32);
        cf.lineTo((fl % 2) * 128 + 64, fl * 32 + 32);
        cf.stroke();
      }
      var floorTex = new THREE.CanvasTexture(cvF);
      floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
      floorTex.repeat.set(5, 5);
      var floor = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshLambertMaterial({ map: floorTex })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.01;
      ctx.scene.add(floor);

      // 深緑のラグ: 茶系一色の画面から箱を浮き上がらせる（コントラスト担当）
      var rug = new THREE.Mesh(
        new THREE.CircleGeometry(4.4, 36),
        new THREE.MeshLambertMaterial({ color: 0x4a6b52 })
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.0;
      ctx.scene.add(rug);
      var rugRim = new THREE.Mesh(
        new THREE.RingGeometry(4.4, 4.85, 36),
        new THREE.MeshLambertMaterial({ color: 0x36523e })
      );
      rugRim.rotation.x = -Math.PI / 2;
      rugRim.position.y = 0.002;
      ctx.scene.add(rugRim);

      // 部屋の壁＋窓（遠景: 引っ越し中の部屋の物語）
      var wall = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 24),
        new THREE.MeshLambertMaterial({ color: 0xe8dcc0 })
      );
      wall.position.set(0, 12, -12);
      ctx.scene.add(wall);
      var cvW = document.createElement('canvas');
      cvW.width = 256; cvW.height = 256;
      var cw = cvW.getContext('2d');
      var sky = cw.createLinearGradient(0, 0, 0, 256);
      sky.addColorStop(0, '#7fc4e8'); sky.addColorStop(1, '#cdeaf7');
      cw.fillStyle = sky; cw.fillRect(0, 0, 256, 256);
      cw.fillStyle = '#ffffff';
      var cl = [[70, 80, 26], [110, 92, 20], [170, 150, 26], [130, 160, 18]];
      for (var q = 0; q < cl.length; q++) {
        cw.beginPath(); cw.arc(cl[q][0], cl[q][1], cl[q][2], 0, Math.PI * 2); cw.fill();
      }
      cw.strokeStyle = '#f5f0e6'; cw.lineWidth = 20;
      cw.strokeRect(10, 10, 236, 236);
      cw.lineWidth = 9;
      cw.beginPath(); cw.moveTo(128, 0); cw.lineTo(128, 256); cw.moveTo(0, 128); cw.lineTo(256, 128); cw.stroke();
      var win = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvW) })
      );
      win.position.set(-4.5, 10.5, -11.9);
      ctx.scene.add(win);

      // 背景のダンボール小道具（2段積み＋接地影で「引っ越し感」）
      var boxMat = new THREE.MeshLambertMaterial({ color: 0xc89b6a });
      var tapeMat = new THREE.MeshLambertMaterial({ color: 0xd9c49a });
      for (var b = 0; b < 4; b++) {
        var bx = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), boxMat);
        bx.position.set((b % 2 ? 4.6 : -4.6), 0.6, -3 + (b > 1 ? 4 : 0) - 2);
        bx.rotation.y = b * 0.5;
        ctx.scene.add(bx);
        var tp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.22, 1.62), tapeMat);
        tp.position.copy(bx.position);
        tp.rotation.y = bx.rotation.y;
        ctx.scene.add(tp);
        var shB = Style.softShadow(1.5);
        shB.position.set(bx.position.x, 0.012, bx.position.z);
        ctx.scene.add(shB);
      }
      // 2段目のダンボール（左の山に小箱を重ねる）
      var bxTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), boxMat);
      bxTop.position.set(-4.5, 1.65, -5.1);
      bxTop.rotation.y = 0.25;
      ctx.scene.add(bxTop);
      // 観葉植物（ポット＋丸葉×2）
      var pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.3, 0.6, 12),
        new THREE.MeshLambertMaterial({ color: 0xb5563c })
      );
      pot.position.set(4.7, 0.3, -6.2);
      ctx.scene.add(pot);
      var leafMat = new THREE.MeshLambertMaterial({ color: 0x4f8f4f });
      var leaf1 = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), leafMat);
      leaf1.position.set(4.7, 1.15, -6.2);
      ctx.scene.add(leaf1);
      var leaf2 = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), leafMat);
      leaf2.position.set(4.45, 1.6, -6.05);
      ctx.scene.add(leaf2);
      var shP = Style.softShadow(0.8);
      shP.position.set(4.7, 0.012, -6.2);
      ctx.scene.add(shP);

      // 詰める箱(ダンボール): 半透明の壁 + フチの線
      var wallMat = new THREE.MeshLambertMaterial({
        color: 0xc89b6a, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false
      });
      var wallGeoX = new THREE.PlaneGeometry(W, H);
      var wallGeoZ = new THREE.PlaneGeometry(D, H);
      var walls = [
        { g: wallGeoX, p: [0, H / 2, -D / 2], ry: 0 },
        { g: wallGeoX, p: [0, H / 2, D / 2], ry: 0 },
        { g: wallGeoZ, p: [-W / 2, H / 2, 0], ry: Math.PI / 2 },
        { g: wallGeoZ, p: [W / 2, H / 2, 0], ry: Math.PI / 2 }
      ];
      for (var wI = 0; wI < walls.length; wI++) {
        var wm = new THREE.Mesh(walls[wI].g, wallMat);
        wm.position.set(walls[wI].p[0], walls[wI].p[1], walls[wI].p[2]);
        wm.rotation.y = walls[wI].ry;
        ctx.scene.add(wm);
      }
      var bottom = new THREE.Mesh(
        new THREE.PlaneGeometry(W, D),
        new THREE.MeshLambertMaterial({ color: 0xa87c4f })
      );
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = 0.005;
      ctx.scene.add(bottom);
      var edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
        new THREE.LineBasicMaterial({ color: 0x7a5230 })
      );
      edges.position.y = H / 2;
      ctx.scene.add(edges);

      // 箱の存在感: コーナーポスト4本＋上縁リム4本（あふれ危険で赤点滅する）
      var postMat = new THREE.MeshLambertMaterial({ color: 0x8a5f33 });
      var postGeo = new THREE.BoxGeometry(0.14, H, 0.14);
      var corners = [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]];
      for (var pc = 0; pc < 4; pc++) {
        var post = new THREE.Mesh(postGeo, postMat);
        post.position.set(corners[pc][0], H / 2, corners[pc][1]);
        ctx.scene.add(post);
      }
      rimMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
      var rimGeoX = new THREE.BoxGeometry(W + 0.14, 0.14, 0.14);
      var rimGeoZ = new THREE.BoxGeometry(0.14, 0.14, D + 0.14);
      var rimDefs = [
        { g: rimGeoX, p: [0, H, -D / 2] }, { g: rimGeoX, p: [0, H, D / 2] },
        { g: rimGeoZ, p: [-W / 2, H, 0] }, { g: rimGeoZ, p: [W / 2, H, 0] }
      ];
      for (var rd = 0; rd < 4; rd++) {
        var rim = new THREE.Mesh(rimDefs[rd].g, rimMat);
        rim.position.set(rimDefs[rd].p[0], rimDefs[rd].p[1], rimDefs[rd].p[2]);
        ctx.scene.add(rim);
        rims.push(rim);
      }

      // 共有マテリアルパレット
      var colors = [0xef5350, 0x42a5f5, 0x66bb6a, 0xffca28, 0xab47bc];
      for (var c = 0; c < colors.length; c++) {
        palette.push(new THREE.MeshLambertMaterial({ color: colors[c] }));
      }

      // セルキューブのプール(4×4×4=64個)
      stackGroup = new THREE.Group();
      ctx.scene.add(stackGroup);
      var cellGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
      for (var i = 0; i < W * D * H; i++) {
        var m = new THREE.Mesh(cellGeo, palette[0]);
        m.visible = false;
        stackGroup.add(m);
        cellMeshes.push(m);
      }

      // 落下ピース(1個を伸縮して使い回す)
      pieceMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), palette[0]);
      pieceMesh.visible = false;
      ctx.scene.add(pieceMesh);

      // グリッド初期化
      for (var y = 0; y < H; y++) {
        grid.push([]);
        for (var x = 0; x < W; x++) {
          grid[y].push([]);
          for (var z = 0; z < D; z++) grid[y][x].push(0);
        }
      }
    },

    start: function (ctx) {
      // グリッドを空にしてリセット
      for (var y = 0; y < H; y++)
        for (var x = 0; x < W; x++)
          for (var z = 0; z < D; z++) grid[y][x][z] = 0;
      placed = 0;
      ended = false;
      squishT = -1;
      stackGroup.scale.set(1, 1, 1);
      syncCells();
      spawnPiece(ctx.random);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Tap to rotate!', ja: 'タップで くるっ とまわるよ', es: '¡Toca para girar!', 'pt-BR': 'Toque para girar!', fr: 'Touchez pour tourner !', de: 'Tippe zum Drehen!', it: 'Tocca per ruotare!', ko: '탭하면 빙글 돌아!', 'zh-Hans': '点击旋转！', tr: 'Döndürmek için dokun!' }));
    },

    onPointerDown: function (ctx, p) {
      dragX = 0; dragY = 0; moved = false;
    },

    onPointerMove: function (ctx, p) {
      if (ended || !piece) return;
      dragX += p.dx;
      dragY += p.dy;
      var stepPx = 42; // 1セル動かすのに必要なピクセル
      while (dragX > stepPx)  { if (canPlace(piece.len, piece.orient, piece.gx + 1, piece.gz)) piece.gx++; dragX -= stepPx; moved = true; }
      while (dragX < -stepPx) { if (canPlace(piece.len, piece.orient, piece.gx - 1, piece.gz)) piece.gx--; dragX += stepPx; moved = true; }
      while (dragY > stepPx)  { if (canPlace(piece.len, piece.orient, piece.gx, piece.gz + 1)) piece.gz++; dragY -= stepPx; moved = true; }
      while (dragY < -stepPx) { if (canPlace(piece.len, piece.orient, piece.gx, piece.gz - 1)) piece.gz--; dragY += stepPx; moved = true; }
      if (Math.abs(dragX) > 10 || Math.abs(dragY) > 10) moved = true;
      updatePieceMesh();
    },

    onPointerUp: function (ctx, p) {
      if (ended || !piece || moved) return;
      // タップ=90°回転
      var no = piece.orient === 0 ? 1 : 0;
      var ngx = piece.gx, ngz = piece.gz;
      // 回転後に箱からはみ出すならセルを寄せる
      if (no === 0 && ngx > W - piece.len) ngx = W - piece.len;
      if (no === 1 && ngz > D - piece.len) ngz = D - piece.len;
      if (canPlace(piece.len, no, ngx, ngz)) {
        piece.orient = no; piece.gx = ngx; piece.gz = ngz;
        updatePieceMesh();
        ctx.sfx.tap();
      }
    },

    update: function (ctx, dt) {
      if (ended) return;

      // 段圧縮の「ぎゅっ」演出
      if (squishT >= 0) {
        squishT += dt;
        var q = Math.min(squishT / 0.3, 1);
        stackGroup.scale.y = 1 - Math.sin(q * Math.PI) * 0.18;
        if (q >= 1) { squishT = -1; stackGroup.scale.y = 1; }
      }

      if (!piece) return;

      // 落下(時間経過でだんだん速く)
      var speed = 1.2 + ctx.elapsed * 0.045;
      piece.y -= speed * dt;
      var level = landingLevel(piece.len, piece.orient, piece.gx, piece.gz);

      if (piece.y <= level) {
        // 着地・固定
        if (level >= H) {
          // 箱の縁からあふれた → 終了
          pieceMesh.position.y = H + 0.5;
          ended = true;
          ctx.sfx.fail();
          ctx.vibrate(80);
          ctx.gameOver(ctx.score);
          return;
        }
        for (var k = 0; k < piece.len; k++) {
          var x = piece.orient === 0 ? piece.gx + k : piece.gx;
          var z = piece.orient === 0 ? piece.gz : piece.gz + k;
          grid[level][x][z] = piece.color + 1;
        }
        placed++;
        ctx.addScore(1);
        ctx.sfx.bounce();
        ctx.vibrate(15);

        // 段がそろったら「ぎゅっ」と圧縮してボーナス
        var clearedAny = false;
        for (var y = 0; y < H; y++) {
          var full = true;
          for (var cx = 0; cx < W && full; cx++)
            for (var cz = 0; cz < D; cz++)
              if (!grid[y][cx][cz]) { full = false; break; }
          if (full) {
            clearedAny = true;
            for (var yy = y; yy < H - 1; yy++)
              for (var sx = 0; sx < W; sx++)
                for (var sz = 0; sz < D; sz++)
                  grid[yy][sx][sz] = grid[yy + 1][sx][sz];
            for (var tx = 0; tx < W; tx++)
              for (var tz = 0; tz < D; tz++)
                grid[H - 1][tx][tz] = 0;
            ctx.addScore(8); // 段ボーナス
            y--; // 同じ段をもう一度チェック
          }
        }
        if (clearedAny) {
          squishT = 0;
          ctx.sfx.success();
          ctx.vibrate(50);
          ctx.setHint(ctx.t({ en: 'Squish! +8', ja: 'ぎゅっ！ +8', es: '¡Comprimido! +8', 'pt-BR': 'Comprimido! +8', fr: 'Tassé ! +8', de: 'Zusammengedrückt! +8', it: 'Schiacciato! +8', ko: '꽉! +8', 'zh-Hans': '压缩！+8', tr: 'Sıkıştı! +8' }));
        }

        syncCells();
        spawnPiece(ctx.random);
        return;
      }

      updatePieceMesh();
    }
  });
})();
