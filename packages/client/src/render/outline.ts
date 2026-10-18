// Мультяшный контур постобработкой: кадр, глубина и нормали рисуются в текстуры,
// затем полноэкранный шейдер затемняет пиксели на перепадах глубины и нормалей.

import * as THREE from 'three';
import { PALETTE } from './palette';

export class OutlineRenderer {
  private colorRT: THREE.WebGLRenderTarget;
  private normalRT: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer) {
    [this.colorRT, this.normalRT] = OutlineRenderer.createTargets(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tDepth: { value: this.colorRT.depthTexture },
        tNormal: { value: this.normalRT.texture },
        texel: { value: new THREE.Vector2() },
        outline: { value: new THREE.Color(PALETTE.outline) },
        depthScale: { value: 400 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth, tNormal;
        uniform vec2 texel;
        uniform vec3 outline;
        uniform float depthScale;
        varying vec2 vUv;
        float d(vec2 o) { return texture2D(tDepth, vUv + o * texel).r; }
        vec3 n(vec2 o) { return texture2D(tNormal, vUv + o * texel).rgb * 2.0 - 1.0; }
        void main() {
          vec4 color = texture2D(tColor, vUv);
          float dc = d(vec2(0.0));
          float dd = abs(d(vec2(1.0, 0.0)) - dc) + abs(d(vec2(-1.0, 0.0)) - dc)
                   + abs(d(vec2(0.0, 1.0)) - dc) + abs(d(vec2(0.0, -1.0)) - dc);
          vec3 nc = n(vec2(0.0));
          float nd = (1.0 - dot(nc, n(vec2(1.0, 0.0)))) + (1.0 - dot(nc, n(vec2(-1.0, 0.0))))
                   + (1.0 - dot(nc, n(vec2(0.0, 1.0)))) + (1.0 - dot(nc, n(vec2(0.0, -1.0))));
          float edge = clamp(smoothstep(0.02, 0.05, dd * depthScale / 40.0) + smoothstep(0.35, 0.8, nd), 0.0, 1.0);
          if (dc >= 1.0) edge = 0.0;
          gl_FragColor = vec4(mix(color.rgb, outline, edge * 0.85), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  private static createTargets(w: number, h: number): [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] {
    // Half float - свет ярче 1.0 не обрезается до тонмаппинга в финальном проходе
    const color = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    color.depthTexture = new THREE.DepthTexture(w, h);
    return [color, new THREE.WebGLRenderTarget(w, h)];
  }

  // Буферы пересоздаются целиком: изменение размера буфера со сглаживанием на месте
  // оставляло кадр старого размера
  setSize(w: number, h: number) {
    const pr = this.renderer.getPixelRatio();
    this.colorRT.dispose();
    this.colorRT.depthTexture?.dispose();
    this.normalRT.dispose();
    [this.colorRT, this.normalRT] = OutlineRenderer.createTargets(Math.round(w * pr), Math.round(h * pr));
    const u = this.material.uniforms;
    u.tColor.value = this.colorRT.texture;
    u.tDepth.value = this.colorRT.depthTexture;
    u.tNormal.value = this.normalRT.texture;
    u.texel.value.set(1 / (w * pr), 1 / (h * pr));
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
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
