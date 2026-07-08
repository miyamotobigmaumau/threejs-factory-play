/* =========================================================================
 * TFGoldfishScoop — きんぎょすくい
 * ルール: 水槽を見下ろしてポイをドラッグ。金魚の真上でゆっくり動かすと
 *        すくえる。速く動かすとポイがやぶれる。3回やぶれたら終了。
 * 操作: ドラッグ（ゆっくり動かす）
 * スコア: すくった数 (ひき)
 * ========================================================================= */
(function () {
  'use strict';

  var TANK_R = 2.8, FISH_N = 8;
  var POI_R = 0.78, WATER_Y = 0;

  var fishes = [], poi, membrane, membraneMat;
  var ripples = [], sparkles = [], wasSubmerged;
  var raycaster, pointerV2, dragPlane, hitV3, prevPoi;
  var hpBg, hpFill, lastHpW;
  var hp, tears, dip, poiTargetX, poiTargetZ, poiSpeed, brokenT, failing, overT;
  var caughtTotal;

  function makeFish(THREE, mat) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat);
    body.scale.set(1.5, 0.85, 0.9);
    var tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 8), mat);
    tail.rotation.z = Math.PI / 2; // うしろ(-x)向き
    tail.position.x = -0.52;
    var eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    var eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
    eyeL.position.set(0.32, 0.1, 0.18);
    var eyeR = eyeL.clone();
    eyeR.position.z = -0.18;
    g.add(body, tail, eyeL, eyeR);
    g.userData.tail = tail;
    return g;
  }

  function respawnFish(f) {
    var a = Math.random() * Math.PI * 2;
    f.grp.position.set(Math.cos(a) * (TANK_R - 0.5), -0.45, Math.sin(a) * (TANK_R - 0.5));
    f.heading = a + Math.PI; // 中心向き
    f.state = 'swim';
    f.progress = 0;
    f.fleeT = 0;
    f.grp.visible = true;
  }

  function breakPoi(ctx) {
    tears++;
    hp = 0;
    membrane.visible = false;
    ctx.sfx.fail();
    ctx.vibrate(60);
    if (tears >= 3) {
      failing = true; overT = 0;
      ctx.setHint(ctx.t({ en: 'All scoops are torn…', ja: 'ポイが ぜんぶやぶれた…', es: 'Todas las redes están rotas…', 'pt-BR': 'Todas as peneiras rasgaram…', fr: 'Tous les filets sont déchirés…', de: 'Alle Schöpfer sind zerrissen…', it: 'Tutti i retini sono strappati…', ko: '포이가 전부 찢어졌어…', 'zh-Hans': '鱼网全部破了…', tr: 'Tüm kepçeler yırtıldı…' }));
    } else {
      brokenT = 1.2;
      ctx.setHint(ctx.t({ en: 'Torn! Scoops left: ', ja: 'やぶれた！ ポイ のこり ', es: '¡Roto! Redes restantes: ', 'pt-BR': 'Rasgou! Peneiras restantes: ', fr: 'Déchiré ! Filets restants: ', de: 'Gerissen! Schöpfer übrig: ', it: 'Strappato! Retini rimasti: ', ko: '찢어졌어! 포이 남은: ', 'zh-Hans': '破了！剩余鱼网: ', tr: 'Yırtıldı! Kalan kepçe: ' }) + (3 - tears) + ctx.t({ en: '', ja: 'まい', es: '', 'pt-BR': '', fr: '', de: '', it: '', ko: '장', 'zh-Hans': '张', tr: '' }));
    }
  }

  Shell.registerGame({
    id: 'TFGoldfishScoop',
    title: { en: 'Goldfish Scoop', ja: 'きんぎょすくい', es: 'Pesca el Pez Dorado', 'pt-BR': 'Pesca o Peixinho', fr: 'Attrape le Poisson Rouge', de: 'Goldfisch-Schöpfer', it: 'Pesca il Pesce Rosso', ko: '금붕어 뜨기', 'zh-Hans': '捞金鱼', tr: 'Japon Balığı Kap' },
    howto: { en: 'Drag the scoop slowly over the fish!\nMove too fast and it tears!', ja: 'ポイをドラッグして金魚の上でゆっくり！\nはやくうごかすと やぶれちゃう', es: '¡Arrastra el coladera sobre el pez despacio!\n¡Muévela rápido y se rompe!', 'pt-BR': 'Arraste a peneira devagar sobre o peixe!\nMova rápido e ela rasga!', fr: 'Glissez le filet lentement sur le poisson !\nBougez trop vite et il se déchire !', de: 'Ziehe den Schöpfer langsam über den Fisch!\nZu schnell und er reißt!', it: 'Trascina il retino lentamente sul pesce!\nMuoviti troppo veloce e si strappa!', ko: '포이를 천천히 금붕어 위로 드래그!\n빠르게 움직이면 찢어져!', 'zh-Hans': '将鱼网缓缓拖到金鱼上方！\n动得太快就会破！', tr: 'Kepçeyi balığın üzerinde yavaşça sürükle!\nHızlı hareket edersen yırtılır!' },
    scoreLabel: { en: 'fish', ja: 'ひき', es: 'peces', 'pt-BR': 'peixes', fr: 'poissons', de: 'Fische', it: 'pesci', ko: '마리', 'zh-Hans': '条', tr: 'balık' },
    bg: 0x264a63,
    cameraFov: 55,
    cameraPos: [0, 12, 5.2],
    cameraLookAt: [0, 0, -0.2],

    init: function (ctx) {
      var THREE = ctx.THREE, i;

      // 水槽（たらい）
      var basin = new THREE.Mesh(
        new THREE.CylinderGeometry(TANK_R + 0.25, TANK_R + 0.05, 1.1, 32, 1, true),
        new THREE.MeshLambertMaterial({ color: 0x3a7ca5, side: THREE.DoubleSide })
      );
      basin.position.y = -0.35;
      ctx.scene.add(basin);
      var bottom = new THREE.Mesh(
        new THREE.CircleGeometry(TANK_R + 0.1, 32),
        Style.mat(0x9ec9de)
      );
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = -0.88;
      ctx.scene.add(bottom);
      // 小石
      var pebbleMat = Style.mat(0x7b8fa3);
      for (i = 0; i < 7; i++) {
        var pb = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.08, 8, 6), pebbleMat);
        var pa = Math.random() * Math.PI * 2, pr = Math.random() * (TANK_R - 0.4);
        pb.position.set(Math.cos(pa) * pr, -0.85, Math.sin(pa) * pr);
        ctx.scene.add(pb);
      }
      // 水面（半透明）
      var water = new THREE.Mesh(
        new THREE.CircleGeometry(TANK_R + 0.05, 32),
        new THREE.MeshLambertMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.45 })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = WATER_Y + 0.02;
      ctx.scene.add(water);
      // 屋台の台
      var table = new THREE.Mesh(
        Style.roundedBox(9, 0.4, 8),
        Style.mat(0x8a5a2b)
      );
      table.position.y = -1.15;
      ctx.scene.add(table);
      // バケツ（すくった金魚のいれもの）
      var bucket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.4, 0.5, 16),
        Style.mat(0xffb74d)
      );
      bucket.position.set(2.6, -0.7, 2.6);
      ctx.scene.add(bucket);

      // 夜店の小物：予備ポイの束＋提灯（水槽の縁に立てて雰囲気を出す）
      for (var sp = 0; sp < 3; sp++) {
        var spare = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 18), Style.mat(0xd23b2e));
        spare.position.set(-3.2, -0.55 + sp * 0.05, 2.4 + sp * 0.12);
        spare.rotation.x = 1.2 + sp * 0.05;
        ctx.scene.add(spare);
      }
      var lanternMat = new THREE.MeshBasicMaterial({ color: 0xff8a4d });
      [[-3.4, -3.4], [3.4, -3.4]].forEach(function (pos) {
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), Style.mat(0x5a4632));
        pole.position.set(pos[0], -0.15, pos[1]);
        ctx.scene.add(pole);
        var lantern = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), lanternMat);
        lantern.scale.y = 1.3;
        lantern.position.set(pos[0], 1.0, pos[1]);
        ctx.scene.add(lantern);
        var lidT = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 8), Style.mat(0x3a2b20));
        lidT.position.set(pos[0], 1.55, pos[1]);
        ctx.scene.add(lidT);
      });

      // 金魚（赤・白を交互に）
      var redMat = Style.mat(0xe53935);
      var whiteMat = Style.mat(0xfafafa);
      for (i = 0; i < FISH_N; i++) {
        var grp = makeFish(THREE, i % 2 === 0 ? redMat : whiteMat);
        ctx.scene.add(grp);
        fishes.push({ grp: grp, heading: 0, state: 'swim', progress: 0, fleeT: 0,
                      t: 0, sx: 0, sy: 0, sz: 0, ph: Math.random() * 6.28 });
      }

      // ポイ
      poi = new THREE.Group();
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(POI_R + 0.07, 0.06, 8, 24),
        Style.mat(0xd23b2e)
      );
      ring.rotation.x = Math.PI / 2;
      membraneMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      membrane = new THREE.Mesh(new THREE.CircleGeometry(POI_R, 24), membraneMat);
      membrane.rotation.x = -Math.PI / 2;
      var handle = new THREE.Mesh(
        Style.roundedBox(0.1, 0.06, 0.9),
        Style.mat(0xe8c88a)
      );
      handle.position.z = POI_R + 0.5;
      poi.add(ring, membrane, handle);
      ctx.scene.add(poi);

      // 波紋リングプール（水にポイを入れた瞬間）
      for (var rp = 0; rp < 4; rp++) {
        var rip = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 24),
          new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
        rip.rotation.x = -Math.PI / 2;
        rip.visible = false;
        ctx.scene.add(rip);
        ripples.push({ mesh: rip, t: 0, active: false });
      }
      // すくい成功のきらめきプール
      var sparkGeo = new THREE.SphereGeometry(0.07, 5, 4);
      for (var sk = 0; sk < 12; sk++) {
        var sm = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0 }));
        sm.visible = false;
        ctx.scene.add(sm);
        sparkles.push({ mesh: sm, vx: 0, vy: 0, vz: 0, life: 0 });
      }

      // レイキャスターは1個だけ・使い回し
      raycaster = new THREE.Raycaster();
      pointerV2 = new THREE.Vector2();
      dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      hitV3 = new THREE.Vector3();
      prevPoi = new THREE.Vector3();

      // ポイ耐久ゲージ（DOM）
      hpBg = document.createElement('div');
      hpBg.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
        'width:56vw;height:12px;background:rgba(0,0,0,.25);border-radius:6px;z-index:11;display:none;';
      hpFill = document.createElement('div');
      hpFill.style.cssText = 'height:100%;width:100%;background:#f48fb1;border-radius:6px;';
      hpBg.appendChild(hpFill);
      document.body.appendChild(hpBg);
    },

    _ripple: function (x, z) {
      for (var i = 0; i < ripples.length; i++) {
        if (!ripples[i].active) {
          ripples[i].active = true; ripples[i].t = 0;
          ripples[i].mesh.position.set(x, WATER_Y + 0.04, z);
          ripples[i].mesh.visible = true;
          return;
        }
      }
    },

    _sparkle: function (x, y, z) {
      var n = 0;
      for (var i = 0; i < sparkles.length && n < 8; i++) {
        if (sparkles[i].life > 0) continue;
        var a = Math.random() * Math.PI * 2;
        sparkles[i].life = 0.5;
        sparkles[i].vx = Math.cos(a) * (1 + Math.random());
        sparkles[i].vy = 1.5 + Math.random();
        sparkles[i].vz = Math.sin(a) * (1 + Math.random());
        sparkles[i].mesh.position.set(x, y, z);
        sparkles[i].mesh.material.opacity = 1;
        sparkles[i].mesh.visible = true;
        n++;
      }
    },

    start: function (ctx) {
      hp = 1; tears = 0; dip = false; wasSubmerged = false;
      brokenT = 0; failing = false; overT = 0;
      caughtTotal = 0; poiSpeed = 0; lastHpW = -1;
      poiTargetX = 0; poiTargetZ = 1.2;
      poi.position.set(0, 0.25, 1.2);
      prevPoi.copy(poi.position);
      membrane.visible = true;
      membraneMat.opacity = 0.85;
      for (var i = 0; i < FISH_N; i++) respawnFish(fishes[i]);
      hpFill.style.width = '100%';
      hpBg.style.display = '';
      ctx.setHint(ctx.t({ en: '3 scoops left — scoop slowly!', ja: 'ポイ のこり 3まい　ゆっくりすくおう', es: '3 redes — ¡recoge despacio!', 'pt-BR': '3 peneiras — pesque devagar!', fr: '3 filets — pêchez lentement !', de: '3 Schöpfer übrig — langsam schöpfen!', it: '3 retini — prendi lentamente!', ko: '포이 3장 남음 — 천천히 떠라!', 'zh-Hans': '剩3张网 — 慢慢捞！', tr: '3 kepçe kaldı — yavaşça kap!' }));
    },

    onPointerDown: function (ctx, p) {
      dip = true;
      pointerV2.set(p.nx, p.ny);
      raycaster.setFromCamera(pointerV2, ctx.camera);
      if (raycaster.ray.intersectPlane(dragPlane, hitV3)) {
        poiTargetX = hitV3.x; poiTargetZ = hitV3.z;
        // タッチした場所へワープ（遠距離スライドで即やぶれるのを防ぐ）
        poi.position.x = hitV3.x;
        poi.position.z = hitV3.z;
        prevPoi.copy(poi.position);
      }
    },

    onPointerMove: function (ctx, p) {
      pointerV2.set(p.nx, p.ny);
      raycaster.setFromCamera(pointerV2, ctx.camera);
      if (raycaster.ray.intersectPlane(dragPlane, hitV3)) {
        poiTargetX = hitV3.x; poiTargetZ = hitV3.z;
      }
    },

    onPointerUp: function (ctx, p) {
      dip = false;
    },

    update: function (ctx, dt) {
      var i, t = ctx.elapsed;

      if (failing) {
        overT += dt;
        if (overT > 0.8) {
          hpBg.style.display = 'none';
          ctx.gameOver(caughtTotal);
        }
        return;
      }

      // やぶれたポイの交換待ち
      var poiOK = brokenT <= 0;
      if (!poiOK) {
        brokenT -= dt;
        if (brokenT <= 0) {
          hp = 1;
          membrane.visible = true;
          ctx.setHint(ctx.t({ en: 'New scoop! Left: ', ja: 'あたらしいポイ！ のこり ', es: '¡Nueva red! Quedan: ', 'pt-BR': 'Nova peneira! Restam: ', fr: 'Nouveau filet ! Restants: ', de: 'Neuer Schöpfer! Übrig: ', it: 'Nuovo retino! Rimasti: ', ko: '새 포이! 남은: ', 'zh-Hans': '新鱼网！剩余: ', tr: 'Yeni kepçe! Kalan: ' }) + (3 - tears) + ctx.t({ en: '', ja: 'まい', es: '', 'pt-BR': '', fr: '', de: '', it: '', ko: '장', 'zh-Hans': '张', tr: '' }));
        }
      }

      // ポイ移動（範囲内にクランプ・水に入れると沈む）
      var r = Math.sqrt(poiTargetX * poiTargetX + poiTargetZ * poiTargetZ);
      var cl = TANK_R - 0.3;
      var tx = r > cl ? poiTargetX / r * cl : poiTargetX;
      var tz = r > cl ? poiTargetZ / r * cl : poiTargetZ;
      poi.position.x += (tx - poi.position.x) * Math.min(1, dt * 14);
      poi.position.z += (tz - poi.position.z) * Math.min(1, dt * 14);
      var submerged = dip && poiOK;
      var ty = submerged ? -0.25 : 0.25;
      poi.position.y += (ty - poi.position.y) * Math.min(1, dt * 10);
      // 水に入れた瞬間に波紋
      if (submerged && !wasSubmerged) this._ripple(poi.position.x, poi.position.z);
      wasSubmerged = submerged;

      // 波紋・きらめきの更新
      for (var wi = 0; wi < ripples.length; wi++) {
        var rr = ripples[wi];
        if (!rr.active) continue;
        rr.t += dt;
        var rp2 = rr.t / 0.6;
        if (rp2 >= 1) { rr.active = false; rr.mesh.visible = false; }
        else { var rs = 0.5 + rp2 * 2.2; rr.mesh.scale.set(rs, rs, rs); rr.mesh.material.opacity = 0.7 * (1 - rp2); }
      }
      for (var ki = 0; ki < sparkles.length; ki++) {
        var kk = sparkles[ki];
        if (kk.life <= 0) continue;
        kk.life -= dt;
        kk.mesh.position.x += kk.vx * dt;
        kk.mesh.position.y += kk.vy * dt;
        kk.mesh.position.z += kk.vz * dt;
        kk.vy -= 5 * dt;
        kk.mesh.material.opacity = Math.max(0, kk.life / 0.5);
        if (kk.life <= 0) kk.mesh.visible = false;
      }

      // ポイの速さを計測
      var dx = poi.position.x - prevPoi.x, dz = poi.position.z - prevPoi.z;
      poiSpeed = Math.sqrt(dx * dx + dz * dz) / Math.max(dt, 0.001);
      prevPoi.copy(poi.position);

      // 水中でのダメージ（つけっぱなし＋速い動きで大ダメージ）
      if (submerged && poi.position.y < 0.05) {
        hp -= (0.035 + Math.max(0, poiSpeed - 1.3) * 0.09) * dt;
        if (hp <= 0) breakPoi(ctx);
      }
      membraneMat.opacity = 0.25 + hp * 0.6;
      var hpW = Math.max(0, Math.round(hp * 100));
      if (hpW !== lastHpW) {
        lastHpW = hpW;
        hpFill.style.width = hpW + '%';
        hpFill.style.background = hpW > 40 ? '#f48fb1' : '#ef5350';
      }

      // 金魚
      var fishSpeed = 0.55 + caughtTotal * 0.07 + t * 0.004;
      for (i = 0; i < FISH_N; i++) {
        var f = fishes[i];
        if (f.state === 'caught') {
          // バケツへ放物線ですくい上げ
          f.t += dt / 0.7;
          var k = Math.min(1, f.t);
          f.grp.position.x = f.sx + (2.6 - f.sx) * k;
          f.grp.position.z = f.sz + (2.6 - f.sz) * k;
          f.grp.position.y = f.sy + (0.2 - f.sy) * k + Math.sin(k * Math.PI) * 1.6;
          if (f.t >= 1) respawnFish(f);
          continue;
        }
        // 泳ぎ（ふらふら方向転換＋壁で中心へ）
        f.heading += (Math.random() - 0.5) * dt * 2.5;
        if (f.heading > Math.PI) f.heading -= Math.PI * 2;
        else if (f.heading < -Math.PI) f.heading += Math.PI * 2;
        var fr = Math.sqrt(f.grp.position.x * f.grp.position.x + f.grp.position.z * f.grp.position.z);
        if (fr > TANK_R - 0.55) {
          var toC = Math.atan2(-f.grp.position.z, -f.grp.position.x);
          f.heading += (((toC - f.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 4);
        }
        // 速いポイから逃げる
        var pdx = f.grp.position.x - poi.position.x;
        var pdz = f.grp.position.z - poi.position.z;
        var pd = Math.sqrt(pdx * pdx + pdz * pdz);
        if (submerged && pd < 1.6 && poiSpeed > 1.6) {
          f.heading = Math.atan2(pdz, pdx);
          f.fleeT = 0.8;
        }
        if (f.fleeT > 0) f.fleeT -= dt;
        var sp = fishSpeed * (f.fleeT > 0 ? 2.6 : 1);
        f.grp.position.x += Math.cos(f.heading) * sp * dt;
        f.grp.position.z += Math.sin(f.heading) * sp * dt;
        f.grp.rotation.y = -f.heading;
        f.grp.userData.tail.rotation.y = Math.sin(t * 8 + f.ph) * 0.5;

        // すくい判定: ポイの下＋ゆっくり
        if (submerged && pd < POI_R && poiSpeed < 1.0) {
          f.progress += dt * 1.9;
          f.grp.position.y = -0.45 + f.progress * 0.5;
          if (f.progress >= 1) {
            f.state = 'caught';
            f.t = 0;
            f.sx = f.grp.position.x; f.sy = f.grp.position.y; f.sz = f.grp.position.z;
            caughtTotal++;
            ctx.addScore(1);
            this._sparkle(f.grp.position.x, 0.3, f.grp.position.z);
            ctx.sfx.score();
            ctx.vibrate(20);
          }
        } else {
          f.progress = Math.max(0, f.progress - dt * 1.5);
          f.grp.position.y = -0.45 + f.progress * 0.5;
        }
      }

      // ながく遊びすぎ防止（難度曲線の保険）
      if (t > 90) {
        hpBg.style.display = 'none';
        ctx.endGame(caughtTotal);
      }
    }
  });
})();
