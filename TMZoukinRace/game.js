/* =========================================================================
 * TMZoukinRace — ぞうきんドリフト（旧：ぞうきんがけGP）
 * 【コンセプト変更】交互スワイプの素振り運動を全廃。雑巾は自動で加速し続け、
 *   長押しでドリフト（曲がる）・離して直進のワンタップ操舵（Sling Drift型）。
 *   直角カーブが続く放課後の廊下を曲がりきる。磨いた床がピカピカ光る軌跡になり、
 *   きれいなラインで抜けると「ツヤ出しボーナス」。壁・バケツ・先生に激突で終了。
 * 操作: 長押しで ドリフト（カーブ側へ曲がる）／離して 直進
 * スコア: 走った距離 (m)
 * ========================================================================= */
(function () {
  'use strict';

  var ROAD_HALF   = 2.9;     // 廊下（床リボン）の半幅（広め＝やさしい）
  var CRASH_OFF   = 3.8;     // これ以上センターから外れたら壁に激突
  var R           = 4.3;     // カーブ半径（ゆるめ）
  var V0          = 4.5;     // 初速 (m/s)
  var VMAX        = 7.5;     // 最高速
  var DS          = 0.4;     // センターライン分解能
  var TRAIL_POOL  = 48;

  var player, bunny, rag;
  var roadMesh, edgeL, edgeR;
  var wallL, wallR;          // コース両縁の壁（判定 CRASH_OFF と一致）
  var windowPool = [];       // 廊下の窓（壁の内側に貼るプレーン）プール
  var trail = [];            // 磨き跡（光る板）プール
  var buckets = [];          // 装飾＋当たると激突するバケツ
  var nodes = [];            // センターライン { x, z, a, s }
  var corners = [];          // { sStart, sEnd, dir, cleared }
  var _camT, _cp;
  var arrowL, arrowR;        // 操舵インジケータ（DOM矢印）
  var WALL_H = 1.4;
  var WINDOW_POOL = 150;

  // 状態
  var px, pz, pa;            // 雑巾の位置と進行方位(a: 0=-Z方向)
  var vel, distTraveled, sP; // 速度 / 走行距離 / センター進行量
  var steerDir, cursor, ended, gracePeriod;   // steerDir: -1=左 0=直進 +1=右
  var crashT, crashScore;    // 転倒演出タイマー / 確定スコア
  var cornerIdx;             // いま向かっているカーブ
  var cornerOffSum, cornerOffN; // カーブ中のライン精度集計
  var trailTimer;

  function dirX(a) { return Math.sin(a); }
  function dirZ(a) { return -Math.cos(a); }
  function angDiff(t, c) { var d = t - c; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

  /* ---- コース（センターライン）を生成。直進→90°カーブ(L/R交互)の繰り返し ---- */
  function buildCourse(random) {
    nodes.length = 0; corners.length = 0;
    var x = 0, z = 0, a = 0, s = 0;
    function push() { nodes.push({ x: x, z: z, a: a, s: s }); }
    function straight(len) {
      var n = Math.max(1, Math.round(len / DS));
      for (var i = 0; i < n; i++) { x += dirX(a) * DS; z += dirZ(a) * DS; s += DS; push(); }
    }
    function corner(dir) {
      var arcLen = (Math.PI / 2) * R;
      var n = Math.max(4, Math.round(arcLen / DS));
      var dth = (Math.PI / 2) / n * dir;
      var sStart = s;
      for (var i = 0; i < n; i++) { a += dth; x += dirX(a) * DS; z += dirZ(a) * DS; s += DS; push(); }
      corners.push({ sStart: sStart, sEnd: s, dir: dir, cleared: false });
    }
    push();
    straight(9);
    var NC = 26;
    for (var k = 0; k < NC; k++) {
      corner(k % 2 === 0 ? 1 : -1);        // L/R 交互で前方(-Z)へスネーク
      straight(7.5 + random() * 4.5);      // 直線を長めに（S字が重ならないように）
    }
    straight(10);
  }

  /* ---- センターラインから床リボン（BufferGeometry）を作る ---- */
  function buildRoadGeometry(THREE, half) {
    var pos = new Float32Array(nodes.length * 2 * 3);
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      var px2 = Math.cos(nd.a), pz2 = Math.sin(nd.a);   // 接線の垂線
      pos[i * 6]     = nd.x + px2 * half; pos[i * 6 + 1] = 0;    pos[i * 6 + 2] = nd.z + pz2 * half;
      pos[i * 6 + 3] = nd.x - px2 * half; pos[i * 6 + 4] = 0;    pos[i * 6 + 5] = nd.z - pz2 * half;
    }
    var idx = [];
    for (var j = 0; j < nodes.length - 1; j++) {
      var b = j * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /* ---- センターラインから片側の壁リボン（縦）を作る。half=CRASH_OFF で判定と一致 ---- */
  function buildWallGeometry(THREE, half, h, side) {
    var pos = new Float32Array(nodes.length * 2 * 3);
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      var ox = Math.cos(nd.a) * half * side, oz = Math.sin(nd.a) * half * side;
      pos[i * 6]     = nd.x + ox; pos[i * 6 + 1] = 0; pos[i * 6 + 2] = nd.z + oz;
      pos[i * 6 + 3] = nd.x + ox; pos[i * 6 + 4] = h; pos[i * 6 + 5] = nd.z + oz;
    }
    var idx = [];
    for (var j = 0; j < nodes.length - 1; j++) {
      var b = j * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /* ---- 窓プレーンを壁の内側に沿って並べる（プール再配置） ---- */
  function placeWindows() {
    var wi = 0;
    var stepN = 20; // ノード20個 ≈ 8m ごと
    for (var i = 10; i < nodes.length - 2 && wi < windowPool.length - 1; i += stepN) {
      var nd = nodes[i];
      for (var side = -1; side <= 1; side += 2) {
        if (wi >= windowPool.length) break;
        var w = windowPool[wi++];
        var d = CRASH_OFF - 0.04;
        w.position.set(nd.x + Math.cos(nd.a) * d * side, 0.85, nd.z + Math.sin(nd.a) * d * side);
        w.rotation.y = Math.atan2(-side * Math.cos(nd.a), -side * Math.sin(nd.a));
        w.visible = true;
      }
    }
    for (; wi < windowPool.length; wi++) windowPool[wi].visible = false;
  }

  function makeBucket(THREE) {
    var g = new THREE.Group();
    var pail = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.46, 12), Style.mat(0x8fa8b8));
    pail.position.y = 0.23; g.add(pail);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 6, 14), Style.mat(0x6a8090));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.46; g.add(rim);
    var water = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12),
      new THREE.MeshBasicMaterial({ color: 0x77c4e8 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.44; g.add(water);
    return g;
  }

  Shell.registerGame({
    id: 'TMZoukinRace',
    title: { en: 'Zoukin Drift', ja: 'ぞうきんドリフト', es: 'Derrape con Trapo', 'pt-BR': 'Drift de Pano', fr: 'Drift Serpillère', de: 'Wisch-Drift', it: 'Drift Straccio', ko: '걸레 드리프트', 'zh-Hans': '抹布漂移', tr: 'Bez Drifti' },
    howto: { en: 'Touch left half = turn left / right half = turn right!\nRelease to go straight. Don\'t go off the hallway!', ja: '画面の左半分タッチ＝左へ／右半分＝右へ！\nはなすと ちょくしん。廊下から はみ出すな！', es: '¡Toca la mitad izquierda = izquierda / derecha = derecha!\n¡Suelta para ir recto. No te salgas del pasillo!', 'pt-BR': 'Toque metade esquerda = esquerda / direita = direita!\nSolte para ir reto. Não saia do corredor!', fr: 'Toucher gauche = gauche / droite = droite !\nRelâchez pour aller tout droit. Ne sortez pas du couloir !', de: 'Links berühren = links / rechts = rechts!\nLoslassen zum Geradeausfahren. Nicht aus dem Gang fahren!', it: 'Tocca sinistra = sinistra / destra = destra!\nRilascia per andare dritto. Non uscire dal corridoio!', ko: '화면 왼쪽 절반 터치＝왼쪽／오른쪽＝오른쪽!\n손 떼면 직진. 복도에서 벗어나지 마라!', 'zh-Hans': '触摸左半屏＝左转／右半屏＝右转！\n松手直行。不要冲出走廊！', tr: 'Sol yarıya dokun = sola / sağ yarı = sağa!\nBırak düz git. Koridordan çıkma!' },
    scoreLabel: 'm',
    bg: 0xffeedd,
    allowContinue: false,
    fogNear: 22, fogFar: 70,
    cameraFov: 60,

    init: function (ctx) {
      var THREE = ctx.THREE;
      var scene = ctx.scene;
      _camT = new THREE.Vector3();
      _cp = new THREE.Vector3();

      // 場外（廊下の外側）＝暗い床
      var outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), Style.mat(0x7a6a52));
      outer.rotation.x = -Math.PI / 2;
      outer.position.y = -0.05;
      scene.add(outer);

      // コース生成 → 床リボン（光る縁つき）
      buildCourse(ctx.random);
      // 縁ハイライト（少し広い明るいリボンを下に敷く）
      edgeL = new THREE.Mesh(buildRoadGeometry(THREE, ROAD_HALF + 0.12),
        new THREE.MeshBasicMaterial({ color: 0xfff2c8, side: THREE.DoubleSide }));
      edgeL.position.y = 0.005;
      scene.add(edgeL);
      // 床本体（磨いた木の廊下）
      roadMesh = new THREE.Mesh(buildRoadGeometry(THREE, ROAD_HALF), Style.mat(0xe4c79a));
      roadMesh.position.y = 0.01;
      scene.add(roadMesh);

      // 両縁の壁（ロッカー/下駄箱風の低い壁。内面位置 = CRASH_OFF で判定と一致）
      var wallMat = new THREE.MeshLambertMaterial({ color: 0xd9bf8e, side: THREE.DoubleSide });
      wallL = new THREE.Mesh(buildWallGeometry(THREE, CRASH_OFF, WALL_H, -1), wallMat);
      scene.add(wallL);
      wallR = new THREE.Mesh(buildWallGeometry(THREE, CRASH_OFF, WALL_H, 1), wallMat);
      scene.add(wallR);

      // 窓（壁の内側に貼る空色プレーン）プール
      var winGeo = new THREE.PlaneGeometry(0.95, 0.55);
      var winMat = new THREE.MeshBasicMaterial({ color: 0xbfe3ff });
      var sashGeo = new THREE.PlaneGeometry(0.06, 0.55);
      var sashMat = new THREE.MeshBasicMaterial({ color: 0xf5f0e6 });
      for (var wp = 0; wp < WINDOW_POOL; wp++) {
        var wg = new THREE.Group();
        wg.add(new THREE.Mesh(winGeo, winMat));
        var sash = new THREE.Mesh(sashGeo, sashMat);
        sash.position.z = 0.005;
        wg.add(sash);
        wg.visible = false;
        scene.add(wg);
        windowPool.push(wg);
      }

      // 操舵インジケータ（押している側の画面端に矢印）
      arrowL = document.createElement('div');
      arrowL.textContent = '◀';
      arrowL.style.cssText = 'position:fixed;left:10px;top:50%;transform:translateY(-50%);' +
        'z-index:11;font-size:46px;color:#ffb300;opacity:0;transition:opacity .12s;' +
        'pointer-events:none;text-shadow:0 0 12px rgba(255,179,0,.8);';
      document.body.appendChild(arrowL);
      arrowR = document.createElement('div');
      arrowR.textContent = '▶';
      arrowR.style.cssText = 'position:fixed;right:10px;top:50%;transform:translateY(-50%);' +
        'z-index:11;font-size:46px;color:#ffb300;opacity:0;transition:opacity .12s;' +
        'pointer-events:none;text-shadow:0 0 12px rgba(255,179,0,.8);';
      document.body.appendChild(arrowR);

      // 磨き跡トレイル（光る板）
      var trailGeo = new THREE.PlaneGeometry(ROAD_HALF * 1.8, 0.5);
      for (var t = 0; t < TRAIL_POOL; t++) {
        var q = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
          color: 0xfff6d0, transparent: true, opacity: 0, depthWrite: false }));
        q.rotation.x = -Math.PI / 2;
        q.position.y = 0.02;
        q.visible = false;
        scene.add(q);
        trail.push({ mesh: q, life: 0 });
      }

      // プレイヤー（うさぎ＋ぞうきん・おそうじポーズ）
      bunny = GameBunny.make(THREE, { scale: 0.5 });
      player = bunny.group;
      rag = new THREE.Mesh(Style.roundedBox(0.6, 0.06, 0.4), Style.mat(0xeeeae0));
      rag.position.set(0, 0.03, 0.5);
      player.add(rag);
      if (bunny.body) bunny.body.rotation.x = 0.35;
      scene.add(player);

      // バケツ（廊下上の障害物）プール
      for (var bk = 0; bk < 6; bk++) {
        var mesh = makeBucket(THREE);
        mesh.visible = false;
        scene.add(mesh);
        buckets.push({ mesh: mesh, x: 0, z: 0, active: false });
      }
    },

    start: function (ctx) {
      ended = false; steerDir = 0; gracePeriod = 1.3;
      crashT = 0; crashScore = 0;
      buildCourse(ctx.random);
      roadMesh.geometry.dispose();
      roadMesh.geometry = buildRoadGeometry(ctx.THREE, ROAD_HALF);
      edgeL.geometry.dispose();
      edgeL.geometry = buildRoadGeometry(ctx.THREE, ROAD_HALF + 0.12);
      wallL.geometry.dispose();
      wallL.geometry = buildWallGeometry(ctx.THREE, CRASH_OFF, WALL_H, -1);
      wallR.geometry.dispose();
      wallR.geometry = buildWallGeometry(ctx.THREE, CRASH_OFF, WALL_H, 1);
      placeWindows();
      arrowL.style.opacity = '0';
      arrowR.style.opacity = '0';

      var n0 = nodes[0];
      px = n0.x; pz = n0.z; pa = n0.a;
      vel = V0; distTraveled = 0; sP = 0; cursor = 0;
      cornerIdx = 0; cornerOffSum = 0; cornerOffN = 0; trailTimer = 0;
      for (var i = 0; i < corners.length; i++) corners[i].cleared = false;

      player.position.set(px, 0, pz);
      player.rotation.set(0, Math.PI + pa, 0);
      player.scale.set(1, 1, 1);
      for (var t = 0; t < trail.length; t++) { trail[t].life = 0; trail[t].mesh.visible = false; }

      // バケツをカーブ出口の外側に配置（攻めすぎると当たる）
      var placed = 0;
      for (var c = 4; c < corners.length && placed < buckets.length; c += 6) {
        var cn = corners[c];
        var mid = nodes[Math.min(nodes.length - 1, Math.round((cn.sStart + cn.sEnd) / 2 / DS))];
        var perpX = Math.cos(mid.a), perpZ = Math.sin(mid.a);
        var side = -cn.dir; // カーブ外側（膨らむと激突する側）に並べる
        var bkt = buckets[placed];
        bkt.x = mid.x + perpX * side * (ROAD_HALF + 0.55);
        bkt.z = mid.z + perpZ * side * (ROAD_HALF + 0.55);
        bkt.active = true;
        bkt.mesh.position.set(bkt.x, 0, bkt.z);
        bkt.mesh.visible = true;
        placed++;
      }
      for (var e = placed; e < buckets.length; e++) { buckets[e].active = false; buckets[e].mesh.visible = false; }

      ctx.camera.position.set(px, 12, pz + 7);
      ctx.camera.lookAt(px, 0, pz - 3);
      ctx.setScore(0);
      ctx.setHint(ctx.t({ en: 'Touch left = turn left / right = turn right!', ja: 'ひだりタッチ＝ひだりへ／みぎタッチ＝みぎへ！', es: '¡Toca izquierda = izquierda / derecha = derecha!', 'pt-BR': 'Toque esquerda = esquerda / direita = direita!', fr: 'Toucher gauche = à gauche / droite = à droite !', de: 'Links tippen = links / rechts = rechts!', it: 'Tocca sinistra = sinistra / destra = destra!', ko: '왼쪽 터치=왼쪽／오른쪽 터치=오른쪽!', 'zh-Hans': '触左＝左转／触右＝右转！', tr: 'Sola dokun = sola / sağa dokun = sağa!' }));
    },

    onPointerDown: function (ctx, p) {
      if (!ended) {
        steerDir = p.nx < 0 ? -1 : 1;
        arrowL.style.opacity = steerDir < 0 ? '1' : '0';
        arrowR.style.opacity = steerDir > 0 ? '1' : '0';
      }
    },
    onPointerMove: function (ctx, p) {
      if (!ended && steerDir !== 0) {
        steerDir = p.nx < 0 ? -1 : 1;
        arrowL.style.opacity = steerDir < 0 ? '1' : '0';
        arrowR.style.opacity = steerDir > 0 ? '1' : '0';
      }
    },
    onPointerUp: function (ctx, p) {
      steerDir = 0;
      arrowL.style.opacity = '0';
      arrowR.style.opacity = '0';
    },

    update: function (ctx, dt) {
      dt = Math.min(dt, 0.05);
      // クラッシュ転倒演出（0.4秒）→ ゲームオーバー
      if (crashT > 0) {
        crashT -= dt;
        player.rotation.z += dt * 12;
        player.rotation.x += dt * 7;
        player.position.y = Math.max(0, Math.sin((0.4 - crashT) / 0.4 * Math.PI) * 0.6);
        if (crashT <= 0) {
          player.position.y = 0;
          ctx.gameOver(crashScore);
        }
        return;
      }
      if (ended) return;
      var time = ctx.elapsed;
      if (gracePeriod > 0) gracePeriod = Math.max(0, gracePeriod - dt);

      // 加速（徐々に速く）
      vel = Math.min(VMAX, vel + dt * 0.14);
      var step = vel * dt;
      distTraveled += step;
      ctx.setScore(Math.floor(distTraveled));

      // 現在位置に最も近いセンターライン点(cursor)とズレ(off=壁との距離)
      var bestI = cursor, bestD = 1e9;
      var lo = Math.max(0, cursor - 4), hi = Math.min(nodes.length - 1, cursor + 26);
      for (var i = lo; i <= hi; i++) {
        var nd = nodes[i];
        var dx = px - nd.x, dz = pz - nd.z;
        var d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      cursor = bestI;
      var off = Math.sqrt(bestD);
      var sNode = nodes[cursor].s;   // 進行量はセンターライン基準（ドリフトでズレても同期）

      // カーブ通過判定（センターライン基準）→ ツヤ出しボーナス
      while (cornerIdx < corners.length && sNode > corners[cornerIdx].sEnd) {
        var done = corners[cornerIdx];
        if (!done.cleared && cornerOffN > 0 && (cornerOffSum / cornerOffN) < ROAD_HALF * 0.55) {
          ctx.addScore(15); ctx.sfx.success(); ctx.setHint(ctx.t({ en: 'Shine Bonus! ✨', ja: 'ツヤ出しボーナス！ ✨', es: '¡Bono Brillo! ✨', 'pt-BR': 'Bônus Brilho! ✨', fr: 'Bonus Brillance ! ✨', de: 'Glanz-Bonus! ✨', it: 'Bonus Lucidatura! ✨', ko: '광택 보너스! ✨', 'zh-Hans': '光泽奖励！✨', tr: 'Parlaklık Bonusu! ✨' }));
        }
        done.cleared = true; cornerOffSum = 0; cornerOffN = 0; cornerIdx++;
      }
      var curveDir = 0, inArc = false;
      if (cornerIdx < corners.length) {
        var cc = corners[cornerIdx];
        curveDir = cc.dir;
        inArc = sNode >= cc.sStart - 0.6 && sNode <= cc.sEnd + 0.4;
      }
      if (inArc) { cornerOffSum += off; cornerOffN++; }

      // 操舵：画面の左半分タッチ＝左へ／右半分＝右へ／はなすと直進
      if (steerDir !== 0) {
        pa += steerDir * (vel / R) * dt;
      }

      // 前進
      px += dirX(pa) * step;
      pz += dirZ(pa) * step;
      player.position.set(px, 0, pz);
      player.rotation.y = Math.PI + pa;
      // ドリフトの傾き
      var targetRoll = -steerDir * 0.3;
      player.rotation.z += (targetRoll - player.rotation.z) * Math.min(1, dt * 8);
      // うさぎ足アニメ
      if (bunny) {
        var rt = time * 10;
        bunny.legL.rotation.x = Math.sin(rt) * 0.4;
        bunny.legR.rotation.x = -Math.sin(rt) * 0.4;
      }

      // 磨き跡トレイル
      trailTimer -= step;
      if (trailTimer <= 0) {
        trailTimer = 0.5;
        for (var tt = 0; tt < trail.length; tt++) {
          if (trail[tt].life <= 0) {
            trail[tt].life = 1;
            trail[tt].mesh.visible = true;
            trail[tt].mesh.position.set(px, 0.02, pz);
            trail[tt].mesh.rotation.z = pa;
            break;
          }
        }
      }
      for (var tf = 0; tf < trail.length; tf++) {
        var tr = trail[tf];
        if (tr.life <= 0) continue;
        tr.life -= dt * 0.5;
        tr.mesh.material.opacity = Math.max(0, tr.life * 0.5);
        if (tr.life <= 0) tr.mesh.visible = false;
      }

      // ゴール（コース終端）
      if (cursor >= nodes.length - 2) {
        ended = true;
        ctx.sfx.success();
        ctx.endGame(Math.floor(distTraveled));
        return;
      }

      // バケツ激突判定
      for (var bk = 0; bk < buckets.length; bk++) {
        var bkt = buckets[bk];
        if (!bkt.active) continue;
        var bdx = px - bkt.x, bdz = pz - bkt.z;
        if (bdx * bdx + bdz * bdz < 0.55 * 0.55) {
          ended = true;
          crashT = 0.4; crashScore = Math.floor(distTraveled);
          arrowL.style.opacity = '0'; arrowR.style.opacity = '0';
          ctx.sfx.fail(); ctx.vibrate(80);
          ctx.setHint(ctx.t({ en: 'Crashed into a bucket!', ja: 'バケツに ぶつかった！', es: '¡Chocaste con el cubo!', 'pt-BR': 'Bateu no balde!', fr: 'Collision avec le seau !', de: 'In den Eimer gekracht!', it: 'Urtato nel secchio!', ko: '양동이에 충돌!', 'zh-Hans': '撞上水桶了！', tr: 'Kovaya çarptın!' }));
          return;
        }
      }

      // 壁激突（コースアウト）
      if (off > CRASH_OFF && gracePeriod <= 0) {
        ended = true;
        crashT = 0.4; crashScore = Math.floor(distTraveled);
        arrowL.style.opacity = '0'; arrowR.style.opacity = '0';
        ctx.sfx.fail(); ctx.vibrate(80);
        ctx.setHint(ctx.t({ en: 'Crashed into a wall!', ja: 'かべに ぶつかった！', es: '¡Chocaste con la pared!', 'pt-BR': 'Bateu na parede!', fr: 'Collision avec le mur !', de: 'Gegen die Wand gekracht!', it: 'Urtato nel muro!', ko: '벽에 충돌!', 'zh-Hans': '撞墙了！', tr: 'Duvara çarptın!' }));
        return;
      }

      // カメラ追従（俯瞰・少し後方から）
      _cp.set(px, 0, pz);
      _camT.set(px, 12, pz + 7);
      ctx.camera.position.lerp(_camT, Math.min(1, dt * 4));
      ctx.camera.lookAt(px, 0, pz - 3);
    }
  });
})();
