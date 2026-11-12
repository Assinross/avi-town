// Парные фары и задние огни: общий instancing, мягкие пятна на земле без SpotLight на машину.
import * as THREE from 'three';

interface LampLayout { front: number; back: number; halfWidth: number; height: number; length: number }

function softTexture() {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(Math.max(0, 1 - r) ** 2 * 255);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class VehicleLights {
  readonly group = new THREE.Group();
  private layouts: LampLayout[];
  private beams: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private tails: THREE.InstancedMesh;
  private reflections: THREE.InstancedMesh;
  private beamMaterial: THREE.ShaderMaterial;
  private headMaterial: THREE.MeshBasicMaterial;
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();
  private night = 0;
  private frontCount = 0;
  private rearCount = 0;
  private reflectionCount = 0;

  constructor(geometries: THREE.BufferGeometry[], maxCars: number, private top: number) {
    this.layouts = geometries.map((g) => {
      g.computeBoundingBox();
      const b = g.boundingBox!;
      return { front: b.max.z + 0.002, back: b.min.z - 0.002, halfWidth: (b.max.x - b.min.x) * 0.32,
        height: top + Math.min(0.07, Math.max(0.035, (b.max.y - b.min.y) * 0.35)), length: b.max.z - b.min.z };
    });
    const ground = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const bulb = new THREE.SphereGeometry(1, 6, 4);
    this.beamMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { color: { value: new THREE.Color(0xffe2ae) }, opacity: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float opacity; varying vec2 vUv;
        void main() {
          float distance = 1.0 - vUv.y;
          float spread = mix(0.32, 1.0, distance);
          float side = abs(vUv.x - 0.5) * 2.0;
          float edge = exp(-3.2 * pow(side / spread, 2.0)) * (1.0 - smoothstep(0.75, 1.0, side));
          float fade = pow(1.0 - distance, 1.7) * smoothstep(0.0, 0.06, distance);
          gl_FragColor = vec4(color, edge * fade * opacity);
          #include <colorspace_fragment>
        }`,
    });
    this.headMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe9c9).multiplyScalar(2.2), transparent: true, toneMapped: false, depthWrite: false });
    const rearMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
    const reflectionMaterial = new THREE.MeshBasicMaterial({ map: softTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pool = (geo: THREE.BufferGeometry, material: THREE.Material, capacity = maxCars * 2) => {
      const mesh = new THREE.InstancedMesh(geo, material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.userData.noOutline = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    };
    this.beams = pool(ground, this.beamMaterial);
    this.heads = pool(bulb, this.headMaterial);
    // Задних огней бывает четыре на машину: два стоп-сигнала и два фонаря поворотника
    this.tails = pool(bulb, rearMaterial, maxCars * 4);
    this.reflections = pool(ground, reflectionMaterial);
  }

  begin(dark: number) {
    this.night = THREE.MathUtils.smoothstep(dark, 0.12, 0.85);
    this.beamMaterial.uniforms.opacity.value = this.night * 0.65;
    this.headMaterial.opacity = this.night;
    this.frontCount = this.rearCount = this.reflectionCount = 0;
  }

  add(model: number, x: number, z: number, yaw: number, brake: boolean, blink: 'none' | 'left' | 'right' = 'none', flash = true) {
    const l = this.layouts[model], c = Math.cos(yaw), s = Math.sin(yaw);
    const put = (mesh: THREE.InstancedMesh, i: number, u: number, y: number, f: number, sx: number, sy: number, sz: number) => {
      this.tmp.position.set(x + c * u + s * f, y, z - s * u + c * f);
      this.tmp.rotation.set(0, yaw, 0);
      this.tmp.scale.set(sx, sy, sz);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(i, this.tmp.matrix);
    };
    for (const side of [-1, 1]) {
      const u = side * l.halfWidth;
      if (this.night > 0) {
        const reach = Math.min(0.6, Math.max(0.28, l.length * 1.35));
        put(this.beams, this.frontCount, u, this.top + 0.006, l.front + reach / 2, l.halfWidth * 5, 1, reach);
        put(this.heads, this.frontCount++, u, l.height, l.front, 0.009, 0.007, 0.007);
      }
      if (this.night > 0 || brake) {
        put(this.tails, this.rearCount, u, l.height * 0.8 + this.top * 0.2, l.back, 0.008, 0.006, 0.006);
        this.tails.setColorAt(this.rearCount++, this.color.setHex(0xff2a1a).multiplyScalar(brake ? 1.8 : this.night * 0.8));
        const brightness = brake ? 0.04 + this.night * 0.35 : this.night * 0.16;
        put(this.reflections, this.reflectionCount, u, this.top + 0.007, l.back - 0.08, l.halfWidth * 3, 1, brake ? 0.25 : 0.16);
        this.reflections.setColorAt(this.reflectionCount++, this.color.setHex(0xff2918).multiplyScalar(brightness));
      }
    }
    // Поворотник: мигает передний и задний фонарь со стороны поворота
    if (blink !== 'none') {
      const side = blink === 'left' ? -1 : 1;
      const u = side * l.halfWidth;
      for (const f of [l.front, l.back]) {
        put(this.tails, this.rearCount, u, l.height, f, 0.009, 0.007, 0.007);
        this.tails.setColorAt(this.rearCount++, this.color.setHex(0xffa22a).multiplyScalar(flash ? 1.9 : 0.25));
      }
    }
  }

  finish() {
    for (const [mesh, count] of [[this.beams, this.frontCount], [this.heads, this.frontCount], [this.tails, this.rearCount], [this.reflections, this.reflectionCount]] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
