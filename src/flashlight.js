(function (G) {
  'use strict';

  // Linterna: todos los personajes la llevan enganchada a la correa izquierda, a la altura del pecho
  // (diseño propio). Se enciende y se apaga con L, el botón de la linterna (táctil) o la cruceta derecha del
  // mando. Alumbra hacia donde mira la cámara. A los infectados les da igual: no la ven ni la oyen.
  // La luz existe siempre (apagada = intensidad 0): crearla o quitarla en mitad de la partida da tirones

  const COLOR = 0xfff1d6, INTENSITY = 9, DIST = 26, ANGLE = 0.42, PENUMBRA = 0.5, DECAY = 1.25;
  let scene = null, player = null, light = null, target = null, body = null, lens = null, lensMat = null;
  let on = false, level = 0;
  // El suelo y las paredes se iluminan por vértice (son losas grandes): una luz pequeña como la de la
  // linterna casi no se notaría. Por eso, además de la luz, se pinta el círculo de luz donde da el haz
  let pool = null, poolMesh = null, poolMat = null;
  const _p = new THREE.Vector3(), _d = new THREE.Vector3();

  function makeBody() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0x2b2d2f }));
    m.rotation.x = Math.PI / 2;
    g.add(m);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.018, 0.03, 12), new THREE.MeshLambertMaterial({ color: 0x3a3c3e }));
    head.rotation.x = Math.PI / 2; head.position.z = 0.06;
    g.add(head);
    lensMat = new THREE.MeshBasicMaterial({ color: 0x5a5a50 });
    lensMat.toneMapped = false;
    lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12), lensMat);
    lens.position.z = 0.0755;
    g.add(lens);
    // clip a la correa
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.012), new THREE.MeshLambertMaterial({ color: 0x1e1f20 }));
    clip.position.set(0, 0.022, -0.01);
    g.add(clip);
    g.position.set(0.085, 0.11, 0.135);
    return g;
  }

  function poolTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,244,220,1)'); g.addColorStop(0.45, 'rgba(255,238,205,0.75)');
    g.addColorStop(0.8, 'rgba(255,230,190,0.22)'); g.addColorStop(1, 'rgba(255,225,180,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  // hasta dónde llega el haz: el suelo, una pared o la parte de arriba de un mueble
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function castBeam(o, d, lv) {
    const W = G.World, step = 0.2, max = 18;
    _a.copy(o);
    for (let t = step; t <= max; t += step) {
      _b.copy(o).addScaledVector(d, t);
      if (W.lineHit(_a.x, _a.z, _b.x, _b.z, W.blocksSightEdge, lv) >= 0) {
        // pared: cuál de las dos líneas de la cuadrícula cruzó
        const nx = Math.floor(_a.x) !== Math.floor(_b.x), nz = Math.floor(_a.z) !== Math.floor(_b.z);
        const alongX = nx && (!nz || Math.abs(d.x) > Math.abs(d.z));
        const p = _a.clone();
        if (alongX) p.x = d.x > 0 ? Math.floor(_b.x) - 0.03 : Math.floor(_a.x) + 0.03;
        else p.z = d.z > 0 ? Math.floor(_b.z) - 0.03 : Math.floor(_a.z) + 0.03;
        return { p, t, wall: alongX ? 'x' : 'z' };
      }
      const gy = W.groundY(_b.x, _b.z, lv), top = W.furnTop(_b.x, _b.z, lv, 0.1);
      const fy = Math.max(gy, top || 0);
      if (_b.y <= fy) { _b.y = fy + 0.015; return { p: _b.clone(), t, wall: null }; }
      _a.copy(_b);
    }
    return null;
  }

  const Flashlight = {
    init(sc, pl) {
      scene = sc; player = pl;
      light = new THREE.SpotLight(COLOR, 0, DIST, ANGLE, PENUMBRA, DECAY);
      light.castShadow = false;
      target = new THREE.Object3D();
      scene.add(target);
      light.target = target;
      light.position.set(0, -50, 0);
      scene.add(light);
      body = makeBody();
      poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      poolMat.toneMapped = false;
      pool = new THREE.Group();
      poolMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat);
      poolMesh.renderOrder = 3;
      pool.add(poolMesh);
      pool.visible = false;
      scene.add(pool);
    },
    get on() { return on; },
    toggle() {
      on = !on;
      if (G.Audio) G.Audio.play('flashlight');
      const b = document.getElementById('btn-light');
      if (b) b.classList.toggle('on', on);
      return on;
    },
    off() { if (on) this.toggle(); },
    update(dt, cam) {
      if (!light || !player) return;
      // la linterna va en el pecho del modelo (si el modelo se rehace, se vuelve a poner)
      const h = player.model;
      if (h && h.chest && body.parent !== h.chest) h.chest.add(body);
      body.visible = !player.dead;
      // se enciende y se apaga con un parpadeo corto
      const want = on && !player.dead ? 1 : 0;
      level += (want - level) * Math.min(1, dt * 18);
      if (level < 0.01 && !want) level = 0;
      light.intensity = INTENSITY * level;
      lensMat.color.setHex(level > 0.5 ? 0xfff6dc : 0x5a5a50);
      if (level <= 0) { light.position.set(player.pos.x, -50, player.pos.z); target.position.set(player.pos.x, -60, player.pos.z); pool.visible = false; return; }
      body.updateMatrixWorld(true);
      body.getWorldPosition(_p);
      // hacia donde mira la cámara (sin apuntar al suelo de golpe ni al cielo)
      _d.copy(cam.dir);
      _d.y = Math.max(-0.45, Math.min(0.3, _d.y + 0.05));
      _d.normalize();
      light.position.copy(_p).addScaledVector(_d, 0.08);
      target.position.copy(_p).addScaledVector(_d, 10);
      target.updateMatrixWorld();
      // el círculo de luz donde da el haz
      const hit = castBeam(light.position, _d, player.lv || 0);
      if (!hit) { pool.visible = false; return; }
      const r = Math.max(0.35, hit.t * Math.tan(ANGLE) * 1.05);
      pool.visible = true;
      pool.position.copy(hit.p);
      if (hit.wall) {
        // en la pared: de cara a la linterna
        pool.rotation.set(0, hit.wall === 'x' ? (_d.x > 0 ? -Math.PI / 2 : Math.PI / 2) : (_d.z > 0 ? Math.PI : 0), 0);
        poolMesh.rotation.set(0, 0, 0);
        poolMesh.scale.set(r * 2, r * 2, 1);
      } else {
        // en el suelo: alargado en la dirección del haz cuanto más rasante llega
        pool.rotation.set(0, Math.atan2(_d.x, _d.z), 0);
        poolMesh.rotation.set(-Math.PI / 2, 0, 0);
        poolMesh.scale.set(r * 2, r * 2 * Math.min(3, 1 / Math.max(0.2, -_d.y)), 1);
      }
      poolMat.opacity = level * 0.5 * Math.max(0.15, 1 - hit.t / 20);
    }
  };

  G.Flashlight = Flashlight;
})(window.Game = window.Game || {});
