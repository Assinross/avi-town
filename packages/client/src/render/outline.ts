// Мультяшный контур постобработкой: кадр и глубина рисуются в текстуры одним проходом сцены,
// затем полноэкранный шейдер восстанавливает по глубине положение и нормали пикселей
// и затемняет пиксели на перепадах глубины и на сгибах граней. Линия - тонкая тёмная,
// как у CityRT, с лёгким оттенком предмета под ней: у белых предметов нет светлого ореола.
// Там же свечение ночных огней: яркий проход на четверти разрешения и два размытия.

import * as THREE from 'three';

// --- Контур: числа для подбора по снимкам ---
/** Сила линии: 0 - нет контура, 1 - линия полностью цвета LINE_DARK. */
const LINE_STRENGTH = 0.6;
/** Цвет линии - тёмный тёплый серо-коричневый (sRGB). */
const LINE_COLOR = new THREE.Color(0x2a221d);
/** Доля оттенка предмета в линии: тон предмета * LINE_DARK * LINE_WARM подмешивается к LINE_COLOR. */
const LINE_TINT = 0.3;
/** Насколько темнее предмета его оттенок в линии. */
const LINE_DARK = 0.3;
/** Тёплый сдвиг оттенка (множители R, G, B): чуть больше красного, меньше синего. */
const LINE_WARM: [number, number, number] = [1.1, 0.97, 0.85];
/** Ослабление линии на экранах с плотными пикселями: при DPR 2 сила * (1 - это число). */
const LINE_DPR_WEAKEN = 0.1;
/** Перепад глубины для линии силуэта, в клетках мира: ниже - ступеньки плит и дорог без линий. */
const DEPTH_EDGE_MIN = 0.06;
/** Добавка к порогу глубины в размерах пикселя: наклонная земля вдали не даёт сетку линий. */
const DEPTH_EDGE_PX = 3;
/** Сгиб граней: 1 - cos(угла между нормалями). 0.15 ~ 32 градуса - грани цилиндров не обводятся. */
const CREASE_LO = 0.15;
/** Сгиб, при котором линия полной силы (0.45 ~ 57 градусов, углы коробок - 90). */
const CREASE_HI = 0.45;
/** Вес линий сгиба относительно линий силуэта. */
const CREASE_WEIGHT = 0.85;
/** Сосед считается той же поверхностью (сгиб, а не силуэт), если он ближе к плоскости пикселя
 *  чем CREASE_GATE_MIN клеток + CREASE_GATE_PX пикселей. Отсекает ореолы у рамок и колец на земле. */
const CREASE_GATE_MIN = 0.03;
const CREASE_GATE_PX = 2;
/** Ослабление вдали: экранных пикселей на клетку мира, при которых линия полной силы... */
const FADE_NEAR_PPU = 48;
/** ...и при которых линия слабейшая (общий вид района). */
const FADE_FAR_PPU = 16;
/** Доля силы линии на дальнем плане. */
const FADE_MIN = 0.35;

/** Число для вставки в GLSL: всегда с точкой. */
const glf = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export class OutlineRenderer {
  private colorRT: THREE.WebGLRenderTarget;
  private bloomRT: THREE.WebGLRenderTarget;
  private blurRT: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private material: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private bloom = true;
  /** Сила свечения по времени суток: днём 0 - белые предметы на солнце не светятся ореолом. */
  private glow = 1;
  private outline = true;
  private texel = new THREE.Vector2();
  /** Высота кадра в пикселях буфера - для размера пикселя в клетках мира. */
  private heightPx = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.colorRT = OutlineRenderer.createTarget(1, 1);
    [this.bloomRT, this.blurRT] = OutlineRenderer.createBloomTargets(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tDepth: { value: this.colorRT.depthTexture },
        tBloom: { value: this.bloomRT.texture },
        texel: { value: new THREE.Vector2() },
        projInv: { value: new THREE.Matrix4() },
        ortho: { value: 1 },
        pixelWorld: { value: 0 },
        pixelRatio: { value: 1 },
        lineStrength: { value: LINE_STRENGTH },
        bloomStrength: { value: 0.95 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth, tBloom;
        uniform vec2 texel;
        uniform mat4 projInv;
        uniform float ortho, pixelWorld, pixelRatio, lineStrength, bloomStrength;
        varying vec2 vUv;
        // Положение пикселя в пространстве камеры по глубине: обратная проекция подходит
        // и ортографической камере (глубина линейна), и перспективной (нелинейна)
        vec3 viewPos(vec2 o, float d) {
          vec4 p = projInv * vec4((vUv + o * texel) * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }
        vec3 at(vec2 o) { return viewPos(o, texture2D(tDepth, vUv + o * texel).r); }
        // Нормаль из соседей: с каждой оси берётся меньший перепад, чтобы на краю
        // предмета не захватить фон за ним (иначе ореол)
        vec3 normalAt(vec3 c, vec3 l, vec3 r, vec3 d, vec3 u) {
          vec3 dx = abs(r.z - c.z) < abs(c.z - l.z) ? r - c : c - l;
          vec3 dy = abs(u.z - c.z) < abs(c.z - d.z) ? u - c : c - d;
          return normalize(cross(dx, dy));
        }
        void main() {
          vec4 color = texture2D(tColor, vUv);
          // Свечение ночных огней добавляется до тональной компрессии
          vec3 lit = color.rgb + texture2D(tBloom, vUv).rgb * bloomStrength;
          float dc = texture2D(tDepth, vUv).r;
          float edge = 0.0;
          // Небо (глубина 1) без линий
          if (dc < 1.0 && lineStrength > 0.0) {
            vec3 c = viewPos(vec2(0.0), dc);
            vec3 l = at(vec2(-1.0, 0.0)), r = at(vec2(1.0, 0.0));
            vec3 d = at(vec2(0.0, -1.0)), u = at(vec2(0.0, 1.0));
            // Размер пикселя в клетках мира: в изометрии зависит только от приближения
            float s = pixelWorld * (ortho > 0.5 ? 1.0 : -c.z);
            // Силуэт: линия только на ближнем пикселе - она тонкая и цвета самого предмета
            float thr = ${glf(DEPTH_EDGE_MIN)} + ${glf(DEPTH_EDGE_PX)} * s;
            float farther = max(max(c.z - l.z, c.z - r.z), max(c.z - d.z, c.z - u.z));
            float de = smoothstep(thr, thr * 2.0, farther);
            // Сгиб: сравнение с правым и верхним соседом даёт линию в один пиксель
            vec3 rr = at(vec2(2.0, 0.0)), ru = at(vec2(1.0, 1.0)), rd = at(vec2(1.0, -1.0));
            vec3 ul = at(vec2(-1.0, 1.0)), uu = at(vec2(0.0, 2.0));
            vec3 nc = normalAt(c, l, r, d, u);
            vec3 nr = normalAt(r, c, rr, rd, ru);
            vec3 nu = normalAt(u, ul, ru, c, uu);
            // Сосед далеко от плоскости пикселя - это не сгиб, а другой предмет
            float gate = ${glf(CREASE_GATE_MIN)} + ${glf(CREASE_GATE_PX)} * s;
            float cr = max((1.0 - dot(nc, nr)) * step(abs(dot(r - c, nc)), gate),
                           (1.0 - dot(nc, nu)) * step(abs(dot(u - c, nc)), gate));
            float ce = smoothstep(${glf(CREASE_LO)}, ${glf(CREASE_HI)}, cr) * ${glf(CREASE_WEIGHT)};
            // Вдали линии слабее, чтобы общий вид не превращался в сетку
            float ppu = 1.0 / (s * pixelRatio);
            float fade = mix(${glf(FADE_MIN)}, 1.0, smoothstep(${glf(FADE_FAR_PPU)}, ${glf(FADE_NEAR_PPU)}, ppu));
            edge = max(de, ce) * fade * lineStrength;
          }
          // Цвет линии - тёмный, с долей тона пикселя; яркие огни (> 1) сначала приводятся к 1
          vec3 tc = color.rgb / max(1.0, max(color.r, max(color.g, color.b)));
          vec3 line = mix(vec3(${[LINE_COLOR.r, LINE_COLOR.g, LINE_COLOR.b].map((c) => glf(+c.toFixed(4))).join(', ')}),
                          tc * ${glf(LINE_DARK)} * vec3(${LINE_WARM.map(glf).join(', ')}), ${glf(LINE_TINT)});
          gl_FragColor = vec4(mix(lit, line, edge), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    // Яркий проход: только то, что светится сильнее порога - огни и блики
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.colorRT.texture }, threshold: { value: 0.62 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform float threshold;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float k = max(0.0, l - threshold) / max(l, 0.0001);
          gl_FragColor = vec4(c * k, 1.0);
        }
      `,
    });
    // Размытие: девять отсчётов в одну сторону, проход повторяется по горизонтали и вертикали
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: this.bloomRT.texture }, dir: { value: new THREE.Vector2() } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 dir;
        varying vec2 vUv;
        void main() {
          vec3 sum = texture2D(tSrc, vUv).rgb * 0.227027;
          sum += (texture2D(tSrc, vUv + dir * 1.3846).rgb + texture2D(tSrc, vUv - dir * 1.3846).rgb) * 0.3162162;
          sum += (texture2D(tSrc, vUv + dir * 3.2308).rgb + texture2D(tSrc, vUv - dir * 3.2308).rgb) * 0.0702702;
          gl_FragColor = vec4(sum, 1.0);
        }
      `,
    });
    this.quadScene.add(this.quad);
  }

  private static createTarget(w: number, h: number): THREE.WebGLRenderTarget {
    // Half float - свет ярче 1.0 не обрезается до тонмаппинга в финальном проходе
    const color = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    color.depthTexture = new THREE.DepthTexture(w, h);
    return color;
  }

  private static createBloomTargets(w: number, h: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    return [new THREE.WebGLRenderTarget(w, h, opts), new THREE.WebGLRenderTarget(w, h, opts)];
  }

  // Буферы пересоздаются целиком: изменение размера буфера со сглаживанием на месте
  // оставляло кадр старого размера
  setSize(w: number, h: number) {
    const pr = this.renderer.getPixelRatio();
    this.colorRT.dispose();
    this.colorRT.depthTexture?.dispose();
    this.colorRT = OutlineRenderer.createTarget(Math.round(w * pr), Math.round(h * pr));
    this.bloomRT.dispose();
    this.blurRT.dispose();
    const bw = Math.max(1, Math.round((w * pr) / 4)), bh = Math.max(1, Math.round((h * pr) / 4));
    [this.bloomRT, this.blurRT] = OutlineRenderer.createBloomTargets(bw, bh);
    this.heightPx = Math.max(1, Math.round(h * pr));
    const u = this.material.uniforms;
    u.tColor.value = this.colorRT.texture;
    u.tDepth.value = this.colorRT.depthTexture;
    u.tBloom.value = this.bloomRT.texture;
    u.texel.value.set(1 / (w * pr), 1 / (h * pr));
    u.pixelRatio.value = pr;
    this.syncLineStrength();
    this.texel.set(1 / bw, 1 / bh);
    this.brightMat.uniforms.tColor.value = this.colorRT.texture;
    this.blurMat.uniforms.tSrc.value = this.bloomRT.texture;
  }

  /** Свечение включается только на устройствах с запасом мощности. */
  setBloom(on: boolean) {
    this.bloom = on;
    this.syncBloom();
  }

  /** Доля свечения огней: 0 - день, 1 - ночь, налёт, бой. */
  setGlow(k: number) {
    if (Math.abs(k - this.glow) < 1e-3) return;
    this.glow = k;
    this.syncBloom();
  }

  private syncBloom() {
    this.material.uniforms.bloomStrength.value = this.bloom ? 0.95 * this.glow : 0;
  }

  /** Контур можно выключить для отладки и сравнения снимков; по умолчанию включён. */
  setOutline(on: boolean) {
    this.outline = on;
    this.syncLineStrength();
  }

  private syncLineStrength() {
    const pr = this.renderer.getPixelRatio();
    const weaken = 1 - LINE_DPR_WEAKEN * THREE.MathUtils.clamp(pr - 1, 0, 1);
    this.material.uniforms.lineStrength.value = this.outline ? LINE_STRENGTH * weaken : 0;
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    // Единственный проход сцены: цвет и глубина. Подсветки, туман и огни прозрачные
    // и глубину не пишут - поэтому контура не дают
    r.setRenderTarget(this.colorRT);
    r.render(scene, camera);

    if (this.bloom && this.glow > 0) {
      // Яркий проход, затем два размытия: по горизонтали и по вертикали
      this.quad.material = this.brightMat;
      this.brightMat.uniforms.tColor.value = this.colorRT.texture;
      r.setRenderTarget(this.bloomRT);
      r.render(this.quadScene, this.quadCam);
      this.quad.material = this.blurMat;
      this.blurMat.uniforms.tSrc.value = this.bloomRT.texture;
      this.blurMat.uniforms.dir.value.set(this.texel.x * 1.6, 0);
      r.setRenderTarget(this.blurRT);
      r.render(this.quadScene, this.quadCam);
      this.blurMat.uniforms.tSrc.value = this.blurRT.texture;
      this.blurMat.uniforms.dir.value.set(0, this.texel.y * 1.6);
      r.setRenderTarget(this.bloomRT);
      r.render(this.quadScene, this.quadCam);
    }

    // Камера для восстановления положения пикселей: в изометрии elements[5] = 2 / видимая высота
    const u = this.material.uniforms;
    u.projInv.value.copy(camera.projectionMatrixInverse);
    u.ortho.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    u.pixelWorld.value = 2 / (camera.projectionMatrix.elements[5] * this.heightPx);
    this.quad.material = this.material;
    u.tBloom.value = this.bloomRT.texture;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
