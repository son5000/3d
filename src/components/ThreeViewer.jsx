// ─────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────
import { useLayoutEffect, useRef, useEffect } from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
// three 버전에 맞춰 이 경로가 존재하는 쪽을 사용
import { AudioContext as ThreeAudioContext } from "three/src/audio/AudioContext.js";

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function ThreeViewer({
  plyUrl = "/assets/sample.ply",
  textureUrl = "/assets/sample.png",
  mouseMode = "", // "move" | "pointer"
  isCameraReset,
  setIsCameraReset,
  ambience, // { urls, gains, zFrac, expand, distanceModel, refDistance, maxDistance, rolloff, hotspot:{pos:[x,y,z]} }
  isPlay,
  onAnalysisReady,
  onClickSpectrum,
}) {
  // ───────────────────────────────────────────────────────────
  // Refs
  // ───────────────────────────────────────────────────────────
  const mountRef = useRef(null);
  const rafRef = useRef(0);

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const labelRendererRef = useRef(null);
  const controlsRef = useRef(null);
  const groupRef = useRef(null);

  const meshRef = useRef(null);
  const initialMeshStateRef = useRef(null);

  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerNdcRef = useRef(new THREE.Vector2());
  const markerRef = useRef(null);

  const spacePressedRef = useRef(false);
  const hoverRef = useRef(false);
  const modeRef = useRef(mouseMode);

  // Audio
  const listenerRef = useRef(null);
  const audioLoaderRef = useRef(null);
  const bufferCacheRef = useRef(new Map());
  const ambienceRigRef = useRef(null);
  const analyserRef = useRef(null);
  const isPlayRef = useRef(!!isPlay);

  // Pointer → hotspot gain
  const pointerPxRef = useRef({ x: NaN, y: NaN });
  const hotspotVolRef = useRef(NaN);
  const isClickingRef = useRef(false);
  const holdVolRef = useRef(NaN);














  

  // ───────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────
  function clearMarker() {
    if (!markerRef.current) return;
    const { obj, el } = markerRef.current;
    obj?.parent?.remove?.(obj);
    el?.remove?.();
    markerRef.current = null;
  }

  function getMeshHalfExtents(mesh) {
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const sx = mesh.scale.x,
      sy = mesh.scale.y;
    const hx = (bb.max.x - bb.min.x) * 0.5 * sx;
    const hy = (bb.max.y - bb.min.y) * 0.5 * sy;
    return { hx, hy };
  }

  async function loadBuffer(url) {
    if (!url) return null;
    const cache = bufferCacheRef.current;
    if (cache.has(url)) return cache.get(url);
    const buf = await audioLoaderRef.current.loadAsync(encodeURI(url));
    cache.set(url, buf);
    return buf;
  }

  async function setupOrUpdateMeshAmbience() {
    const cam = cameraRef.current;
    const mesh = meshRef.current;
    const listener = listenerRef.current;
    if (!cam || !mesh || !listener) return;

    const urls = ambience?.urls || {};
    const getUrl = (k) => urls[k] || urls.all || null;

    const zFrac = ambience?.zFrac ?? -0.5; // 0~1 (메시→카메라 사이)
    const expand = ambience?.expand ?? 0.05; // 코너 확장 비율

    if (!ambienceRigRef.current) {
      const nodes = {
        tl: new THREE.Object3D(),
        tr: new THREE.Object3D(),
        bl: new THREE.Object3D(),
        br: new THREE.Object3D(),
        hotspot: new THREE.Object3D(),
      };
      for (const k of Object.keys(nodes)) mesh.add(nodes[k]);
      ambienceRigRef.current = { nodes, sounds: {}, urls: {}, zFrac, expand };
    } else {
      ambienceRigRef.current.zFrac = zFrac;
      ambienceRigRef.current.expand = expand;
      ambienceRigRef.current.urls = ambienceRigRef.current.urls || {};
    }

    const rig = ambienceRigRef.current;

    const ensureSoundForKey = async (k, url) => {
      if (!url) {
        const s = rig.sounds?.[k];
        if (s) {
          try {
            if (s.isPlaying) s.stop();
          } catch {}
          try {
            rig.nodes?.[k]?.remove(s);
          } catch {}
        }
        delete rig.sounds[k];
        rig.urls[k] = null;
        return;
      }

      const wantPositional = k === "hotspot";
      let snd = rig.sounds[k];

      const needReplace =
        !snd ||
        (wantPositional && !(snd instanceof THREE.PositionalAudio)) ||
        (!wantPositional && !(snd instanceof THREE.Audio));

      if (needReplace) {
        if (snd) {
          try {
            if (snd.isPlaying) snd.stop();
          } catch {}
          try {
            rig.nodes?.[k]?.remove(snd);
          } catch {}
        }
        snd = wantPositional
          ? new THREE.PositionalAudio(listener)
          : new THREE.Audio(listener);
        rig.nodes[k].add(snd);
        rig.sounds[k] = snd;
      }

      if (wantPositional) {
        const hs = ambience?.hotspot || {};
        const distanceModel =
          hs.distanceModel ?? ambience?.distanceModel ?? "exponential";
        const refDistance = hs.refDistance ?? ambience?.refDistance ?? 1;
        const maxDistance = hs.maxDistance ?? ambience?.maxDistance ?? 5.0;
        const rolloff = hs.rolloff ?? ambience?.rolloff ?? 1.0;

        snd.setPanningModel?.("HRTF");
        snd.setDistanceModel?.(distanceModel);
        snd.setRefDistance?.(refDistance);
        snd.setMaxDistance?.(maxDistance);
        snd.setRolloffFactor?.(rolloff);
      }

      const prevUrl = rig.urls?.[k];
      if (prevUrl !== url || !snd.buffer) {
        try {
          const buf = await loadBuffer(url);
          if (buf) {
            const wasPlaying = snd.isPlaying;
            if (wasPlaying) {
              try {
                snd.stop();
              } catch {}
            }
            snd.setBuffer(buf);
            snd.setLoop(true);
            rig.urls[k] = url;

            if (isPlayRef.current) {
              try {
                const ctx = listener.context;
                if (ctx?.state === "suspended") await ctx.resume();
                if (!snd.isPlaying) snd.play();
              } catch {}
            }
          }
        } catch (e) {
          console.error(`[ambience:${k}] load error`, e);
        }
      }

      const gains = {
        tl: 0.5,
        tr: 0.5,
        bl: 0.5,
        br: 0.5,
        hotspot: 0.8,
        ...(ambience?.gains || {}),
      };
      try {
        snd.setVolume(gains[k] ?? 0.5);
      } catch {}
    };

    for (const k of ["tl", "tr", "bl", "br"]) {
      await ensureSoundForKey(k, getUrl(k));
    }
    await ensureSoundForKey("hotspot", getUrl("hotspot"));

    syncAmbiencePlayState();
  }

  const _tmp = new THREE.Vector3();
  function updateMeshAmbienceNodes() {
    const cam = cameraRef.current;
    const mesh = meshRef.current;
    const rig = ambienceRigRef.current;
    if (!cam || !mesh || !rig) return;

    const { hx, hy } = getMeshHalfExtents(mesh);
    const ex = hx * (1 + (rig.expand ?? 0));
    const ey = hy * (1 + (rig.expand ?? 0));

    const camLocal = _tmp.copy(cam.position);
    mesh.worldToLocal(camLocal);
    const z = (rig.zFrac ?? 0.5) * camLocal.z;

    rig.nodes.tl.position.set(-ex, +ey, z);
    rig.nodes.tr.position.set(+ex, +ey, z);
    rig.nodes.bl.position.set(-ex, -ey, z);
    rig.nodes.br.position.set(+ex, -ey, z);

    const hotspotPosInput = ambience?.hotspot?.pos ?? [5, -2, 0];
    if (Array.isArray(hotspotPosInput)) {
      rig.nodes.hotspot.position.set(
        hotspotPosInput[0],
        hotspotPosInput[1],
        hotspotPosInput[2]
      );
    } else {
      rig.nodes.hotspot.position.set(
        hotspotPosInput.x ?? 0,
        hotspotPosInput.y ?? 0,
        hotspotPosInput.z ?? 0
      );
    }
  }

  function syncAmbiencePlayState() {
    const rig = ambienceRigRef.current;
    const listener = listenerRef.current;
    if (!rig || !listener) return;
    const wantPlay = !!isPlayRef.current;
    for (const k in rig.sounds) {
      const snd = rig.sounds[k];
      if (!snd?.buffer) continue;
      try {
        if (wantPlay) {
          if (!snd.isPlaying) snd.play();
        } else {
          if (snd.isPlaying) snd.stop();
        }
      } catch {}
    }
  }

  function updateHotspotVolumeByPointer() {
    const rig = ambienceRigRef.current;
    const cam = cameraRef.current;
    const renderer = rendererRef.current;
    if (!rig || !cam || !renderer) return;

    const snd = rig.sounds?.hotspot;
    const node = rig.nodes?.hotspot;
    if (!snd || !node) return;

    const world = new THREE.Vector3();
    node.getWorldPosition(world);
    const ndc = world.clone().project(cam);
    const rect = renderer.domElement.getBoundingClientRect();
    const sx = (ndc.x * 0.5 + 0.5) * rect.width;
    const sy = (-ndc.y * 0.5 + 0.5) * rect.height;

    const px = pointerPxRef.current.x;
    const py = pointerPxRef.current.y;
    let d =
      Number.isFinite(px) && Number.isFinite(py) && hoverRef.current
        ? Math.hypot(px - sx, py - sy)
        : Number.POSITIVE_INFINITY;

    const NEAR = 30,
      FAR = 400;
    const baseGain = ambience?.gains?.hotspot ?? 1.0;
    const minGain = 0.0;
    let t = (FAR - d) / (FAR - NEAR);
    t = Math.max(0, Math.min(1, t));
    const s = t * t * (3 - 2 * t);
    let target = minGain + (baseGain - minGain) * s;

    if (isClickingRef.current && Number.isFinite(holdVolRef.current)) {
      target = holdVolRef.current;
    }

    if (
      !Number.isFinite(hotspotVolRef.current) ||
      Math.abs(target - hotspotVolRef.current) > 0.01
    ) {
      try {
        snd.setVolume(target);
      } catch {}
      hotspotVolRef.current = target;
    }
  }























  

  // ───────────────────────────────────────────────────────────
  // Effects
  // ───────────────────────────────────────────────────────────
  useEffect(() => {
    isPlayRef.current = !!isPlay;
  }, [isPlay]);

  useEffect(() => {
    syncAmbiencePlayState();
  }, [isPlay]);

  useEffect(() => {
    modeRef.current = mouseMode;
    if (mouseMode !== "pointer") clearMarker();
    if (controlsRef.current) controlsRef.current.enabled = mouseMode === "move";
    const mount = mountRef.current;
    const cvs = mount?.querySelector("canvas");
    if (cvs) {
      cvs.style.cursor =
        mouseMode === "move"
          ? "grab"
          : mouseMode === "pointer"
          ? "crosshair"
          : "default";
    }
  }, [mouseMode]);

  // 초기 셋업
  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const { clientWidth: w, clientHeight: h } = mount;

    // 0) 커스텀 오디오 컨텍스트 생성 & 전역 등록 (TS-safe webkit fallback)
    const AC = window.AudioContext || window["webkitAudioContext"];
    if (!AC) {
      console.error("This browser does not support Web Audio API");
      return;
    }
    const desiredCtx = new AC({ sampleRate: 96000 }); // Nyquist = 48 kHz
    ThreeAudioContext.setContext(desiredCtx); // ← 반드시 Listener/Audio 생성 전에

    // AudioLoader는 setContext 이후에 생성(디코더 컨텍스트 일치)
    audioLoaderRef.current = new THREE.AudioLoader();

    // 1) Scene / Group / Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202020);
    sceneRef.current = scene;

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 1000);
    camera.position.set(0, 0, -1);
    cameraRef.current = camera;

    // 2) Listener (지금 만들면 desiredCtx 사용됨)
    const listener = new THREE.AudioListener();
    camera.add(listener);
    listenerRef.current = listener;

    // 3) Analyser (반드시 listener.context에서 생성)
    const ctx = listener.context;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    listener.getInput().connect(analyser);
    analyserRef.current = analyser;

    // 외부로 분석 스펙 전달 (여기 sampleRate가 실제 적용값)
    onAnalysisReady?.({
      context: ctx,
      analyser,
      spec: {
        fftSize: analyser.fftSize,
        smoothingTimeConstant: analyser.smoothingTimeConstant,
        minDecibels: analyser.minDecibels,
        maxDecibels: analyser.maxDecibels,
        sampleRate: ctx.sampleRate,
      },
    });

    // 클릭 스냅샷 (pointer 모드에서만)
    const onPointerDownSnapshot = (e) => {
      if (modeRef.current !== "pointer") return;
      if (!analyserRef.current || !listenerRef.current) return;

      const a = analyserRef.current;
      const byteData = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(byteData);

      const bins = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(bins);

      onClickSpectrum?.({
        byteData,
        bins,
        fftSize: a.fftSize,
        sampleRate: listenerRef.current.context.sampleRate,
        ts: performance.now(),
        minDecibels: a.minDecibels,
        maxDecibels: a.maxDecibels,
      });
    };

    // 4) Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // 포인터 추적 (항상 최신 px 저장)
    const updatePointerPx = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerPxRef.current.x = e.clientX - rect.left;
      pointerPxRef.current.y = e.clientY - rect.top;
    };
    const onPointerMoveTrack = (e) => updatePointerPx(e);

    // CSS2DRenderer
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(w, h);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    mount.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-0.1, 0.0, -0.1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.01;
    key.shadow.camera.far = 10;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 1);
    fill.position.set(0, 0.0, -0.1);
    scene.add(fill);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 10;
    controls.target.set(0, 0, 0);
    controls.enableRotate = false;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.touches.ONE = THREE.TOUCH.NONE;
    controls.enabled = modeRef.current === "move";
    controls.update();
    controlsRef.current = controls;

    // Texture + PLY
    const texture = new THREE.TextureLoader().load(textureUrl);
    new PLYLoader().load(
      plyUrl,
      (geometry) => {
        geometry.computeVertexNormals();
        geometry.center();

        const material = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);

        // normalize scale
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.0 / (maxDim || 1);
        mesh.scale.setScalar(scale);

        mesh.rotateZ(Math.PI);
        mesh.castShadow = true;
        group.add(mesh);

        meshRef.current = mesh;
        initialMeshStateRef.current = {
          position: mesh.position.clone(),
          rotation: mesh.rotation.clone(),
          scale: mesh.scale.clone(),
        };

        setupOrUpdateMeshAmbience();
      },
      undefined,
      (err) => console.error("PLY load error:", err)
    );

    // Drag/translate
    const camX = new THREE.Vector3();
    const camY = new THREE.Vector3();
    const camZ = new THREE.Vector3();
    const worldDelta = new THREE.Vector3();
    const tmpWorldPos = new THREE.Vector3();

    const rotateGroup = (dx, dy, speed = 0.0009) => {
      group.rotateY(dx * speed);
      group.rotateX(-dy * speed);
    };

    const translateMeshByPixels = (dx, dy) => {
      const cam = cameraRef.current;
      const mesh = meshRef.current;
      if (!cam || !mesh) return;

      mesh.getWorldPosition(tmpWorldPos);
      const distance = cam.position.distanceTo(tmpWorldPos);
      const vFov = THREE.MathUtils.degToRad(cam.fov);
      const worldPerPixelY =
        (2 * Math.tan(vFov / 2) * distance) / renderer.domElement.clientHeight;
      const worldPerPixelX = worldPerPixelY * cam.aspect;

      const moveX = dx * worldPerPixelX;
      const moveY = dy * worldPerPixelY;

      cam.matrixWorld.extractBasis(camX, camY, camZ);
      worldDelta.copy(camX).multiplyScalar(moveX).add(camY.multiplyScalar(-moveY));

      const parent = mesh.parent ?? sceneRef.current;
      mesh.getWorldPosition(tmpWorldPos);
      tmpWorldPos.add(worldDelta);
      parent.worldToLocal(tmpWorldPos);
      mesh.position.copy(tmpWorldPos);
    };

    // 이벤트
    let dragging = false;
    let lastX = 0,
      lastY = 0;
    let dragMode = "rotate";

    renderer.domElement.style.touchAction = "none";

    const computeHotspotGainForClientXY = (clientX, clientY) => {
      const rig = ambienceRigRef.current;
      const cam = cameraRef.current;
      const renderer = rendererRef.current;
      if (!rig || !cam || !renderer) return 0;
      const node = rig.nodes?.hotspot;
      const snd = rig.sounds?.hotspot;
      if (!node || !snd) return 0;

      const world = new THREE.Vector3();
      node.getWorldPosition(world);
      const ndc = world.clone().project(cam);
      const rect = renderer.domElement.getBoundingClientRect();
      const sx = (ndc.x * 0.5 + 0.5) * rect.width;
      const sy = (-ndc.y * 0.5 + 0.5) * rect.height;

      const d = Math.hypot(
        clientX - rect.left - sx,
        clientY - rect.top - sy
      );

      const NEAR = 10;
      const FAR = 400;
      const baseGain = ambience?.gains?.hotspot ?? 1.0;
      const minGain = 0.0;
      let t = (FAR - d) / (FAR - NEAR);
      t = Math.max(0, Math.min(1, t));
      const s = t * t * (3 - 2 * t);
      return minGain + (baseGain - minGain) * s;
    };

    const onAnyPointerDown = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerPxRef.current.x = e.clientX - rect.left;
      pointerPxRef.current.y = e.clientY - rect.top;
      const g = computeHotspotGainForClientXY(e.clientX, e.clientY);
      isClickingRef.current = true;
      holdVolRef.current = g;
      hotspotVolRef.current = g;
      try {
        ambienceRigRef.current?.sounds?.hotspot?.setVolume?.(g);
      } catch {}
    };

    const onAnyPointerUpOrLeave = () => {
      isClickingRef.current = false;
      holdVolRef.current = NaN;
    };

    const onPointerDown = (e) => {
      if (modeRef.current !== "move") return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dragMode = spacePressedRef.current ? "translate" : "rotate";
      renderer.domElement.style.cursor =
        dragMode === "translate" ? "move" : "grabbing";
      controls.enabled = false;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };

    const onPointerMoveDrag = (e) => {
      if (!dragging) return;

      const desired = spacePressedRef.current ? "translate" : "rotate";
      if (desired !== dragMode) {
        dragMode = desired;
        renderer.domElement.style.cursor =
          dragMode === "translate" ? "move" : "grabbing";
      }

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragMode === "translate") translateMeshByPixels(dx, dy);
      else rotateGroup(dx, dy);
    };

    const onPointerUp = (e) => {
      if (!dragging) return;
      dragging = false;
      renderer.domElement.style.cursor = "grab";
      controls.enabled = modeRef.current === "move";
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    };

    const onWheel = (e) => {
      if (modeRef.current !== "move") return;
      e.preventDefault();
    };

    // 등록
    renderer.domElement.addEventListener("pointerdown", onPointerDownSnapshot);
    renderer.domElement.addEventListener("pointermove", onPointerMoveTrack);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMoveDrag);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);
    renderer.domElement.addEventListener("pointerdown", onAnyPointerDown);
    renderer.domElement.addEventListener("pointerup", onAnyPointerUpOrLeave);
    renderer.domElement.addEventListener("pointerleave", onAnyPointerUpOrLeave);

    // Pointer mode: marker
    const intersectAtClient = (clientX, clientY) => {
      if (!renderer || !camera) return [];
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdcRef.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
      return raycasterRef.current.intersectObject(group, true);
    };

    const ensureMarkerAtHit = (hit) => {
      const offset = 0.0005 * (meshRef.current?.scale.x || 1);
      let marker = markerRef.current;

      if (!marker) {
        const el = document.createElement("span");
        el.style.cssText = `
          width: 36px; height: 36px;
          border-radius: 50%;
          border: 3px solid #ff5252;
          background: rgba(255,82,82,0.2);
          pointer-events: none;
          transform: translate(-50%, -50%);
          box-sizing: border-box;
        `;
        const obj = new CSS2DObject(el);
        marker = { el, obj };
        markerRef.current = marker;
      }

      const localPoint = hit.object.worldToLocal(hit.point.clone());
      marker.obj.position.copy(localPoint);

      if (hit.face) {
        const n = hit.face.normal.clone().normalize();
        marker.obj.position.add(n.multiplyScalar(offset));
      }

      if (marker.obj.parent !== hit.object) {
        marker.obj.parent?.remove?.(marker.obj);
        hit.object.add(marker.obj);
      }
    };

    const onClick = (e) => {
      if (modeRef.current !== "pointer") return;
      const hits = intersectAtClient(e.clientX, e.clientY);
      if (hits.length) ensureMarkerAtHit(hits[0]);
      else clearMarker();
    };

    renderer.domElement.addEventListener("click", onClick);

    const onEnter = () => {
      hoverRef.current = true;
    };
    const onLeave = () => {
      hoverRef.current = false;
    };
    renderer.domElement.addEventListener("mouseenter", onEnter);
    renderer.domElement.addEventListener("mouseleave", onLeave);

    const onKeyDown = (e) => {
      if ((e.code === "Space" || e.key === " ") && modeRef.current === "move") {
        spacePressedRef.current = true;
        if (hoverRef.current) e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Space" || e.key === " ") spacePressedRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);

    // Render Loop
    const renderLoop = () => {
      controls.update();
      updateMeshAmbienceNodes();
      updateHotspotVolumeByPointer();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(renderLoop);
    };
    rafRef.current = requestAnimationFrame(renderLoop);

    // Resize
    const onResize = () => {
      const newW = mount.clientWidth || 1;
      const newH = mount.clientHeight || 1;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
      labelRenderer.setSize(newW, newH);
      updateMeshAmbienceNodes();
    };
    window.addEventListener("resize", onResize);

    // Cleanup
    return () => {
      clearMarker();
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);

      renderer.domElement.removeEventListener(
        "pointerdown",
        onPointerDownSnapshot
      );
      renderer.domElement.removeEventListener(
        "pointermove",
        onPointerMoveTrack
      );
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMoveDrag);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerUp);
      renderer.domElement.removeEventListener("pointerdown", onAnyPointerDown);
      renderer.domElement.removeEventListener(
        "pointerup",
        onAnyPointerUpOrLeave
      );
      renderer.domElement.removeEventListener(
        "pointerleave",
        onAnyPointerUpOrLeave
      );
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("mouseenter", onEnter);
      renderer.domElement.removeEventListener("mouseleave", onLeave);

      const rig = ambienceRigRef.current;
      if (rig) {
        for (const k of ["tl", "tr", "bl", "br", "hotspot"]) {
          try {
            if (rig.sounds?.[k]?.isPlaying) rig.sounds[k].stop();
          } catch {}
          try {
            rig.nodes?.[k]?.remove(rig.sounds?.[k]);
          } catch {}
          try {
            meshRef.current?.remove(rig.nodes?.[k]);
          } catch {}
        }
        ambienceRigRef.current = null;
      }

      controls.dispose();

      if (renderer.domElement?.parentNode === mount)
        mount.removeChild(renderer.domElement);
      if (labelRendererRef.current) {
        mount.removeChild(labelRendererRef.current.domElement);
        labelRendererRef.current = null;
      }

      try {
        const objs = [];
        group.traverse((c) => objs.push(c));
        objs.forEach((c) => {
          if (c.isMesh) {
            c.geometry?.dispose?.();
            (Array.isArray(c.material) ? c.material : [c.material]).forEach(
              (m) => m?.dispose?.()
            );
          }
          scene.remove(c);
        });
      } catch {}

      try {
        camera.remove(listener);
      } catch {}
      listenerRef.current = null;

      try {
        listener.getInput()?.disconnect?.(analyser);
      } catch {}
      analyserRef.current = null;

      try {
        desiredCtx.suspend?.();
      } catch {}
    };
  }, [plyUrl, textureUrl]);

  // 앰비언스 변경 시
  useEffect(() => {
    setupOrUpdateMeshAmbience();
  }, [ambience]);

  // Reset
  useEffect(() => {
    if (isCameraReset !== "reset") return;
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const mesh = meshRef.current;
    const initial = initialMeshStateRef.current;
    const group = groupRef.current;
    if (!cam) return;

    cam.position.set(0, 0, -1);
    cam.quaternion.set(0, 0, 0, 1);
    cam.updateProjectionMatrix();

    if (group) {
      group.rotation.set(0, 0, 0);
      group.scale.set(1, 1, 1);
    }
    if (mesh && initial) {
      mesh.position.copy(initial.position);
      mesh.rotation.copy(initial.rotation);
      mesh.scale.copy(initial.scale);
    }

    clearMarker();

    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }

    renderer?.render(scene, cam);
    setIsCameraReset?.("");
  }, [isCameraReset, setIsCameraReset]);

  // JSX
  return <div ref={mountRef} />;
}































// // ─────────────────────────────────────────────────────────────
// // Imports
// // ─────────────────────────────────────────────────────────────
// import { useLayoutEffect, useRef, useEffect } from "react";
// import * as THREE from "three";
// import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
// import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
// // three 버전에 맞춰 이 경로가 존재하는 쪽을 사용
// import { AudioContext as ThreeAudioContext } from "three/src/audio/AudioContext.js";

// // ─────────────────────────────────────────────────────────────
// // Component
// // ─────────────────────────────────────────────────────────────
// export default function ThreeViewer({
//   plyUrl = "/assets/sample.ply",
//   textureUrl = "/assets/sample.png",
//   mouseMode = "", // "move" | "pointer"
//   isCameraReset,
//   setIsCameraReset,
//   ambience, // { urls, gains, zFrac, expand, distanceModel, refDistance, maxDistance, rolloff, hotspot:{pos:[x,y,z]} }
//   isPlay,
//   onAnalysisReady,
//   onClickSpectrum, // ← 라이브 FFT 전달에 재사용 (kind="live")
// }) {
//   // ───────────────────────────────────────────────────────────
//   // Refs
//   // ───────────────────────────────────────────────────────────
//   const mountRef = useRef(null);
//   const rafRef = useRef(0);

//   const sceneRef = useRef(null);
//   const cameraRef = useRef(null);
//   const rendererRef = useRef(null);
//   const labelRendererRef = useRef(null);
//   const controlsRef = useRef(null);
//   const groupRef = useRef(null);

//   const meshRef = useRef(null);
//   const initialMeshStateRef = useRef(null);

//   const raycasterRef = useRef(new THREE.Raycaster());
//   const pointerNdcRef = useRef(new THREE.Vector2());
//   const markerRef = useRef(null);

//   const spacePressedRef = useRef(false);
//   const hoverRef = useRef(false);
//   const modeRef = useRef(mouseMode);

//   // Audio
//   const listenerRef = useRef(null);
//   const audioLoaderRef = useRef(null);
//   const bufferCacheRef = useRef(new Map());
//   const ambienceRigRef = useRef(null);
//   const analyserRef = useRef(null);
//   const isPlayRef = useRef(!!isPlay);

//   // Pointer → hotspot gain
//   const pointerPxRef = useRef({ x: NaN, y: NaN });
//   const hotspotVolRef = useRef(NaN);
//   const isClickingRef = useRef(false);
//   const holdVolRef = useRef(NaN);

//   // ── [NEW] 라이브 스펙트럼 샘플링 제어
//   const lastSpectrumTsRef = useRef(0);
//   const spectrumFpsRef = useRef(30); // 최대 30FPS로 제한

//   // ───────────────────────────────────────────────────────────
//   // Helpers
//   // ───────────────────────────────────────────────────────────
//   function clearMarker() {
//     if (!markerRef.current) return;
//     const { obj, el } = markerRef.current;
//     obj?.parent?.remove?.(obj);
//     el?.remove?.();
//     markerRef.current = null;
//   }

//   function getMeshHalfExtents(mesh) {
//     const geo = mesh.geometry;
//     geo.computeBoundingBox();
//     const bb = geo.boundingBox;
//     const sx = mesh.scale.x,
//       sy = mesh.scale.y;
//     const hx = (bb.max.x - bb.min.x) * 0.5 * sx;
//     const hy = (bb.max.y - bb.min.y) * 0.5 * sy;
//     return { hx, hy };
//   }

//   async function loadBuffer(url) {
//     if (!url) return null;
//     const cache = bufferCacheRef.current;
//     if (cache.has(url)) return cache.get(url);
//     const buf = await audioLoaderRef.current.loadAsync(encodeURI(url));
//     cache.set(url, buf);
//     return buf;
//   }

//   async function setupOrUpdateMeshAmbience() {
//     const cam = cameraRef.current;
//     const mesh = meshRef.current;
//     const listener = listenerRef.current;
//     if (!cam || !mesh || !listener) return;

//     const urls = ambience?.urls || {};
//     const getUrl = (k) => urls[k] || urls.all || null;

//     const zFrac = ambience?.zFrac ?? -0.5; // 0~1 (메시→카메라 사이)
//     const expand = ambience?.expand ?? 0.05; // 코너 확장 비율

//     if (!ambienceRigRef.current) {
//       const nodes = {
//         tl: new THREE.Object3D(),
//         tr: new THREE.Object3D(),
//         bl: new THREE.Object3D(),
//         br: new THREE.Object3D(),
//         hotspot: new THREE.Object3D(),
//       };
//       for (const k of Object.keys(nodes)) mesh.add(nodes[k]);
//       ambienceRigRef.current = { nodes, sounds: {}, urls: {}, zFrac, expand };
//     } else {
//       ambienceRigRef.current.zFrac = zFrac;
//       ambienceRigRef.current.expand = expand;
//       ambienceRigRef.current.urls = ambienceRigRef.current.urls || {};
//     }

//     const rig = ambienceRigRef.current;

//     const ensureSoundForKey = async (k, url) => {
//       if (!url) {
//         const s = rig.sounds?.[k];
//         if (s) {
//           try {
//             if (s.isPlaying) s.stop();
//           } catch {}
//           try {
//             rig.nodes?.[k]?.remove(s);
//           } catch {}
//         }
//         delete rig.sounds[k];
//         rig.urls[k] = null;
//         return;
//       }

//       const wantPositional = k === "hotspot";
//       let snd = rig.sounds[k];

//       const needReplace =
//         !snd ||
//         (wantPositional && !(snd instanceof THREE.PositionalAudio)) ||
//         (!wantPositional && !(snd instanceof THREE.Audio));

//       if (needReplace) {
//         if (snd) {
//           try {
//             if (snd.isPlaying) snd.stop();
//           } catch {}
//           try {
//             rig.nodes?.[k]?.remove(snd);
//           } catch {}
//         }
//         snd = wantPositional
//           ? new THREE.PositionalAudio(listener)
//           : new THREE.Audio(listener);
//         rig.nodes[k].add(snd);
//         rig.sounds[k] = snd;
//       }

//       if (wantPositional) {
//         const hs = ambience?.hotspot || {};
//         const distanceModel =
//           hs.distanceModel ?? ambience?.distanceModel ?? "exponential";
//         const refDistance = hs.refDistance ?? ambience?.refDistance ?? 1;
//         const maxDistance = hs.maxDistance ?? ambience?.maxDistance ?? 5.0;
//         const rolloff = hs.rolloff ?? ambience?.rolloff ?? 1.0;

//         snd.setPanningModel?.("HRTF");
//         snd.setDistanceModel?.(distanceModel);
//         snd.setRefDistance?.(refDistance);
//         snd.setMaxDistance?.(maxDistance);
//         snd.setRolloffFactor?.(rolloff);
//       }

//       const prevUrl = rig.urls?.[k];
//       if (prevUrl !== url || !snd.buffer) {
//         try {
//           const buf = await loadBuffer(url);
//           if (buf) {
//             const wasPlaying = snd.isPlaying;
//             if (wasPlaying) {
//               try {
//                 snd.stop();
//               } catch {}
//             }
//             snd.setBuffer(buf);
//             snd.setLoop(true);
//             rig.urls[k] = url;

//             if (isPlayRef.current) {
//               try {
//                 const ctx = listener.context;
//                 if (ctx?.state === "suspended") await ctx.resume();
//                 if (!snd.isPlaying) snd.play();
//               } catch {}
//             }
//           }
//         } catch (e) {
//           console.error(`[ambience:${k}] load error`, e);
//         }
//       }

//       const gains = {
//         tl: 0.5,
//         tr: 0.5,
//         bl: 0.5,
//         br: 0.5,
//         hotspot: 0.8,
//         ...(ambience?.gains || {}),
//       };
//       try {
//         snd.setVolume(gains[k] ?? 0.5);
//       } catch {}
//     };

//     for (const k of ["tl", "tr", "bl", "br"]) {
//       await ensureSoundForKey(k, getUrl(k));
//     }
//     await ensureSoundForKey("hotspot", getUrl("hotspot"));

//     syncAmbiencePlayState();
//   }

//   const _tmp = new THREE.Vector3();
//   function updateMeshAmbienceNodes() {
//     const cam = cameraRef.current;
//     const mesh = meshRef.current;
//     const rig = ambienceRigRef.current;
//     if (!cam || !mesh || !rig) return;

//     const { hx, hy } = getMeshHalfExtents(mesh);
//     const ex = hx * (1 + (rig.expand ?? 0));
//     const ey = hy * (1 + (rig.expand ?? 0));

//     const camLocal = _tmp.copy(cam.position);
//     mesh.worldToLocal(camLocal);
//     const z = (rig.zFrac ?? 0.5) * camLocal.z;

//     rig.nodes.tl.position.set(-ex, +ey, z);
//     rig.nodes.tr.position.set(+ex, +ey, z);
//     rig.nodes.bl.position.set(-ex, -ey, z);
//     rig.nodes.br.position.set(+ex, -ey, z);

//     const hotspotPosInput = ambience?.hotspot?.pos ?? [5, -2, 0];
//     if (Array.isArray(hotspotPosInput)) {
//       rig.nodes.hotspot.position.set(
//         hotspotPosInput[0],
//         hotspotPosInput[1],
//         hotspotPosInput[2]
//       );
//     } else {
//       rig.nodes.hotspot.position.set(
//         hotspotPosInput.x ?? 0,
//         hotspotPosInput.y ?? 0,
//         hotspotPosInput.z ?? 0
//       );
//     }
//   }

//   function syncAmbiencePlayState() {
//     const rig = ambienceRigRef.current;
//     const listener = listenerRef.current;
//     if (!rig || !listener) return;
//     const wantPlay = !!isPlayRef.current;
//     for (const k in rig.sounds) {
//       const snd = rig.sounds[k];
//       if (!snd?.buffer) continue;
//       try {
//         if (wantPlay) {
//           if (!snd.isPlaying) snd.play();
//         } else {
//           if (snd.isPlaying) snd.stop();
//         }
//       } catch {}
//     }
//   }

//   function updateHotspotVolumeByPointer() {
//     const rig = ambienceRigRef.current;
//     const cam = cameraRef.current;
//     const renderer = rendererRef.current;
//     if (!rig || !cam || !renderer) return;

//     const snd = rig.sounds?.hotspot;
//     const node = rig.nodes?.hotspot;
//     if (!snd || !node) return;

//     const world = new THREE.Vector3();
//     node.getWorldPosition(world);
//     const ndc = world.clone().project(cam);
//     const rect = renderer.domElement.getBoundingClientRect();
//     const sx = (ndc.x * 0.5 + 0.5) * rect.width;
//     const sy = (-ndc.y * 0.5 + 0.5) * rect.height;

//     const px = pointerPxRef.current.x;
//     const py = pointerPxRef.current.y;
//     let d =
//       Number.isFinite(px) && Number.isFinite(py) && hoverRef.current
//         ? Math.hypot(px - sx, py - sy)
//         : Number.POSITIVE_INFINITY;

//     const NEAR = 30,
//       FAR = 400;
//     const baseGain = ambience?.gains?.hotspot ?? 1.0;
//     const minGain = 0.0;
//     let t = (FAR - d) / (FAR - NEAR);
//     t = Math.max(0, Math.min(1, t));
//     const s = t * t * (3 - 2 * t);
//     let target = minGain + (baseGain - minGain) * s;

//     if (isClickingRef.current && Number.isFinite(holdVolRef.current)) {
//       target = holdVolRef.current;
//     }

//     if (
//       !Number.isFinite(hotspotVolRef.current) ||
//       Math.abs(target - hotspotVolRef.current) > 0.01
//     ) {
//       try {
//         snd.setVolume(target);
//       } catch {}
//       hotspotVolRef.current = target;
//     }
//   }

//   // ── [NEW] 현재 들리는 소리로 스펙트럼 샘플 + 전송(라이브 전송)
//   function emitLiveSpectrum(kind = "live") {
//     const a = analyserRef.current;
//     const l = listenerRef.current;
//     if (!a || !l || typeof onClickSpectrum !== "function") return;

//     const byteData = new Uint8Array(a.frequencyBinCount);
//     a.getByteFrequencyData(byteData);

//     const bins = new Float32Array(a.frequencyBinCount);
//     a.getFloatFrequencyData(bins);

//     onClickSpectrum({
//       byteData,
//       bins,
//       fftSize: a.fftSize,
//       sampleRate: l.context.sampleRate,
//       ts: performance.now(),
//       minDecibels: a.minDecibels,
//       maxDecibels: a.maxDecibels,
//       kind, // "live"
//     });
//   }

//   // ───────────────────────────────────────────────────────────
//   // Effects
//   // ───────────────────────────────────────────────────────────
//   useEffect(() => {
//     isPlayRef.current = !!isPlay;
//   }, [isPlay]);

//   useEffect(() => {
//     syncAmbiencePlayState();
//   }, [isPlay]);

//   useEffect(() => {
//     modeRef.current = mouseMode;
//     if (mouseMode !== "pointer") clearMarker();
//     if (controlsRef.current) controlsRef.current.enabled = mouseMode === "move";
//     const mount = mountRef.current;
//     const cvs = mount?.querySelector("canvas");
//     if (cvs) {
//       cvs.style.cursor =
//         mouseMode === "move"
//           ? "grab"
//           : mouseMode === "pointer"
//           ? "crosshair"
//           : "default";
//     }
//   }, [mouseMode]);

//   // 초기 셋업
//   useLayoutEffect(() => {
//     const mount = mountRef.current;
//     if (!mount) return;

//     const { clientWidth: w, clientHeight: h } = mount;

//     // 0) 커스텀 오디오 컨텍스트 생성 & 전역 등록 (TS-safe webkit fallback)
//     const AC = window.AudioContext || window["webkitAudioContext"];
//     if (!AC) {
//       console.error("This browser does not support Web Audio API");
//       return;
//     }
//     const desiredCtx = new AC({ sampleRate: 96000 }); // Nyquist = 48 kHz
//     ThreeAudioContext.setContext(desiredCtx); // ← 반드시 Listener/Audio 생성 전에

//     // AudioLoader는 setContext 이후에 생성(디코더 컨텍스트 일치)
//     audioLoaderRef.current = new THREE.AudioLoader();

//     // 1) Scene / Group / Camera
//     const scene = new THREE.Scene();
//     scene.background = new THREE.Color(0x202020);
//     sceneRef.current = scene;

//     const group = new THREE.Group();
//     scene.add(group);
//     groupRef.current = group;

//     const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 1000);
//     camera.position.set(0, 0, -1);
//     cameraRef.current = camera;

//     // 2) Listener (지금 만들면 desiredCtx 사용됨)
//     const listener = new THREE.AudioListener();
//     camera.add(listener);
//     listenerRef.current = listener;

//     // 3) Analyser (반드시 listener.context에서 생성)
//     const ctx = listener.context;
//     const analyser = ctx.createAnalyser();
//     analyser.fftSize = 2048;
//     analyser.smoothingTimeConstant = 0;
//     analyser.minDecibels = -90;
//     analyser.maxDecibels = -10;
//     listener.getInput().connect(analyser);
//     analyserRef.current = analyser;

//     // 외부로 분석 스펙 전달 (여기 sampleRate가 실제 적용값)
//     onAnalysisReady?.({
//       context: ctx,
//       analyser,
//       spec: {
//         fftSize: analyser.fftSize,
//         smoothingTimeConstant: analyser.smoothingTimeConstant,
//         minDecibels: analyser.minDecibels,
//         maxDecibels: analyser.maxDecibels,
//         sampleRate: ctx.sampleRate,
//       },
//     });

//     // 4) Renderer
//     const renderer = new THREE.WebGLRenderer({ antialias: true });
//     renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
//     renderer.setSize(w, h);
//     mount.appendChild(renderer.domElement);
//     renderer.outputColorSpace = THREE.SRGBColorSpace;
//     renderer.toneMapping = THREE.ACESFilmicToneMapping;
//     renderer.toneMappingExposure = 1.0;
//     renderer.shadowMap.enabled = true;
//     renderer.shadowMap.type = THREE.PCFSoftShadowMap;
//     rendererRef.current = renderer;

//     // 포인터 추적 (항상 최신 px 저장)
//     const updatePointerPx = (e) => {
//       const rect = renderer.domElement.getBoundingClientRect();
//       pointerPxRef.current.x = e.clientX - rect.left;
//       pointerPxRef.current.y = e.clientY - rect.top;
//     };
//     const onPointerMoveTrack = (e) => updatePointerPx(e);

//     // CSS2DRenderer
//     const labelRenderer = new CSS2DRenderer();
//     labelRenderer.setSize(w, h);
//     labelRenderer.domElement.style.position = "absolute";
//     labelRenderer.domElement.style.top = "0";
//     labelRenderer.domElement.style.left = "0";
//     labelRenderer.domElement.style.pointerEvents = "none";
//     mount.appendChild(labelRenderer.domElement);
//     labelRendererRef.current = labelRenderer;

//     // Lights
//     scene.add(new THREE.AmbientLight(0xffffff, 0.4));
//     const key = new THREE.DirectionalLight(0xffffff, 1.1);
//     key.position.set(-0.1, 0.0, -0.1);
//     key.castShadow = true;
//     key.shadow.mapSize.set(1024, 1024);
//     key.shadow.camera.near = 0.01;
//     key.shadow.camera.far = 10;
//     key.shadow.normalBias = 0.02;
//     scene.add(key);

//     const fill = new THREE.DirectionalLight(0xffffff, 1);
//     fill.position.set(0, 0.0, -0.1);
//     scene.add(fill);

//     // OrbitControls
//     const controls = new OrbitControls(camera, renderer.domElement);
//     controls.enableDamping = true;
//     controls.dampingFactor = 0.05;
//     controls.screenSpacePanning = false;
//     controls.minDistance = 0.5;
//     controls.maxDistance = 10;
//     controls.target.set(0, 0, 0);
//     controls.enableRotate = false;
//     controls.enablePan = false;
//     controls.enableZoom = true;
//     controls.touches.ONE = THREE.TOUCH.NONE;
//     controls.enabled = modeRef.current === "move";
//     controls.update();
//     controlsRef.current = controls;

//     // Texture + PLY
//     const texture = new THREE.TextureLoader().load(textureUrl);
//     new PLYLoader().load(
//       plyUrl,
//       (geometry) => {
//         geometry.computeVertexNormals();
//         geometry.center();

//         const material = new THREE.MeshStandardMaterial({
//           map: texture,
//           side: THREE.DoubleSide,
//         });
//         const mesh = new THREE.Mesh(geometry, material);

//         // normalize scale
//         const box = new THREE.Box3().setFromObject(mesh);
//         const size = box.getSize(new THREE.Vector3());
//         const maxDim = Math.max(size.x, size.y, size.z);
//         const scale = 1.0 / (maxDim || 1);
//         mesh.scale.setScalar(scale);

//         mesh.rotateZ(Math.PI);
//         mesh.castShadow = true;
//         group.add(mesh);

//         meshRef.current = mesh;
//         initialMeshStateRef.current = {
//           position: mesh.position.clone(),
//           rotation: mesh.rotation.clone(),
//           scale: mesh.scale.clone(),
//         };

//         setupOrUpdateMeshAmbience();
//       },
//       undefined,
//       (err) => console.error("PLY load error:", err)
//     );

//     // Drag/translate
//     const camX = new THREE.Vector3();
//     const camY = new THREE.Vector3();
//     const camZ = new THREE.Vector3();
//     const worldDelta = new THREE.Vector3();
//     const tmpWorldPos = new THREE.Vector3();

//     const rotateGroup = (dx, dy, speed = 0.0009) => {
//       group.rotateY(dx * speed);
//       group.rotateX(-dy * speed);
//     };

//     const translateMeshByPixels = (dx, dy) => {
//       const cam = cameraRef.current;
//       const mesh = meshRef.current;
//       if (!cam || !mesh) return;

//       mesh.getWorldPosition(tmpWorldPos);
//       const distance = cam.position.distanceTo(tmpWorldPos);
//       const vFov = THREE.MathUtils.degToRad(cam.fov);
//       const worldPerPixelY =
//         (2 * Math.tan(vFov / 2) * distance) / renderer.domElement.clientHeight;
//       const worldPerPixelX = worldPerPixelY * cam.aspect;

//       const moveX = dx * worldPerPixelX;
//       const moveY = dy * worldPerPixelY;

//       cam.matrixWorld.extractBasis(camX, camY, camZ);
//       worldDelta.copy(camX).multiplyScalar(moveX).add(camY.multiplyScalar(-moveY));

//       const parent = mesh.parent ?? sceneRef.current;
//       mesh.getWorldPosition(tmpWorldPos);
//       tmpWorldPos.add(worldDelta);
//       parent.worldToLocal(tmpWorldPos);
//       mesh.position.copy(tmpWorldPos);
//     };

//     // 이벤트
//     let dragging = false;
//     let lastX = 0,
//       lastY = 0;
//     let dragMode = "rotate";

//     renderer.domElement.style.touchAction = "none";

//     const computeHotspotGainForClientXY = (clientX, clientY) => {
//       const rig = ambienceRigRef.current;
//       const cam = cameraRef.current;
//       const renderer = rendererRef.current;
//       if (!rig || !cam || !renderer) return 0;
//       const node = rig.nodes?.hotspot;
//       const snd = rig.sounds?.hotspot;
//       if (!node || !snd) return 0;

//       const world = new THREE.Vector3();
//       node.getWorldPosition(world);
//       const ndc = world.clone().project(cam);
//       const rect = renderer.domElement.getBoundingClientRect();
//       const sx = (ndc.x * 0.5 + 0.5) * rect.width;
//       const sy = (-ndc.y * 0.5 + 0.5) * rect.height;

//       const d = Math.hypot(
//         clientX - rect.left - sx,
//         clientY - rect.top - sy
//       );

//       const NEAR = 10;
//       const FAR = 400;
//       const baseGain = ambience?.gains?.hotspot ?? 1.0;
//       const minGain = 0.0;
//       let t = (FAR - d) / (FAR - NEAR);
//       t = Math.max(0, Math.min(1, t));
//       const s = t * t * (3 - 2 * t);
//       return minGain + (baseGain - minGain) * s;
//     };

//     const onAnyPointerDown = (e) => {
//       const rect = renderer.domElement.getBoundingClientRect();
//       pointerPxRef.current.x = e.clientX - rect.left;
//       pointerPxRef.current.y = e.clientY - rect.top;
//       const g = computeHotspotGainForClientXY(e.clientX, e.clientY);
//       isClickingRef.current = true;
//       holdVolRef.current = g;
//       hotspotVolRef.current = g;
//       try {
//         ambienceRigRef.current?.sounds?.hotspot?.setVolume?.(g);
//       } catch {}
//     };

//     const onAnyPointerUpOrLeave = () => {
//       isClickingRef.current = false;
//       holdVolRef.current = NaN;
//     };

//     const onPointerDown = (e) => {
//       if (modeRef.current !== "move") return;
//       dragging = true;
//       lastX = e.clientX;
//       lastY = e.clientY;
//       dragMode = spacePressedRef.current ? "translate" : "rotate";
//       renderer.domElement.style.cursor =
//         dragMode === "translate" ? "move" : "grabbing";
//       controls.enabled = false;
//       renderer.domElement.setPointerCapture?.(e.pointerId);
//     };

//     const onPointerMoveDrag = (e) => {
//       if (!dragging) return;

//       const desired = spacePressedRef.current ? "translate" : "rotate";
//       if (desired !== dragMode) {
//         dragMode = desired;
//         renderer.domElement.style.cursor =
//           dragMode === "translate" ? "move" : "grabbing";
//       }

//       const dx = e.clientX - lastX;
//       const dy = e.clientY - lastY;
//       lastX = e.clientX;
//       lastY = e.clientY;

//       if (dragMode === "translate") translateMeshByPixels(dx, dy);
//       else rotateGroup(dx, dy);
//     };

//     const onPointerUp = (e) => {
//       if (!dragging) return;
//       dragging = false;
//       renderer.domElement.style.cursor = "grab";
//       controls.enabled = modeRef.current === "move";
//       renderer.domElement.releasePointerCapture?.(e.pointerId);
//     };

//     const onWheel = (e) => {
//       if (modeRef.current !== "move") return;
//       e.preventDefault();
//     };

//     // 등록
//     renderer.domElement.addEventListener("pointermove", onPointerMoveTrack);
//     renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
//     renderer.domElement.addEventListener("pointerdown", onPointerDown);
//     renderer.domElement.addEventListener("pointermove", onPointerMoveDrag);
//     renderer.domElement.addEventListener("pointerup", onPointerUp);
//     renderer.domElement.addEventListener("pointerleave", onPointerUp);
//     renderer.domElement.addEventListener("pointerdown", onAnyPointerDown);
//     renderer.domElement.addEventListener("pointerup", onAnyPointerUpOrLeave);
//     renderer.domElement.addEventListener("pointerleave", onAnyPointerUpOrLeave);

//     // Pointer mode: marker (표시만, 클릭 스냅샷 로직 제거)
//     const intersectAtClient = (clientX, clientY) => {
//       if (!renderer || !camera) return [];
//       const rect = renderer.domElement.getBoundingClientRect();
//       pointerNdcRef.current.set(
//         ((clientX - rect.left) / rect.width) * 2 - 1,
//         -((clientY - rect.top) / rect.height) * 2 + 1
//       );
//       raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
//       return raycasterRef.current.intersectObject(group, true);
//     };

//     const ensureMarkerAtHit = (hit) => {
//       const offset = 0.0005 * (meshRef.current?.scale.x || 1);
//       let marker = markerRef.current;

//       if (!marker) {
//         const el = document.createElement("span");
//         el.style.cssText = `
//           width: 36px; height: 36px;
//           border-radius: 50%;
//           border: 3px solid #ff5252;
//           background: rgba(255,82,82,0.2);
//           pointer-events: none;
//           transform: translate(-50%, -50%);
//           box-sizing: border-box;
//         `;
//         const obj = new CSS2DObject(el);
//         marker = { el, obj };
//         markerRef.current = marker;
//       }

//       const localPoint = hit.object.worldToLocal(hit.point.clone());
//       marker.obj.position.copy(localPoint);

//       if (hit.face) {
//         const n = hit.face.normal.clone().normalize();
//         marker.obj.position.add(n.multiplyScalar(offset));
//       }

//       if (marker.obj.parent !== hit.object) {
//         marker.obj.parent?.remove?.(marker.obj);
//         hit.object.add(marker.obj);
//       }
//     };

//     const onClick = (e) => {
//       if (modeRef.current !== "pointer") return;
//       const hits = intersectAtClient(e.clientX, e.clientY);
//       if (hits.length) ensureMarkerAtHit(hits[0]);
//       else clearMarker();
//     };

//     renderer.domElement.addEventListener("click", onClick);

//     const onEnter = () => {
//       hoverRef.current = true;
//     };
//     const onLeave = () => {
//       hoverRef.current = false;
//     };
//     renderer.domElement.addEventListener("mouseenter", onEnter);
//     renderer.domElement.addEventListener("mouseleave", onLeave);

//     const onKeyDown = (e) => {
//       if ((e.code === "Space" || e.key === " ") && modeRef.current === "move") {
//         spacePressedRef.current = true;
//         if (hoverRef.current) e.preventDefault();
//       }
//     };
//     const onKeyUp = (e) => {
//       if (e.code === "Space" || e.key === " ") spacePressedRef.current = false;
//     };
//     window.addEventListener("keydown", onKeyDown, { passive: false });
//     window.addEventListener("keyup", onKeyUp);

//     // Render Loop
//     const renderLoop = () => {
//       controls.update();
//       updateMeshAmbienceNodes();
//       updateHotspotVolumeByPointer();

//       // ── [NEW] 호버 + 재생 중 + mouseMode==="pointer" 일 때만 라이브 FFT 전송
//       if (hoverRef.current && isPlayRef.current && modeRef.current === "pointer") {
//         const now = performance.now();
//         const budget = 1000 / Math.max(1, spectrumFpsRef.current);
//         if (now - lastSpectrumTsRef.current >= budget) {
//           emitLiveSpectrum("live");
//           lastSpectrumTsRef.current = now;
//         }
//       }

//       renderer.render(scene, camera);
//       labelRenderer.render(scene, camera);
//       rafRef.current = requestAnimationFrame(renderLoop);
//     };
//     rafRef.current = requestAnimationFrame(renderLoop);

//     // Resize
//     const onResize = () => {
//       const newW = mount.clientWidth || 1;
//       const newH = mount.clientHeight || 1;
//       camera.aspect = newW / newH;
//       camera.updateProjectionMatrix();
//       renderer.setSize(newW, newH);
//       labelRenderer.setSize(newW, newH);
//       updateMeshAmbienceNodes();
//     };
//     window.addEventListener("resize", onResize);

//     // Cleanup
//     return () => {
//       clearMarker();
//       cancelAnimationFrame(rafRef.current);
//       window.removeEventListener("resize", onResize);
//       window.removeEventListener("keydown", onKeyDown);
//       window.removeEventListener("keyup", onKeyUp);

//       renderer.domElement.removeEventListener("pointermove", onPointerMoveTrack);
//       renderer.domElement.removeEventListener("wheel", onWheel);
//       renderer.domElement.removeEventListener("pointerdown", onPointerDown);
//       renderer.domElement.removeEventListener("pointermove", onPointerMoveDrag);
//       renderer.domElement.removeEventListener("pointerup", onPointerUp);
//       renderer.domElement.removeEventListener("pointerleave", onPointerUp);
//       renderer.domElement.removeEventListener("pointerdown", onAnyPointerDown);
//       renderer.domElement.removeEventListener("pointerup", onAnyPointerUpOrLeave);
//       renderer.domElement.removeEventListener("pointerleave", onAnyPointerUpOrLeave);
//       renderer.domElement.removeEventListener("click", onClick);
//       renderer.domElement.removeEventListener("mouseenter", onEnter);
//       renderer.domElement.removeEventListener("mouseleave", onLeave);

//       const rig = ambienceRigRef.current;
//       if (rig) {
//         for (const k of ["tl", "tr", "bl", "br", "hotspot"]) {
//           try {
//             if (rig.sounds?.[k]?.isPlaying) rig.sounds[k].stop();
//           } catch {}
//           try {
//             rig.nodes?.[k]?.remove(rig.sounds?.[k]);
//           } catch {}
//           try {
//             meshRef.current?.remove(rig.nodes?.[k]);
//           } catch {}
//         }
//         ambienceRigRef.current = null;
//       }

//       controls.dispose();

//       if (renderer.domElement?.parentNode === mount)
//         mount.removeChild(renderer.domElement);
//       if (labelRendererRef.current) {
//         mount.removeChild(labelRendererRef.current.domElement);
//         labelRendererRef.current = null;
//       }

//       try {
//         const objs = [];
//         group.traverse((c) => objs.push(c));
//         objs.forEach((c) => {
//           if (c.isMesh) {
//             c.geometry?.dispose?.();
//             (Array.isArray(c.material) ? c.material : [c.material]).forEach(
//               (m) => m?.dispose?.()
//             );
//           }
//           scene.remove(c);
//         });
//       } catch {}

//       try {
//         camera.remove(listener);
//       } catch {}
//       listenerRef.current = null;

//       try {
//         listener.getInput()?.disconnect?.(analyser);
//       } catch {}
//       analyserRef.current = null;

//       try {
//         desiredCtx.suspend?.();
//       } catch {}
//     };
//   }, [plyUrl, textureUrl]);

//   // 앰비언스 변경 시
//   useEffect(() => {
//     setupOrUpdateMeshAmbience();
//   }, [ambience]);

//   // Reset
//   useEffect(() => {
//     if (isCameraReset !== "reset") return;
//     const cam = cameraRef.current;
//     const controls = controlsRef.current;
//     const renderer = rendererRef.current;
//     const scene = sceneRef.current;
//     const mesh = meshRef.current;
//     const initial = initialMeshStateRef.current;
//     const group = groupRef.current;
//     if (!cam) return;

//     cam.position.set(0, 0, -1);
//     cam.quaternion.set(0, 0, 0, 1);
//     cam.updateProjectionMatrix();

//     if (group) {
//       group.rotation.set(0, 0, 0);
//       group.scale.set(1, 1, 1);
//     }
//     if (mesh && initial) {
//       mesh.position.copy(initial.position);
//       mesh.rotation.copy(initial.rotation);
//       mesh.scale.copy(initial.scale);
//     }

//     clearMarker();

//     if (controls) {
//       controls.target.set(0, 0, 0);
//       controls.update();
//     }

//     renderer?.render(scene, cam);
//     setIsCameraReset?.("");
//   }, [isCameraReset, setIsCameraReset]);

//   // JSX
//   return <div ref={mountRef} />;
// }
