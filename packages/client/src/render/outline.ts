// Мультяшный контур постобработкой: кадр, глубина и нормали рисуются в текстуры,
// затем полноэкранный шейдер затемняет пиксели на перепадах глубины и нормалей.
// Там же свечение ночных огней: яркий проход на четверти разрешения и два размытия.

import * as THREE from 'three';
import { PALETTE } from './palette';

export class OutlineRenderer {
  private colorRT: THREE.WebGLRenderTarget;
  private normalRT: THREE.WebGLRenderTarget;
  private bloomRT: THREE.WebGLRenderTarget;
  private blurRT: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private material: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private bloom = true;
  private texel = new THREE.Vector2();

  constructor(private renderer: THREE.WebGLRenderer) {
    [this.colorRT, this.normalRT] = OutlineRenderer.createTargets(1, 1);
    [this.bloomRT, this.blurRT] = OutlineRenderer.createBloomTargets(1, 1);
    // Туман не должен подмешиваться в буфер нормалей - иначе контур рисуется по всему кадру
    this.normalMat.fog = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tDepth: { value: this.colorRT.depthTexture },
        tNormal: { value: this.normalRT.texture },
        tBloom: { value: this.bloomRT.texture },
        texel: { value: new THREE.Vector2() },
        outline: { value: new THREE.Color(PALETTE.outline) },
        depthScale: { value: 400 },
        lineStrength: { value: 0.85 },
        bloomStrength: { value: 0.95 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth, tNormal, tBloom;
        uniform vec2 texel;
        uniform vec3 outline;
        uniform float depthScale, lineStrength, bloomStrength;
        varying vec2 vUv;
        float d(vec2 o) { return texture2D(tDepth, vUv + o * texel).r; }
        vec3 n(vec2 o) { return texture2D(tNormal, vUv + o * texel).rgb * 2.0 - 1.0; }
        void main() {
          vec4 color = texture2D(tColor, vUv);
          // Свечение ночных огней добавляется до тональной компрессии
          vec3 lit = color.rgb + texture2D(tBloom, vUv).rgb * bloomStrength;
          float dc = d(vec2(0.0));
          float dd = abs(d(vec2(1.0, 0.0)) - dc) + abs(d(vec2(-1.0, 0.0)) - dc)
                   + abs(d(vec2(0.0, 1.0)) - dc) + abs(d(vec2(0.0, -1.0)) - dc);
          vec3 nc = n(vec2(0.0));
          float nd = (1.0 - dot(nc, n(vec2(1.0, 0.0)))) + (1.0 - dot(nc, n(vec2(-1.0, 0.0))))
                   + (1.0 - dot(nc, n(vec2(0.0, 1.0)))) + (1.0 - dot(nc, n(vec2(0.0, -1.0))));
          float edge = clamp(smoothstep(0.02, 0.05, dd * depthScale / 40.0) + smoothstep(0.35, 0.8, nd), 0.0, 1.0);
          if (dc >= 1.0) edge = 0.0;
          gl_FragColor = vec4(mix(lit, outline, edge * lineStrength), 1.0);
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

  private static createTargets(w: number, h: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    // Half float - свет ярче 1.0 не обрезается до тонмаппинга в финальном проходе
    const color = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    color.depthTexture = new THREE.DepthTexture(w, h);
    return [color, new THREE.WebGLRenderTarget(w, h)];
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
    this.normalRT.dispose();
    [this.colorRT, this.normalRT] = OutlineRenderer.createTargets(Math.round(w * pr), Math.round(h * pr));
    this.bloomRT.dispose();
    this.blurRT.dispose();
    const bw = Math.max(1, Math.round((w * pr) / 4)), bh = Math.max(1, Math.round((h * pr) / 4));
    [this.bloomRT, this.blurRT] = OutlineRenderer.createBloomTargets(bw, bh);
    const u = this.material.uniforms;
    u.tColor.value = this.colorRT.texture;
    u.tDepth.value = this.colorRT.depthTexture;
    u.tNormal.value = this.normalRT.texture;
    u.tBloom.value = this.bloomRT.texture;
    u.texel.value.set(1 / (w * pr), 1 / (h * pr));
    this.texel.set(1 / bw, 1 / bh);
    this.brightMat.uniforms.tColor.value = this.colorRT.texture;
    this.blurMat.uniforms.tSrc.value = this.bloomRT.texture;
  }

  /** Свечение включается только на устройствах с запасом мощности. */
  setBloom(on: boolean) {
    this.bloom = on;
    this.material.uniforms.bloomStrength.value = on ? 0.95 : 0;
  }

  /** Контур можно выключить для сравнения снимков (?fx=-outline); по умолчанию включён. */
  setOutline(on: boolean) {
    this.material.uniforms.lineStrength.value = on ? 0.85 : 0;
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    r.setRenderTarget(this.colorRT);
    r.render(scene, camera);
    const bg = scene.background;
    scene.background = null;
    // Подсветки и туман не обводим контуром - иначе по земле идёт сетка линий
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => { if (o.userData.noOutline && o.visible) { o.visible = false; hidden.push(o); } });
    scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.normalRT);
    r.setClearColor(0x808080, 1);
    r.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of hidden) o.visible = true;
    scene.background = bg;

    if (this.bloom) {
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

    this.quad.material = this.material;
    this.material.uniforms.tBloom.value = this.bloomRT.texture;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
