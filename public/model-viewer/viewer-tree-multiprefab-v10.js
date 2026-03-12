import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { DDSLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DDSLoader.js';

const app = document.getElementById('app');
const viewport = document.getElementById('viewport') || app;
const exportRootInput = document.getElementById('export-root');
const refreshButton = document.getElementById('refresh-models');
const searchInput = document.getElementById('model-search');
const modelList = document.getElementById('model-list');
const catalogStatus = document.getElementById('catalog-status');
const viewerStatus = document.getElementById('viewer-status');
const currentModelName = document.getElementById('current-model-name');
const autoRotateInput = document.getElementById('auto-rotate');

function setStatus(text, isError = false) {
  if (!viewerStatus) return;
  viewerStatus.textContent = text || '';
  viewerStatus.classList.toggle('error', !!isError);
}

function fatal(err) {
  console.error(err);
  const message = `Error:
${err?.stack || err?.message || String(err)}`;
  setStatus(message, true);
}

function getRequiredParam(name) {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  if (!value) throw new Error(`Missing query param: ${name}`);
  return value;
}

function getOptionalParam(name, fallback = null) {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  return value == null || value === '' ? fallback : value;
}

function getOptionalNumberParam(name, fallback) {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(name);
  if (raw == null || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function resolveUrl(relOrAbs, baseUrl) {
  return new URL(relOrAbs, baseUrl).toString();
}

function dirnameUrl(urlString) {
  const u = new URL(urlString, window.location.href);
  const path = u.pathname;
  const cut = path.lastIndexOf('/');
  u.pathname = cut >= 0 ? path.slice(0, cut + 1) : '/';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function pathBasenameNoExt(urlString) {
  const u = new URL(urlString, window.location.href);
  const parts = u.pathname.split('/');
  const last = parts[parts.length - 1] || 'model';
  const dot = last.lastIndexOf('.');
  return dot >= 0 ? last.slice(0, dot) : last;
}

function normalizeColorInput(value, fallback = [1, 1, 1]) {
  if (Array.isArray(value) && value.length >= 3) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  if (value && typeof value === 'object') {
    if ('r' in value && 'g' in value && 'b' in value) {
      return [Number(value.r) || 0, Number(value.g) || 0, Number(value.b) || 0];
    }
    if ('x' in value && 'y' in value && 'z' in value) {
      return [Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0];
    }
  }
  return fallback.slice(0, 3);
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  viewport.appendChild(renderer.domElement);
  return renderer;
}

function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  return scene;
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.01, 1000);
  camera.position.set(0, 1.35, 4.25);
  return camera;
}

function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xc8f2ff, 0x5f5242, 0.08);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(3.6, 5.8, 2.4);
  dir.target.position.set(0, 0.7, 0);
  scene.add(dir);
  scene.add(dir.target);

  return { mainLight: dir, hemiLight: hemi };
}

function autoUprightObject(object) {
  if (!object) return false;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!Number.isFinite(size.x + size.y + size.z)) return false;

  // Heuristic: multiprefab scene exports can arrive with Z as the visual "up" axis.
  // If Z is clearly taller than Y, rotate the loaded root upright for viewing.
  if (size.z > size.y * 1.2 && size.z >= size.x) {
    object.rotation.x = -Math.PI * 0.5;
    object.updateMatrixWorld(true);
    return true;
  }

  if (size.x > size.y * 1.2 && size.x > size.z) {
    object.rotation.z = Math.PI * 0.5;
    object.updateMatrixWorld(true);
    return true;
  }

  return false;
}

function fitCameraToObject(camera, controls, object, offset = 1.35) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
  cameraZ *= offset;

  camera.position.set(center.x + cameraZ * 0.38, center.y + maxDim * 0.24, center.z + cameraZ);
  camera.near = Math.max(0.01, maxDim / 1000);
  camera.far = Math.max(1000, maxDim * 20);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function installResize(renderer, camera) {
  window.addEventListener('resize', () => {
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  });
}

function createSolidTexture({ r = 0, g = 0, b = 0, a = 255, colorSpace = THREE.NoColorSpace } = {}) {
  const data = new Uint8Array([r, g, b, a]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createTextureLoaders() {
  const manager = new THREE.LoadingManager();
  const texLoader = new THREE.TextureLoader(manager);
  const ddsLoader = new DDSLoader(manager);
  const textureCache = new Map();
  const objectUrls = [];

  const blackGradTex = createSolidTexture({ r: 0, g: 0, b: 0, a: 255, colorSpace: THREE.NoColorSpace });
  const transparentGradTex = createSolidTexture({ r: 0, g: 0, b: 0, a: 0, colorSpace: THREE.NoColorSpace });

  function isDDS(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
    const u8 = new Uint8Array(arrayBuffer, 0, 4);
    return u8[0] === 0x44 && u8[1] === 0x44 && u8[2] === 0x53 && u8[3] === 0x20;
  }

  function applyGradMatTextureState(tex, { isSlot = false } = {}) {
    if (!tex) return tex;
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (!tex.isCompressedTexture) tex.generateMipmaps = !isSlot;
    tex.needsUpdate = true;
    return tex;
  }

  function applyFallbackTextureState(tex) {
    if (!tex) return tex;
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  async function fetchArrayBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.arrayBuffer();
  }

  function loadBlobTexture(blob) {
    const objectUrl = URL.createObjectURL(blob);
    objectUrls.push(objectUrl);
    return new Promise((resolve, reject) => {
      texLoader.load(
          objectUrl,
          resolve,
          undefined,
          (err) => reject(new Error(`Failed to decode image blob: ${err?.message || err}`))
      );
    });
  }

  async function decodeTextureFromArrayBuffer(arrayBuffer, { gradMat = false, isSlot = false } = {}) {
    let tex;
    if (isDDS(arrayBuffer)) tex = ddsLoader.parse(arrayBuffer, true);
    else tex = await loadBlobTexture(new Blob([arrayBuffer]));
    return gradMat ? applyGradMatTextureState(tex, { isSlot }) : applyFallbackTextureState(tex);
  }

  async function loadTexture(url, { gradMat = false, isSlot = false } = {}) {
    const cacheKey = `${url}::${gradMat ? 'grad' : 'fallback'}::${isSlot ? 'slot' : 'nonslot'}`;
    if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
    const promise = (async () => {
      const arrayBuffer = await fetchArrayBuffer(url);
      return await decodeTextureFromArrayBuffer(arrayBuffer, { gradMat, isSlot });
    })();
    textureCache.set(cacheKey, promise);
    try { return await promise; } catch (err) { textureCache.delete(cacheKey); throw err; }
  }

  async function loadTextureFromArrayBuffer(arrayBuffer, { gradMat = false, isSlot = false, cacheKey = null } = {}) {
    const key = cacheKey || `embedded::${gradMat ? 'grad' : 'fallback'}::${isSlot ? 'slot' : 'nonslot'}::${arrayBuffer.byteLength}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const promise = decodeTextureFromArrayBuffer(arrayBuffer, { gradMat, isSlot });
    textureCache.set(key, promise);
    try { return await promise; } catch (err) { textureCache.delete(key); throw err; }
  }

  function dispose() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.length = 0;
  }

  return {
    loadTexture,
    loadTextureFromArrayBuffer,
    blackGradTex,
    transparentGradTex,
    dispose
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function buildHmdByName(hmdMaterials) {
  const hmdByName = new Map();
  for (const m of hmdMaterials) {
    for (const n of [m.name, m.materialName, m.hmdMaterialName, m.meshMaterialName].filter(Boolean)) {
      hmdByName.set(String(n), m);
    }
  }
  return hmdByName;
}

function normalizeModelManifest(modelRaw) {
  const hmdMaterials = Array.isArray(modelRaw?.hmdMaterials) ? modelRaw.hmdMaterials : [];
  return {
    raw: modelRaw || {},
    path: modelRaw?.path || null,
    name: modelRaw?.name || modelRaw?.nodeName || null,
    nodeName: modelRaw?.nodeName || modelRaw?.name || null,
    grad: modelRaw?.gradMat || null,
    hmdMaterials,
    hmdByName: buildHmdByName(hmdMaterials),
    materialOverrides: Array.isArray(modelRaw?.materialOverrides) ? modelRaw.materialOverrides : [],
    warnings: Array.isArray(modelRaw?.warnings) ? modelRaw.warnings : [],
  };
}

function normalizeManifest(manifestRaw) {
  const models = Array.isArray(manifestRaw?.models) ? manifestRaw.models.map(normalizeModelManifest) : [];
  const hmdMaterials = Array.isArray(manifestRaw?.hmdMaterials) ? manifestRaw.hmdMaterials : [];
  return {
    raw: manifestRaw || {},
    grad: manifestRaw?.gradMat || null,
    hmdMaterials,
    hmdByName: buildHmdByName(hmdMaterials),
    models,
    primaryModelPath: manifestRaw?.primaryModelPath || null,
    warnings: Array.isArray(manifestRaw?.warnings) ? manifestRaw.warnings : [],
  };
}

async function extractEmbeddedProjectData(gltf) {
  const json = gltf?.parser?.json || null;
  const project = json?.extras?.prefabToGltf || null;
  if (!project) return { manifest: null, embeddedBuffers: null };
  const embeddedBuffers = new Map();
  const textures = Array.isArray(project.embeddedTextures) ? project.embeddedTextures : [];
  for (const tex of textures) {
    if (tex == null || tex.bufferView == null || !tex.path) continue;
    const arrayBuffer = await gltf.parser.getDependency('bufferView', tex.bufferView);
    embeddedBuffers.set(String(tex.path), { arrayBuffer, meta: tex });
  }
  return { manifest: normalizeManifest(project.manifest || null), embeddedBuffers };
}

function traverseMeshes(root, fn) {
  root.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) fn(obj);
  });
}

function getMaterialArray(material) {
  return Array.isArray(material) ? material : [material];
}

function setMaterialArray(mesh, mats) {
  mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
}

function getBestAttribute(geometry, names) {
  for (const name of names) {
    const attr = geometry.getAttribute(name);
    if (attr) return attr;
  }
  return null;
}

function ensureGradMatAttributes(mesh) {
  const geometry = mesh.geometry;
  let changed = false;
  let nextGeometry = geometry;

  const maskSource =
      getBestAttribute(geometry, ['uv1', 'uv2', 'texcoord_1', 'TEXCOORD_1']) ||
      getBestAttribute(geometry, ['uv']);

  if (!maskSource) {
    throw new Error(`Mesh ${mesh.name || '(unnamed)'} is missing UVs required for GradMat.`);
  }

  if (!geometry.getAttribute('aMaskUv')) {
    if (!changed) {
      nextGeometry = geometry.clone();
      changed = true;
    }
    nextGeometry.setAttribute('aMaskUv', maskSource.clone());
  }

  if (changed) mesh.geometry = nextGeometry;
}

async function loadOutTexture(relPath, manifestBase, textureLoaders, opts = {}, embeddedBuffers = null) {
  if (!relPath) return null;
  if (embeddedBuffers && embeddedBuffers.has(relPath)) {
    const entry = embeddedBuffers.get(relPath);
    return await textureLoaders.loadTextureFromArrayBuffer(entry.arrayBuffer, { ...opts, cacheKey: `embedded::${relPath}::${opts.gradMat ? 'grad' : 'fallback'}::${opts.isSlot ? 'slot' : 'nonslot'}` });
  }
  const url = resolveUrl(relPath, manifestBase);
  return await textureLoaders.loadTexture(url, opts);
}

function trimTrailingEmptySlots(slotSpecs) {
  const trimmed = slotSpecs.slice();
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (last && (last.out || last.resolvedTexture || last.id)) break;
    trimmed.pop();
  }
  return trimmed;
}

async function prepareGradMatResources(grad, manifestBase, textureLoaders, embeddedBuffers = null) {
  if (!grad) return null;

  const rawSlots = Array.isArray(grad.resolvedSlots) ? grad.resolvedSlots : [];
  const slotSpecs = trimTrailingEmptySlots(rawSlots);
  const numSlots = slotSpecs.length;
  const maxSlots = Math.max(1, Number(grad.maxSlots ?? grad.shaderMaxSlots ?? 8) || 8);
  if (numSlots <= 0) return null;

  const slotTextures = new Array(numSlots).fill(textureLoaders.blackGradTex);
  for (let i = 0; i < numSlots; i++) {
    const relOut = slotSpecs[i]?.out;
    if (!relOut) {
      throw new Error(`GradMat slot ${i} (${slotSpecs[i]?.id || 'unknown'}) has no output texture path.`);
    }
    slotTextures[i] = await loadOutTexture(relOut, manifestBase, textureLoaders, { gradMat: true, isSlot: true }, embeddedBuffers);
  }

  const linesTex = await loadOutTexture(grad.linesOut, manifestBase, textureLoaders, { gradMat: true }, embeddedBuffers);
  if (!linesTex) throw new Error('GradMat lines texture is missing.');

  const patternTex = await loadOutTexture(grad.patternOut, manifestBase, textureLoaders, { gradMat: true }, embeddedBuffers);
  const alphaPatternTex = await loadOutTexture(grad.patternAlphaOut, manifestBase, textureLoaders, { gradMat: true }, embeddedBuffers);

  const markSpecs = Array.isArray(grad.marksOut) ? grad.marksOut.slice(0, 4) : [];
  const markTextures = new Array(4).fill(null);
  for (let i = 0; i < 4; i++) {
    const rel = markSpecs[i];
    markTextures[i] = rel
        ? await loadOutTexture(rel, manifestBase, textureLoaders, { gradMat: true }, embeddedBuffers)
        : textureLoaders.transparentGradTex;
  }

  return {
    slotTextures,
    linesTex,
    patternTex,
    alphaPatternTex,
    markTextures,
    numSlots,
    maxSlots,
    discardSlot0: !!grad.discardSlot0,
    linesBlend: Number.isFinite(grad.linesBlend) ? grad.linesBlend : 1,
    ambientIntensity: Number.isFinite(grad.ambientIntensity) ? grad.ambientIntensity : 1,
    ambientColor: normalizeColorInput(grad.ambientColor, [1, 1, 1]),
    shadowBias: Number.isFinite(grad.shadowBias) ? grad.shadowBias : 0,
    shadowSmooth: Number.isFinite(grad.shadowSmooth) ? grad.shadowSmooth : 0.002,
    lightSmooth: Number.isFinite(grad.lightSmooth) ? grad.lightSmooth : 0.1,
    terminatorSize: Number.isFinite(grad.terminatorSize) ? grad.terminatorSize : 0.1,
    minLightPower: Number.isFinite(grad.minLightPower) ? grad.minLightPower : 0.25,
    specSize: Number.isFinite(grad.specSize) ? grad.specSize : 0.03,
    specInsideSize: Number.isFinite(grad.specInsideSize) ? grad.specInsideSize : 0.35,
    specInsideIntensity: Number.isFinite(grad.specInsideIntensity) ? grad.specInsideIntensity : 0,
    specSmooth: Number.isFinite(grad.specSmooth) ? grad.specSmooth : 0.002,
    specAlpha: Number.isFinite(grad.specAlpha) ? grad.specAlpha : 1,
    emissivePow: Number.isFinite(grad.emissivePow) ? grad.emissivePow : 0,
    rimLightAngle: Number.isFinite(grad.rimLightAngle) ? grad.rimLightAngle : 30,
    rimLightWidth: Number.isFinite(grad.rimLightWidth) ? grad.rimLightWidth : 2,
    rimLightSize: Number.isFinite(grad.rimLightSize) ? grad.rimLightSize * 0.1 : 0.01,
    rimLightSmooth: Number.isFinite(grad.rimLightSmooth) ? grad.rimLightSmooth * 0.1 : 0.01,
    rimLightMin: Number.isFinite(grad.rimLightMin) ? grad.rimLightMin : 0.5,
    rimLightSpecMultiplier: Number.isFinite(grad.rimLightSpecMultiplier) ? grad.rimLightSpecMultiplier : 1,
    rimLightColor: normalizeColorInput(grad.rimLightColor, [0, 0, 0])
  };
}

function buildMainLightDir(light) {
  const targetPos = new THREE.Vector3();
  const lightPos = new THREE.Vector3();
  light.target.getWorldPosition(targetPos);
  light.getWorldPosition(lightPos);
  return targetPos.sub(lightPos).normalize();
}

function makeGradMatUniforms(resources, viewerLighting) {
  return {
    uSlot0: { value: resources.slotTextures[0] || null },
    uSlot1: { value: resources.slotTextures[1] || null },
    uSlot2: { value: resources.slotTextures[2] || null },
    uSlot3: { value: resources.slotTextures[3] || null },
    uSlot4: { value: resources.slotTextures[4] || null },
    uSlot5: { value: resources.slotTextures[5] || null },
    uSlot6: { value: resources.slotTextures[6] || null },
    uSlot7: { value: resources.slotTextures[7] || null },

    uLinesTex: { value: resources.linesTex },
    uPatternTex: { value: resources.patternTex },
    uAlphaPatternTex: { value: resources.alphaPatternTex },
    uMark0: { value: resources.markTextures[0] || null },
    uMark1: { value: resources.markTextures[1] || null },
    uMark2: { value: resources.markTextures[2] || null },
    uMark3: { value: resources.markTextures[3] || null },

    uNumSlots: { value: resources.numSlots },
    uMaxSlots: { value: resources.maxSlots },
    uUsePattern: { value: !!resources.patternTex },
    uUseAlphaPattern: { value: !!resources.alphaPatternTex },
    uUseMarking: { value: resources.markTextures.some(Boolean) },
    uDiscardSlot0: { value: !!resources.discardSlot0 },

    uLinesBlend: { value: resources.linesBlend },
    uAmbientColor: { value: new THREE.Color(...resources.ambientColor) },
    uAmbientIntensity: { value: resources.ambientIntensity },

    uShadowBias: { value: resources.shadowBias },
    uShadowSmooth: { value: resources.shadowSmooth },
    uLightSmooth: { value: resources.lightSmooth },
    uTerminatorSize: { value: resources.terminatorSize },
    uMinLightPower: { value: resources.minLightPower },

    uMainLightColor: { value: new THREE.Color(...viewerLighting.mainLightColor) },
    uMainLightIntensity: { value: viewerLighting.mainLightIntensity },
    uMainLightDir: { value: new THREE.Vector3(0, -1, 0) },
    uMainLightPower: { value: viewerLighting.mainLightPower },
    uShadow: { value: viewerLighting.shadow },
    uCameraPos: { value: new THREE.Vector3() },

    uSpecSize: { value: resources.specSize },
    uSpecInsideSize: { value: resources.specInsideSize },
    uSpecInsideIntensity: { value: resources.specInsideIntensity },
    uSpecSmooth: { value: resources.specSmooth },
    uSpecAlpha: { value: resources.specAlpha },
    uEmissivePow: { value: resources.emissivePow },

    uRimLightAngle: { value: resources.rimLightAngle },
    uRimLightWidth: { value: resources.rimLightWidth },
    uRimLightSize: { value: resources.rimLightSize },
    uRimLightSmooth: { value: resources.rimLightSmooth },
    uRimLightMin: { value: resources.rimLightMin },
    uRimLightSpecMultiplier: { value: resources.rimLightSpecMultiplier },
    uRimLightColor: { value: new THREE.Color(...resources.rimLightColor) }
  };
}

function getGradMatVertexShader() {
  return `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec2 aMaskUv;

varying vec2 vGradUv;
varying vec2 vMaskUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;

void main() {
  vGradUv = uv;
  vMaskUv = aMaskUv;

  vec3 objectNormal = normalize(normal);
  vec3 transformed = position;

  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vViewNormal = normalize(normalMatrix * objectNormal);

  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
`;
}

function getGradMatFragmentShader() {
  return `
precision highp float;

#include <common>
#include <logdepthbuf_pars_fragment>

varying vec2 vGradUv;
varying vec2 vMaskUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;

uniform sampler2D uSlot0;
uniform sampler2D uSlot1;
uniform sampler2D uSlot2;
uniform sampler2D uSlot3;
uniform sampler2D uSlot4;
uniform sampler2D uSlot5;
uniform sampler2D uSlot6;
uniform sampler2D uSlot7;

uniform sampler2D uLinesTex;
uniform sampler2D uPatternTex;
uniform sampler2D uAlphaPatternTex;
uniform sampler2D uMark0;
uniform sampler2D uMark1;
uniform sampler2D uMark2;
uniform sampler2D uMark3;

uniform int uNumSlots;
uniform int uMaxSlots;
uniform bool uUsePattern;
uniform bool uUseAlphaPattern;
uniform bool uUseMarking;
uniform bool uDiscardSlot0;

uniform float uLinesBlend;
uniform vec3 uAmbientColor;
uniform float uAmbientIntensity;

uniform float uShadowBias;
uniform float uShadowSmooth;
uniform float uLightSmooth;
uniform float uTerminatorSize;
uniform float uMinLightPower;

uniform vec3 uMainLightColor;
uniform float uMainLightIntensity;
uniform vec3 uMainLightDir;
uniform float uMainLightPower;
uniform float uShadow;
uniform vec3 uCameraPos;

uniform float uSpecSize;
uniform float uSpecInsideSize;
uniform float uSpecInsideIntensity;
uniform float uSpecSmooth;
uniform float uSpecAlpha;
uniform float uEmissivePow;

uniform float uRimLightAngle;
uniform float uRimLightWidth;
uniform float uRimLightSize;
uniform float uRimLightSmooth;
uniform float uRimLightMin;
uniform float uRimLightSpecMultiplier;
uniform vec3 uRimLightColor;

float invLerp(float a, float x, float y) {
  return clamp((a - x) / max(y - x, 0.00001), 0.0, 1.0);
}

vec3 blendOverlay(vec3 base, vec3 over, float alpha) {
  vec3 overlay = mix(
    2.0 * base * over,
    1.0 - 2.0 * (1.0 - base) * (1.0 - over),
    step(vec3(0.5), base)
  );
  return mix(base, overlay, alpha);
}

vec4 sampleSlotTex(int slotIndex, vec2 uvv) {
  if (slotIndex <= 0) return texture2D(uSlot0, uvv);
  if (slotIndex == 1) return texture2D(uSlot1, uvv);
  if (slotIndex == 2) return texture2D(uSlot2, uvv);
  if (slotIndex == 3) return texture2D(uSlot3, uvv);
  if (slotIndex == 4) return texture2D(uSlot4, uvv);
  if (slotIndex == 5) return texture2D(uSlot5, uvv);
  if (slotIndex == 6) return texture2D(uSlot6, uvv);
  return texture2D(uSlot7, uvv);
}

vec4 sampleMarkTex(int idx, vec2 uvv) {
  if (idx <= 0) return texture2D(uMark0, uvv);
  if (idx == 1) return texture2D(uMark1, uvv);
  if (idx == 2) return texture2D(uMark2, uvv);
  return texture2D(uMark3, uvv);
}

float lambertTerm(vec3 N) {
  return dot(N, -uMainLightDir) - uShadowBias;
}

float specularTerm(vec3 N, vec3 V) {
  vec3 halfVec = normalize((-uMainLightDir) + V);
  float NdH = dot(N, halfVec);
  float spec = clamp((NdH - 1.0 + uSpecSize + uSpecSmooth) / (uSpecSmooth + 0.00001), 0.0, 1.0);
  float specInside = clamp((NdH - 1.0 + uSpecSize * uSpecInsideSize + uSpecSmooth) / (uSpecSmooth + 0.00001), 0.0, 1.0);
  return spec + specInside * uSpecInsideIntensity;
}

float remap(float value, float valMin, float valMax, float tgtMin, float tgtMax) {
  return tgtMin + (value - valMin) * (tgtMax - tgtMin) / max(valMax - valMin, 0.00001);
}

float rimLightingTerm(vec3 N, vec3 V, vec3 viewNormal) {
  float angle = uRimLightAngle * (PI / 180.0);
  vec2 rimLightDir = vec2(cos(angle), sin(angle));
  vec2 camNormal = viewNormal.xy;
  float camNormalLen = length(camNormal);
  if (camNormalLen > 0.00001) camNormal /= camNormalLen;
  float directionnality = dot(rimLightDir, camNormal);
  directionnality = remap(directionnality, 0.0, 1.0, 0.0, uRimLightWidth);
  float fresnel = clamp(1.0 - pow(max(dot(V, N), 0.0), 5.0), 0.0, 1.0);
  float rimBase = fresnel * directionnality;
  float rimLightPower = max(uRimLightMin, uShadow);
  float rimLight = clamp((rimBase - 1.0 + uRimLightSize + uRimLightSmooth) / (uRimLightSmooth + 0.00001), 0.0, 1.0) * rimLightPower;
  return rimLight;
}

int computeSlot(vec2 gradUv) {
  int safeNumSlots = max(uNumSlots, 1);
  int safeMaxSlots = max(uMaxSlots, 1);
  return int(clamp(floor(gradUv.x * float(safeMaxSlots)), 0.0, float(safeNumSlots - 1)));
}

void main() {
  #include <logdepthbuf_fragment>

  int slot = computeSlot(vGradUv);
  if (uDiscardSlot0 && slot == 0) discard;

  vec3 albedoColor = sampleSlotTex(slot, vec2(0.1 / 6.0, vGradUv.y)).rgb;
  vec3 ambientedAlbedo = albedoColor * uAmbientColor;
  albedoColor = mix(albedoColor, ambientedAlbedo, uAmbientIntensity);
  vec3 shadowColor = sampleSlotTex(slot, vec2(1.1 / 6.0, vGradUv.y)).rgb * albedoColor;
  vec3 terminatorColor = sampleSlotTex(slot, vec2(2.1 / 6.0, vGradUv.y)).rgb;
  vec3 specColor = sampleSlotTex(slot, vec2(3.1 / 6.0, vGradUv.y)).rgb;
  vec3 emissiveColor = sampleSlotTex(slot, vec2(4.1 / 6.0, vGradUv.y)).rgb * uEmissivePow;

  vec4 lines = texture2D(uLinesTex, vMaskUv);

  if (uUsePattern || uUseAlphaPattern) {
    if (vMaskUv.x >= 0.49 && vMaskUv.y >= 0.49) {
      vec2 puv = (vMaskUv - 0.5) * 2.0;
      if (uUseAlphaPattern) {
        if (texture2D(uAlphaPatternTex, puv).x < 0.5) discard;
      }
      if (uUsePattern) {
        lines = texture2D(uPatternTex, puv);
      }
    }
  }

  if (uUseMarking) {
    if (vMaskUv.x >= 0.49 && vMaskUv.y >= 0.49) {
      vec2 puv = (vMaskUv - 0.5) * 4.0;
      float idxf = floor(puv.x) + floor(puv.y) * 2.0;
      vec2 fuv = fract(puv);
      int idx = int(clamp(idxf, 0.0, 3.0));
      vec4 marks = sampleMarkTex(idx, fuv);
      lines.xyz = blendOverlay(lines.xyz, marks.xyz, marks.a);
      lines.w = max(lines.w, marks.w);
    }
  }

  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 viewNormal = normalize(vViewNormal);

  float ndl = lambertTerm(N);
  float castShadow = max(uShadow, uMinLightPower);
  float lighting = invLerp(ndl, -uShadowSmooth, uShadowSmooth);

  vec3 litColor = albedoColor + specColor * specularTerm(N, V) * uSpecAlpha;
  litColor += uMainLightColor * uMainLightIntensity * lighting * uShadow;

  vec3 pixelColor = mix(
    shadowColor,
    litColor,
    vec3((lighting * castShadow) * max(uMainLightPower, uMinLightPower))
  );

  float termShadow = invLerp(ndl, -uShadowSmooth, uShadowSmooth);
  float lightSmoothRelative = uLightSmooth * uTerminatorSize;
  float termLight = 1.0 - invLerp(ndl, uTerminatorSize - lightSmoothRelative, uTerminatorSize + lightSmoothRelative);
  float terminatorAlpha = min(min(termShadow, termLight) * castShadow, uMainLightPower);
  pixelColor = blendOverlay(pixelColor, terminatorColor, terminatorAlpha);

  vec3 rimColor = albedoColor + specColor * uRimLightSpecMultiplier + uRimLightColor;
  float rimLighting = rimLightingTerm(N, V, viewNormal);
  pixelColor = mix(pixelColor, rimColor, rimLighting);

  pixelColor = blendOverlay(pixelColor, lines.xyz, uLinesBlend * lines.w);
  pixelColor += emissiveColor;
  pixelColor *= pixelColor;

  gl_FragColor = vec4(clamp(pixelColor, 0.0, 1.0), 1.0);
}
`;
}

function makeGradMatMaterial(resources, viewerLighting) {
  const uniforms = makeGradMatUniforms(resources, viewerLighting);
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: getGradMatVertexShader(),
    fragmentShader: getGradMatFragmentShader(),
    side: THREE.DoubleSide,
    transparent: false
  });
}

function applyFallbackMaterialDefaults(mat) {
  if (!mat) return;
  if ('metalness' in mat) mat.metalness = 0;
  if ('roughness' in mat) mat.roughness = 1;
  if ('color' in mat) mat.color.set(0xffffff);
  mat.needsUpdate = true;
}


function gatherWrapperRoots(root) {
  const byPath = new Map();
  const wrappers = new Set();
  root.traverse((obj) => {
    if (obj?.userData?.prefabType === 'model' && obj?.userData?.prefabPath) {
      byPath.set(String(obj.userData.prefabPath), obj);
      wrappers.add(obj);
    }
  });
  return { byPath, wrappers };
}

function collectMeshesForWrapper(wrapperRoot, wrapperSet) {
  const meshes = [];
  function visit(obj) {
    if (obj !== wrapperRoot && wrapperSet.has(obj)) return;
    if (obj.isMesh || obj.isSkinnedMesh) meshes.push(obj);
    for (const child of obj.children || []) visit(child);
  }
  visit(wrapperRoot);
  return meshes;
}

function getModelManifestForWrapper(wrapperPath, manifest) {
  return manifest.models.find((m) => m.path === wrapperPath) || null;
}

function pickMaterialOverride(modelManifest) {
  return (modelManifest?.materialOverrides || []).find(Boolean) || null;
}

function parseFresnelOverride(override) {
  if (!override?.raw) return null;
  const shader = (Array.isArray(override.raw.children) ? override.raw.children : []).find((child) => {
    const src = String(child?.source || '');
    return /Fresnel\.hx$/i.test(src) || /Fresnel/i.test(child?.name || '');
  });
  if (!shader) return null;
  const props = shader.props || {};
  const pbr = override.raw.props?.PBR || {};
  return {
    color: normalizeColorInput(props.color, [0.0, 0.07, 1.0]),
    bias: Number.isFinite(props.bias) ? props.bias : 0.0,
    scale: Number.isFinite(props.scale) ? props.scale : 1.0,
    power: Number.isFinite(props.power) ? props.power : 2.0,
    totalAlpha: Number.isFinite(props.totalAlpha) ? props.totalAlpha : 1.0,
    reverse: !!props.REVERSE,
    additive: String(pbr.blend || '').toLowerCase() === 'add',
    culling: String(pbr.culling || '').toLowerCase(),
  };
}

function makeFresnelMaterial(config) {
  const uniforms = {
    uColor: { value: new THREE.Color(...config.color) },
    uBias: { value: config.bias },
    uScale: { value: config.scale },
    uPower: { value: config.power },
    uAlpha: { value: config.totalAlpha },
    uReverse: { value: config.reverse ? 1.0 : 0.0 },
    uCameraPos: { value: new THREE.Vector3() },
  };
  const vertexShader = `
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;
  const fragmentShader = `
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    uniform vec3 uColor;
    uniform float uBias;
    uniform float uScale;
    uniform float uPower;
    uniform float uAlpha;
    uniform float uReverse;
    uniform vec3 uCameraPos;
    void main() {
      vec3 N = normalize(vWorldNormal);
      vec3 V = normalize(uCameraPos - vWorldPos);
      float ndv = clamp(dot(N, V), 0.0, 1.0);
      float fresnelBase = mix(1.0 - ndv, ndv, step(0.5, uReverse));
      float fresnel = clamp(uBias + uScale * pow(fresnelBase, max(uPower, 0.0001)), 0.0, 1.0);
      gl_FragColor = vec4(uColor * fresnel, fresnel * uAlpha);
    }
  `;
  let side = THREE.DoubleSide;
  if (config.culling === 'front') side = THREE.BackSide;
  else if (config.culling === 'back') side = THREE.FrontSide;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side,
  });
}

async function applyMaterials(root, manifest, manifestUrl, textureLoaders, mainLight, camera, viewerLighting, embeddedBuffers = null) {
  const manifestBase = manifestUrl ? dirnameUrl(manifestUrl) : window.location.href;
  const { byPath, wrappers } = gatherWrapperRoots(root);
  const wrapperEntries = manifest.models.length ? manifest.models : [normalizeModelManifest({ path: manifest.primaryModelPath || null, gradMat: manifest.grad, hmdMaterials: manifest.hmdMaterials })];

  const applyGradToMeshList = async (meshList, modelManifest) => {
    const gradResources = await prepareGradMatResources(modelManifest.grad, manifestBase, textureLoaders, embeddedBuffers);
    if (!gradResources) return false;
    for (const mesh of meshList) ensureGradMatAttributes(mesh);
    const resourcesAmbient = gradResources?.ambientIntensity ?? 0;
    const updateShaderUniforms = (shaderMat) => {
      shaderMat.uniforms.uMainLightDir.value.copy(buildMainLightDir(mainLight));
      shaderMat.uniforms.uMainLightColor.value.setRGB(...viewerLighting.mainLightColor);
      shaderMat.uniforms.uMainLightIntensity.value = viewerLighting.mainLightIntensity;
      shaderMat.uniforms.uMainLightPower.value = viewerLighting.mainLightPower;
      shaderMat.uniforms.uShadow.value = viewerLighting.shadow;
      shaderMat.uniforms.uAmbientIntensity.value = Math.max(0, Math.min(2, resourcesAmbient + viewerLighting.ambientBoost));
      shaderMat.uniforms.uCameraPos.value.copy(camera.position);
    };
    for (const mesh of meshList) {
      const oldMats = getMaterialArray(mesh.material);
      const newMats = [];
      for (let i = 0; i < oldMats.length; i++) {
        const shaderMat = makeGradMatMaterial(gradResources, viewerLighting);
        updateShaderUniforms(shaderMat);
        newMats.push(shaderMat);
      }
      setMaterialArray(mesh, newMats);
      mesh.onBeforeRender = () => {
        const mats = getMaterialArray(mesh.material);
        for (const mat of mats) {
          if (mat?.uniforms?.uMainLightDir) updateShaderUniforms(mat);
        }
      };
    }
    return true;
  };

  const applyOverrideToMeshList = async (meshList, modelManifest) => {
    const override = pickMaterialOverride(modelManifest);
    const fresnel = parseFresnelOverride(override);
    if (!fresnel) return false;
    for (const mesh of meshList) {
      const oldMats = getMaterialArray(mesh.material);
      const newMats = oldMats.map(() => {
        const mat = makeFresnelMaterial(fresnel);
        return mat;
      });
      setMaterialArray(mesh, newMats);
      mesh.onBeforeRender = () => {
        const mats = getMaterialArray(mesh.material);
        for (const mat of mats) {
          if (mat?.uniforms?.uCameraPos) mat.uniforms.uCameraPos.value.copy(camera.position);
        }
      };
    }
    return true;
  };

  const applyFallbackToMeshList = async (meshList, modelManifest) => {
    for (const mesh of meshList) {
      const oldMats = getMaterialArray(mesh.material);
      const newMats = [];
      for (let i = 0; i < oldMats.length; i++) {
        const srcMat = oldMats[i];
        const hmd = modelManifest.hmdByName.get(srcMat.name) || modelManifest.hmdMaterials[i] || modelManifest.hmdMaterials[0] || null;
        if (hmd?.diffuseOut) {
          const tex = await loadOutTexture(hmd.diffuseOut, manifestBase, textureLoaders, { gradMat: false }, embeddedBuffers);
          if (tex) {
            const mat = srcMat.clone();
            applyFallbackMaterialDefaults(mat);
            mat.map = tex;
            mat.transparent = true;
            mat.alphaTest = 0.001;
            mat.needsUpdate = true;
            newMats.push(mat);
            continue;
          }
        }
        const mat = srcMat.clone();
        applyFallbackMaterialDefaults(mat);
        newMats.push(mat);
      }
      setMaterialArray(mesh, newMats);
      mesh.onBeforeRender = null;
    }
  };

  if (manifest.models.length) {
    for (const modelManifest of wrapperEntries) {
      const wrapperRoot = byPath.get(modelManifest.path || '');
      if (!wrapperRoot) continue;
      const meshList = collectMeshesForWrapper(wrapperRoot, wrappers);
      if (!meshList.length) continue;
      if (await applyGradToMeshList(meshList, modelManifest)) continue;
      if (await applyOverrideToMeshList(meshList, modelManifest)) continue;
      await applyFallbackToMeshList(meshList, modelManifest);
    }
    return;
  }

  // Backward-compatible single-model fallback
  const single = normalizeModelManifest({ path: manifest.primaryModelPath || 'root', gradMat: manifest.grad, hmdMaterials: manifest.hmdMaterials });
  const allMeshes = [];
  traverseMeshes(root, (mesh) => allMeshes.push(mesh));
  if (await applyGradToMeshList(allMeshes, single)) return;
  await applyFallbackToMeshList(allMeshes, single);
}

async function loadGltf
(gltfUrl) {
  const loader = new GLTFLoader();
  return await new Promise((resolve, reject) => {
    loader.load(
        gltfUrl,
        (gltf) => resolve(gltf),
        undefined,
        (err) => reject(new Error(`Failed to load glTF ${gltfUrl}: ${err?.message || err}`))
    );
  });
}

function normalizePathString(value) {
  return String(value || '').replace(/\\/g, '/');
}

function stripCommonPathPrefix(fullPath, rootPath) {
  const fullNorm = normalizePathString(fullPath);
  const rootNorm = normalizePathString(rootPath).replace(/\/+$/, '');
  const fullLower = fullNorm.toLowerCase();
  const rootLower = rootNorm.toLowerCase();
  if (!rootNorm) return fullNorm.replace(/^\/+/, '');
  if (fullLower === rootLower) return '';
  if (fullLower.startsWith(rootLower + '/')) return fullNorm.slice(rootNorm.length + 1);
  return fullNorm.split('/').pop() || fullNorm;
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function getSearchParams() {
  return new URLSearchParams(window.location.search);
}

function setCatalogStatus(text, isError = false) {
  if (!catalogStatus) return;
  catalogStatus.textContent = text;
  catalogStatus.classList.toggle('error', isError);
}

function buildCatalogEntries(summary) {
  const exportsList = Array.isArray(summary?.exports) ? summary.exports : [];
  const outDir = summary?.outDir || '';
  return exportsList.map((item) => {
    const glbRel = item.glb ? stripCommonPathPrefix(item.glb, outDir).replace(/^\/+/, '') : null;
    const gltfRel = item.gltf ? stripCommonPathPrefix(item.gltf, outDir).replace(/^\/+/, '') : null;
    const manifestRel = item.manifest ? stripCommonPathPrefix(item.manifest, outDir).replace(/^\/+/, '') : null;
    const key = glbRel || gltfRel || item.prefab || String(Math.random());
    const labelSource = glbRel || gltfRel || item.prefab || key;
    const label = labelSource.replace(/\.(glb|gltf)$/i, '').replace(/\\/g, '/');
    const pathParts = label.split('/').filter(Boolean);
    return {
      key,
      label,
      pathParts,
      fileName: pathParts[pathParts.length - 1] || label,
      glbRel,
      gltfRel,
      manifestRel,
      warnings: Array.isArray(item.warnings) ? item.warnings : []
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

function buildModelTree(entries) {
  const root = { path: '', folders: new Map(), files: [] };
  for (const entry of entries) {
    let node = root;
    const parts = entry.pathParts.length ? entry.pathParts : [entry.label];
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const nextPath = node.path ? `${node.path}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: nextPath, folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(entry);
  }
  return root;
}

function folderHasSelected(node, selectedKey) {
  if (!selectedKey) return false;
  for (const entry of node.files) if (entry.key === selectedKey) return true;
  for (const child of node.folders.values()) if (folderHasSelected(child, selectedKey)) return true;
  return false;
}

function countFolderFiles(node) {
  let total = node.files.length;
  for (const child of node.folders.values()) total += countFolderFiles(child);
  return total;
}

const expandedFolders = new Set();

function renderModelList(entries, selectedKey, onSelect) {
  if (!modelList) return;
  modelList.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'model-empty';
    empty.textContent = 'No exported models found.';
    modelList.appendChild(empty);
    return;
  }
  const tree = buildModelTree(entries);

  function renderFolder(node, parent, depth = 0) {
    const folders = Array.from(node.folders.values()).sort((a, b) => a.name.localeCompare(b.name));
    const files = [...node.files].sort((a, b) => a.fileName.localeCompare(b.fileName));

    for (const folder of folders) {
      const details = document.createElement('details');
      details.className = 'tree-folder';
      details.dataset.path = folder.path;
      const shouldOpen = depth === 0 || expandedFolders.has(folder.path) || folderHasSelected(folder, selectedKey);
      details.open = shouldOpen;
      if (shouldOpen) expandedFolders.add(folder.path);
      details.addEventListener('toggle', () => {
        if (details.open) expandedFolders.add(folder.path);
        else expandedFolders.delete(folder.path);
      });

      const summary = document.createElement('summary');
      summary.className = 'tree-folder-summary';
      const main = document.createElement('span');
      main.className = 'tree-folder-main';
      const caret = document.createElement('span');
      caret.className = 'tree-folder-caret';
      caret.textContent = '▸';
      const name = document.createElement('span');
      name.className = 'tree-folder-name';
      name.textContent = folder.name;
      main.append(caret, name);
      const count = document.createElement('span');
      count.className = 'tree-folder-count';
      count.textContent = String(countFolderFiles(folder));
      summary.append(main, count);
      details.appendChild(summary);

      const branch = document.createElement('div');
      branch.className = 'tree-branch';
      details.appendChild(branch);
      renderFolder(folder, branch, depth + 1);
      parent.appendChild(details);
    }

    for (const entry of files) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-item';
      if (entry.key === selectedKey) button.classList.add('active');
      button.title = entry.label;
      const label = document.createElement('span');
      label.className = 'model-item-label';
      label.textContent = entry.fileName;
      button.appendChild(label);
      button.addEventListener('click', () => onSelect(entry));
      parent.appendChild(button);
    }
  }

  renderFolder(tree, modelList, 0);
}

function filterEntries(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) => entry.label.toLowerCase().includes(q) || entry.fileName.toLowerCase().includes(q));
}

function updateBrowserUrl({ root, modelKey }) {
  const params = new URLSearchParams();
  if (root) params.set('root', root);
  if (modelKey) params.set('model', modelKey);
  history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
}

function disposeModel(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat.uniforms) {
          for (const uniform of Object.values(mat.uniforms)) {
            const value = uniform?.value;
            if (value && typeof value === 'object' && value.isTexture) value.dispose?.();
          }
        }
        mat.dispose?.();
      }
    }
    obj.geometry?.dispose?.();
  });
}

function hexToRgbArray(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.padStart(6, 'f');
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
}

function rgbArrayToHex(rgb) {
  const arr = Array.isArray(rgb) ? rgb : [1, 1, 1];
  return '#' + arr.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round((Number(v) || 0) * 255))).toString(16).padStart(2, '0')).join('');
}

function getDefaultRoot() {
  return app?.dataset?.defaultRoot || 'model-library';
}

function createViewerLighting() {
  const defaults = {
    mainLightIntensity: 0.12,
    mainLightPower: 1.0,
    shadow: 1.0,
    mainLightColor: [1, 1, 1],
    ambientBoost: 0.08,
    lightPos: [3.6, 5.8, 2.4],
    autoRotate: false,
    autoRotateSpeed: 1.0,
  };
  try {
    const raw = localStorage.getItem('farever.modelViewer.settings');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, autoRotate: !!parsed?.autoRotate };
  } catch {
    return defaults;
  }
}

function saveViewerLighting(viewerLighting) {
  try {
    localStorage.setItem('farever.modelViewer.settings', JSON.stringify({ autoRotate: viewerLighting.autoRotate }));
  } catch {}
}

function syncControlValues(viewerLighting, controls) {
  if (autoRotateInput) autoRotateInput.checked = !!viewerLighting.autoRotate;
  controls.autoRotate = !!viewerLighting.autoRotate;
  controls.autoRotateSpeed = viewerLighting.autoRotateSpeed;
}

function bindViewerControls({ viewerLighting, controls }) {
  const apply = () => {
    if (autoRotateInput) viewerLighting.autoRotate = !!autoRotateInput.checked;
    controls.autoRotate = !!viewerLighting.autoRotate;
    controls.autoRotateSpeed = viewerLighting.autoRotateSpeed;
    saveViewerLighting(viewerLighting);
  };
  autoRotateInput?.addEventListener('input', apply);
  autoRotateInput?.addEventListener('change', apply);
  apply();
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const directGlbParam = getOptionalParam('glb');
  const directGltfParam = getOptionalParam('gltf');
  const directManifestParam = getOptionalParam('manifest');
  const viewerLighting = createViewerLighting();

  const renderer = createRenderer();
  const scene = createScene();
  const camera = createCamera();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;

  const { mainLight } = createLights(scene);
  installResize(renderer, camera);

  const textureLoaders = createTextureLoaders();
  let currentRoot = null;
  let catalogEntries = [];
  let selectedKey = null;

  syncControlValues(viewerLighting, controls);
  bindViewerControls({ viewerLighting, controls });

  async function loadResolvedModel({ modelUrl, manifestUrl = null, label, rootValue = null, modelKey = null, isGlb = false }) {
    setStatus('Loading model…');
    const gltf = await loadGltf(modelUrl);
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('Model loaded but no scene was found');

    let manifest;
    let embeddedBuffers = null;
    if (isGlb) {
      const embedded = await extractEmbeddedProjectData(gltf);
      if (!embedded.manifest) throw new Error('GLB loaded but no embedded prefabToGltf manifest was found.');
      manifest = embedded.manifest;
      embeddedBuffers = embedded.embeddedBuffers;
    } else {
      if (!manifestUrl) throw new Error('Missing manifest URL for glTF loading.');
      const manifestRaw = await fetchJson(manifestUrl);
      manifest = normalizeManifest(manifestRaw);
    }

    await applyMaterials(root, manifest, manifestUrl, textureLoaders, mainLight, camera, viewerLighting, embeddedBuffers);

    if (currentRoot) {
      scene.remove(currentRoot);
      disposeModel(currentRoot);
    }
    currentRoot = root;
    autoUprightObject(root);
    scene.add(root);
    fitCameraToObject(camera, controls, root);

    selectedKey = modelKey || modelUrl;
    renderModelList(filterEntries(catalogEntries, searchInput?.value || ''), selectedKey, handleEntrySelect);
    if (currentModelName) currentModelName.textContent = label || pathBasenameNoExt(modelUrl);
    setStatus(`Loaded ${label || pathBasenameNoExt(modelUrl)}.`);
    if (rootValue && modelKey) updateBrowserUrl({ root: rootValue, modelKey });
  }

  async function handleEntrySelect(entry, forcedRootValue = null, forcedRootBaseUrl = null) {
    if (!entry) return;
    const rootValue = forcedRootValue || exportRootInput?.value || localStorage.getItem('prefabViewer.exportRoot') || getDefaultRoot();
    const rootBaseUrl = forcedRootBaseUrl || resolveUrl(ensureTrailingSlash(rootValue), window.location.href);
    setCatalogStatus(`Loading ${entry.label}…`);
    if (entry.glbRel) {
      await loadResolvedModel({ modelUrl: resolveUrl(entry.glbRel, rootBaseUrl), label: entry.label, rootValue, modelKey: entry.key, isGlb: true });
    } else {
      await loadResolvedModel({ modelUrl: resolveUrl(entry.gltfRel, rootBaseUrl), manifestUrl: resolveUrl(entry.manifestRel, rootBaseUrl), label: entry.label, rootValue, modelKey: entry.key, isGlb: false });
    }
    setCatalogStatus(`${catalogEntries.length} models found.`);
  }

  async function loadCatalog(rootValue, preferredModelKey = null) {
    const normalizedRoot = String(rootValue || '').trim() || getDefaultRoot();
    if (exportRootInput) exportRootInput.value = normalizedRoot;
    localStorage.setItem('prefabViewer.exportRoot', normalizedRoot);
    const rootBaseUrl = resolveUrl(ensureTrailingSlash(normalizedRoot), window.location.href);
    const summaryUrl = resolveUrl('prefab-export-summary.json', rootBaseUrl);
    setCatalogStatus('Loading export summary…');
    const summary = await fetchJson(summaryUrl);
    catalogEntries = buildCatalogEntries(summary);
    if (!catalogEntries.length) {
      setCatalogStatus('No models found in prefab-export-summary.json.', true);
      renderModelList([], null, handleEntrySelect);
      return;
    }
    setCatalogStatus(`${catalogEntries.length} models found.`);
    renderModelList(filterEntries(catalogEntries, searchInput?.value || ''), selectedKey, handleEntrySelect);
    let entry = null;
    if (preferredModelKey) entry = catalogEntries.find((item) => item.key === preferredModelKey || item.label === preferredModelKey) || null;
    if (!entry) entry = catalogEntries[0];
    await handleEntrySelect(entry, normalizedRoot, rootBaseUrl);
  }

  refreshButton?.addEventListener('click', async () => {
    try { await loadCatalog(exportRootInput?.value || getDefaultRoot(), selectedKey); }
    catch (err) { console.error(err); setCatalogStatus(`Failed to load export summary: ${err.message || err}`, true); }
  });
  searchInput?.addEventListener('input', () => renderModelList(filterEntries(catalogEntries, searchInput.value), selectedKey, handleEntrySelect));

  try {
    const rememberedRoot = params.get('root') || localStorage.getItem('prefabViewer.exportRoot') || getDefaultRoot();
    if (params.get('root') || (!directGlbParam && !directGltfParam)) {
      await loadCatalog(rememberedRoot, params.get('model') || null);
    } else if (directGlbParam || directGltfParam) {
      await loadResolvedModel({ modelUrl: resolveUrl(directGlbParam || directGltfParam, window.location.href), manifestUrl: directManifestParam ? resolveUrl(directManifestParam, window.location.href) : null, label: pathBasenameNoExt(directGlbParam || directGltfParam), isGlb: !!directGlbParam });
      setCatalogStatus('Direct model loaded from query parameters.');
    }
  } catch (err) {
    console.error(err);
    setCatalogStatus('Failed to load prefab-export-summary.json. Set the export root in the sidebar and click Reload.', true);
    setStatus('Viewer ready. No model loaded yet.');
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

main().catch(fatal);
