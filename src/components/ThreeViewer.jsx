import { useLayoutEffect, useRef, useEffect } from "react";
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { AudioContext as ThreeAudioContext } from "three/src/audio/AudioContext.js";

// three r15x 계열은 AudioContext 유틸이 존재합니다. (프로젝트 버전에 따라 존재하지 않을 수 있음)
// 없으면 아래 줄은 주석 처리하세요.
// const ThreeAudioContext = THREE.AudioContext || THREE.getAudioContext?.();

export default function ThreeViewer({
  plyUrl,
  textureUrl,
  ambience,
  isPlay,
  mouseMode, // "move" | "pointer"
  isCameraReset,
  setIsCameraReset,
  onAnalysisReady,
  onDistanceChange,
  onClickSpectrum,
}) {
  // ───────────────────────────────────────────────────────────
  // Refs
  // ───────────────────────────────────────────────────────────
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const groupRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const labelRendererRef = useRef(null);

  const analyserRef = useRef(null);
  const listenerRef = useRef(null);

  const meshRef = useRef(null);
  const controlsRef = useRef(null);

  const audioLoaderRef = useRef(null);
  const bufferCacheRef = useRef(new Map());

  const ambienceRigRef = useRef(null); // { nodes, sounds, urls, zFrac, expand }

  const pointerPxRef = useRef({ x: NaN, y: NaN }); // canvas 로컬 px
  const pointerNdcRef = useRef(new THREE.Vector2());
  const raycasterRef = useRef(new THREE.Raycaster());

  const hoverRef = useRef(false); // DOM hover (현재 볼륨 계산엔 사용 안 함)
  const meshHoverRef = useRef(false); // 레이캐스트 결과 (FFT 전송에만 사용)

  const markerRef = useRef(null); // { el, obj }
  const holdVolRef = useRef(NaN); // 마커 고정 볼륨
  const hotspotVolRef = useRef(NaN); // 마지막 적용 볼륨

  const isPlayRef = useRef(false);
  const modeRef = useRef(mouseMode);
  const spacePressedRef = useRef(false);

  const pointerCursorUrlRef = useRef(null);
  const rafRef = useRef(0);
  const initWorldDistRef = useRef(1);
  const initialMeshStateRef = useRef(null);

  const spectrumFpsRef = useRef(10);
  const lastSpectrumTsRef = useRef(0);

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

  function makePointerCursor(size = 36, stroke = 3) {
    const s = size;
    const r = (s - stroke) / 2;
    const cvs = document.createElement("canvas");
    cvs.width = s;
    cvs.height = s;
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, s, s);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,82,82,0.2)";
    ctx.fill();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = "#ff5252";
    ctx.stroke();
    return cvs.toDataURL("image/png");
  }

  function getMeshHalfExtents(mesh) {
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const sx = mesh.scale.x, sy = mesh.scale.y;
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

    const zFrac = ambience?.zFrac ?? -0.5;
    const expand = ambience?.expand ?? 0.05;

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
      const wantPositional = k === "hotspot";
      let snd = rig.sounds[k];

      const needReplace =
        !snd ||
        (wantPositional && !(snd instanceof THREE.PositionalAudio)) ||
        (!wantPositional && !(snd instanceof THREE.Audio));

      if (needReplace) {
        if (snd) {
          try { if (snd.isPlaying) snd.stop(); } catch {}
          try { rig.nodes?.[k]?.remove(snd); } catch {}
        }
        snd = wantPositional ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
        rig.nodes[k].add(snd);
        rig.sounds[k] = snd;
      }

      // hotspot은 반드시 Positional 설정 (URL 없어도 노드는 유지)
      if (wantPositional) {
        const hs = ambience?.hotspot || {};
        const distanceModel = hs.distanceModel ?? ambience?.distanceModel ?? "exponential";
        const refDistance = hs.refDistance ?? ambience?.refDistance ?? 1;
        const maxDistance = hs.maxDistance ?? ambience?.maxDistance ?? 5.0;
        const rolloff = hs.rolloff ?? ambience?.rolloff ?? 1.0;

        snd.setPanningModel?.("HRTF");
        snd.setDistanceModel?.(distanceModel);
        snd.setRefDistance?.(refDistance);
        snd.setMaxDistance?.(maxDistance);
        snd.setRolloffFactor?.(rolloff);
      }

      // URL이 없으면 버퍼만 비우고 객체는 유지
      if (!url) {
        try { if (snd.isPlaying) snd.stop(); } catch {}
        try { snd.setBuffer?.(null); } catch {}
        rig.urls[k] = null;
        return;
      }

      const prevUrl = rig.urls?.[k];
      if (prevUrl !== url || !snd.buffer) {
        try {
          const buf = await loadBuffer(url);
          if (buf) {
            try { if (snd.isPlaying) snd.stop(); } catch {}
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

      // 코너 사운드만 초기 볼륨 적용, hotspot은 프레임에서 계산
      const gains = { tl: 0.3, tr: 0.3, bl: 0.3, br: 0.3, hotspot: 0.8, ...(ambience?.gains || {}) };
      if (k !== "hotspot") {
        try { snd.setVolume(gains[k] ?? 0.5); } catch {}
      }
    };

    for (const k of ["tl", "tr", "bl", "br"]) await ensureSoundForKey(k, getUrl(k));
    await ensureSoundForKey("hotspot", getUrl("hotspot"));

    syncAmbiencePlayState();
    // 앰비언스 갱신 직후 커서 기반 초기 볼륨 반영
    updateHotspotVolumeByPointer();
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
      rig.nodes.hotspot.position.set(hotspotPosInput[0], hotspotPosInput[1], hotspotPosInput[2]);
    } else {
      rig.nodes.hotspot.position.set(
        hotspotPosInput.x ?? 0, hotspotPosInput.y ?? 0, hotspotPosInput.z ?? 0
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
        if (wantPlay) { if (!snd.isPlaying) snd.play(); }
        else { if (snd.isPlaying) snd.stop(); }
      } catch {}
    }
  }

  // 포인터↔hotspot 거리로 게인 계산 (공용)
  function computeHotspotGainForClientXY(clientX, clientY) {
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

    const d = Math.hypot(clientX - rect.left - sx, clientY - rect.top - sy);
    const NEAR = 30, FAR = 400; // 통일
    const baseGain = ambience?.gains?.hotspot ?? 1.0;
    const minGain = 0.0;
    let t = (FAR - d) / (FAR - NEAR);
    t = Math.max(0, Math.min(1, t));
    const s = t * t * (3 - 2 * t);
    return minGain + (baseGain - minGain) * s;
  }

  // 커서 위치 기반으로 hotspot 볼륨 적용 (메시/DOM 호버 조건 제거)
  function updateHotspotVolumeByPointer() {
    const rig = ambienceRigRef.current;
    const cam = cameraRef.current;
    const renderer = rendererRef.current;
    if (!rig || !cam || !renderer) return;

    const snd = rig.sounds?.hotspot;
    const node = rig.nodes?.hotspot;
    if (!node) return; // snd 없어도 계산은 해두고, 적용 시에만 옵셔널 체이닝

    let target;
    if (markerRef.current && Number.isFinite(holdVolRef.current)) {
      target = holdVolRef.current;
    } else {
      const px = pointerPxRef.current.x, py = pointerPxRef.current.y;
      if (Number.isFinite(px) && Number.isFinite(py)) {
        const world = new THREE.Vector3();
        node.getWorldPosition(world);
        const ndc = world.clone().project(cam);
        const rect = renderer.domElement.getBoundingClientRect();
        const sx = (ndc.x * 0.5 + 0.5) * rect.width;
        const sy = (-ndc.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(px - sx, py - sy);
        const NEAR = 30, FAR = 400; // 통일
        const baseGain = ambience?.gains?.hotspot ?? 1.0;
        const minGain = 0.0;
        let t = (FAR - d) / (FAR - NEAR);
        t = Math.max(0, Math.min(1, t));
        const s = t * t * (3 - 2 * t);
        target = minGain + (baseGain - minGain) * s;
      } else {
        target = ambience?.gains?.hotspot ?? 1.0;
      }
    }

    if (!Number.isFinite(hotspotVolRef.current) || Math.abs(target - hotspotVolRef.current) > 0.01) {
      try { snd?.setVolume?.(target); } catch {}
      hotspotVolRef.current = target;
    }
  }

  // FFT 전송
  function emitSpectrum(kind = "live") {
    const a = analyserRef.current;
    const l = listenerRef.current;
    if (!a || !l || typeof onClickSpectrum !== "function") return;
    const byteData = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(byteData);
    const bins = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(bins);
    onClickSpectrum({
      byteData,
      bins,
      fftSize: a.fftSize,
      sampleRate: l.context.sampleRate,
      ts: performance.now(),
      minDecibels: a.minDecibels,
      maxDecibels: a.maxDecibels,
      kind, // "live" | "snap"
    });
  }

  // ───────────────────────────────────────────────────────────
  // Effects
  // ───────────────────────────────────────────────────────────
  useEffect(() => { isPlayRef.current = !!isPlay; }, [isPlay]);
  useEffect(() => { syncAmbiencePlayState(); }, [isPlay]);

  useEffect(() => {
    modeRef.current = mouseMode;
    // 모드 전환 시 항상 마커 고정 해제 + 다음 프레임 재계산
    clearMarker();
    holdVolRef.current = NaN;
    hotspotVolRef.current = NaN;

    if (controlsRef.current) controlsRef.current.enabled = mouseMode === "move";
    const mount = mountRef.current;
    const cvs = mount?.querySelector("canvas");
    if (cvs) {
      if (mouseMode === "move") {
        cvs.style.cursor = "grab";
      } else if (mouseMode === "pointer") {
        if (!pointerCursorUrlRef.current) pointerCursorUrlRef.current = makePointerCursor(36, 3);
        cvs.style.cursor = `url(${pointerCursorUrlRef.current}) 18 18, crosshair`;
      } else {
        cvs.style.cursor = "default";
      }
    }
  }, [mouseMode]);

  // 초기 셋업
  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const { clientWidth: w, clientHeight: h } = mount;

    // 오디오 컨텍스트
    const AC = window.AudioContext || window["webkitAudioContext"];
    if (!AC) {
      console.error("This browser does not support Web Audio API");
      return;
    }
    const desiredCtx = new AC({ sampleRate: 96000 });
    try { ThreeAudioContext?.setContext?.(desiredCtx); } catch {}
    audioLoaderRef.current = new THREE.AudioLoader();

    // Scene/Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202020);
    sceneRef.current = scene;

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 1000);
    camera.position.set(0, 0, -1);
    cameraRef.current = camera;

    // Audio Listener & Analyser
    const listener = new THREE.AudioListener();
    camera.add(listener);
    listenerRef.current = listener;

    const ctx = listener.context;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    listener.getInput().connect(analyser);
    analyserRef.current = analyser;

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

    // Renderer
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

    // 포인터 좌표 추적 + 메시 호버 여부 계산
    const onPointerMoveTrack = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerPxRef.current.x = e.clientX - rect.left;
      pointerPxRef.current.y = e.clientY - rect.top;

      if (modeRef.current === "pointer") {
        // 메시 위 호버 판단 (FFT 전송용)
        const { x, y } = pointerPxRef.current;
        const ndcX = (x / rect.width) * 2 - 1;
        const ndcY = -(y / rect.height) * 2 + 1;
        pointerNdcRef.current.set(ndcX, ndcY);
        raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
        const hits = raycasterRef.current.intersectObject(group, true);
        meshHoverRef.current = hits.length > 0;
      } else {
        meshHoverRef.current = false;
      }
    };

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

        // 거리 앵커(초기 카메라-메시 중심 거리)
        try {
          const center = new THREE.Vector3();
          mesh.getWorldPosition(center);
          initWorldDistRef.current = camera.position.distanceTo(center) || 1.0;
        } catch {}

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
    let lastX = 0, lastY = 0;
    let dragMode = "rotate";

    renderer.domElement.style.touchAction = "none";

    const onPointerDown = (e) => {
      if (modeRef.current !== "move") return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dragMode = spacePressedRef.current ? "translate" : "rotate";
      renderer.domElement.style.cursor = dragMode === "translate" ? "move" : "grabbing";
      controls.enabled = false;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };

    const onPointerMoveDrag = (e) => {
      if (!dragging) return;
      const desired = spacePressedRef.current ? "translate" : "rotate";
      if (desired !== dragMode) {
        dragMode = desired;
        renderer.domElement.style.cursor = dragMode === "translate" ? "move" : "grabbing";
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

    // 마커 표시/토글 도우미
    const ensureMarkerAtHit = (hit) => {
      if (markerRef.current) return;
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

    const projectToScreen = (v3, out, cam, rect) => {
      const ndc = v3.clone().project(cam);
      out.x = (ndc.x * 0.5 + 0.5) * rect.width;
      out.y = (-ndc.y * 0.5 + 0.5) * rect.height;
      return out;
    };

// 클릭: 마커 토글 + FFT 스냅샷 고정/해제 (마커 있을 때는 스냅샷 갱신 금지)
const onClick = (e) => {
  if (modeRef.current !== "pointer") return;

  const rect = renderer.domElement.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 1) 이미 마커가 있는 경우
  if (markerRef.current) {
    const world = new THREE.Vector3();
    markerRef.current.obj.getWorldPosition(world);
    const sp = { x: 0, y: 0 };
    projectToScreen(world, sp, camera, rect);
    const d = Math.hypot(sp.x - x, sp.y - y);

    if (d <= 10) {
      // 마커 근처 클릭 → 해제 + 라이브 복귀
      clearMarker();
      holdVolRef.current = NaN;      // 볼륨 고정 해제
      emitSpectrum("live");          // 스냅샷 갱신 아님
    }
    // 마커가 있는데 다른 곳 클릭 → 아무 것도 하지 않음 (스냅샷 갱신 금지)
    return;
  }

  // 2) 마커가 없는 경우에만 새로 찍고 스냅샷 고정
  const ndcX = (x / rect.width) * 2 - 1;
  const ndcY = -(y / rect.height) * 2 + 1;
  pointerNdcRef.current.set(ndcX, ndcY);
  raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
  const hits = raycasterRef.current.intersectObject(group, true);

  if (hits.length) {
    ensureMarkerAtHit(hits[0]);                             // 최초 1회만 생성되도록 이미 수정됨
    holdVolRef.current = computeHotspotGainForClientXY(e.clientX, e.clientY);
    emitSpectrum("snap");                                   // ← 새 마커 찍을 때만 스냅샷
  } else {
    clearMarker();
    holdVolRef.current = NaN;
    emitSpectrum("live");
  }
};

    // 등록
    renderer.domElement.addEventListener("pointermove", onPointerMoveTrack);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMoveDrag);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);
    renderer.domElement.addEventListener("click", onClick);

    const onEnter = () => { hoverRef.current = true; };
    const onLeave = () => { hoverRef.current = false; };
    renderer.domElement.addEventListener("mouseenter", onEnter);
    renderer.domElement.addEventListener("mouseleave", onLeave);

    const onKeyDown = (e) => {
      if ((e.code === "Space" || e.key === " ") && modeRef.current === "move") {
        spacePressedRef.current = true;
        if (hoverRef.current) e.preventDefault();
      }
    };
    const onKeyUp = (e) => { if (e.code === "Space" || e.key === " ") spacePressedRef.current = false; };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);

    // Render Loop
    const renderLoop = () => {
      controls.update();
      updateMeshAmbienceNodes();

      // 커서 거리 기반 볼륨 적용 (한 번 더 호출해 덮어쓰기 이슈 방지 가능)
      updateHotspotVolumeByPointer();

      // ▶ 거리값 매핑: 0.3 ~ 3.0m (초기 앵커 = 1.0m)
      try {
        const cam = cameraRef.current;
        const mesh = meshRef.current;
        const ctrls = controlsRef.current;
        if (cam && mesh && ctrls && typeof onDistanceChange === "function") {
          const center = new THREE.Vector3();
          mesh.getWorldPosition(center);
          const w = cam.position.distanceTo(center); // world unit
          const wMin = Math.max(1e-6, ctrls.minDistance ?? 0.5);
          const wMax = Math.max(wMin + 1e-6, ctrls.maxDistance ?? 10);
          const wMid = Math.max(wMin, Math.min(wMax, initWorldDistRef.current ?? 1.0));
          const mMin = 0.3, mMid = 1.0, mMax = 3.0;
          let meters;
          if (w <= wMid) {
            const t = (w - wMin) / Math.max(1e-6, (wMid - wMin));
            meters = mMin + t * (mMid - mMin);
          } else {
            const t = (w - wMid) / Math.max(1e-6, (wMax - wMid));
            meters = mMid + t * (mMax - mMid);
          }
          meters = Math.min(mMax, Math.max(mMin, meters));
          const prev = renderLoop.__lastMeters;
          if (!Number.isFinite(prev) || Math.abs(prev - meters) >= 0.01) {
            onDistanceChange(Number(meters.toFixed(2)));
            renderLoop.__lastMeters = meters;
          }
        }
      } catch {}

      // ▶ 포인터 모드: 마커 없고, 메시 위에 호버 중 + 재생 중이면 라이브 FFT
      if (modeRef.current === "pointer" && isPlayRef.current && meshHoverRef.current && !markerRef.current) {
        const now = performance.now();
        const budget = 1000 / Math.max(1, spectrumFpsRef.current);
        if (now - lastSpectrumTsRef.current >= budget) {
          emitSpectrum("live");
          lastSpectrumTsRef.current = now;
        }
      }

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

      renderer.domElement.removeEventListener("pointermove", onPointerMoveTrack);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMoveDrag);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerUp);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("mouseenter", onEnter);
      renderer.domElement.removeEventListener("mouseleave", onLeave);

      const rig = ambienceRigRef.current;
      if (rig) {
        for (const k of ["tl", "tr", "bl", "br", "hotspot"]) {
          try { if (rig.sounds?.[k]?.isPlaying) rig.sounds[k].stop(); } catch {}
          try { rig.nodes?.[k]?.remove(rig.sounds?.[k]); } catch {}
          try { meshRef.current?.remove(rig.nodes?.[k]); } catch {}
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

      try { camera.remove(listener); } catch {}
      listenerRef.current = null;

      try { listener.getInput()?.disconnect?.(analyser); } catch {}
      analyserRef.current = null;

      try { desiredCtx.suspend?.(); } catch {}
    };
  }, [plyUrl, textureUrl]);

  // 앰비언스 변경 시
  useEffect(() => { setupOrUpdateMeshAmbience(); }, [ambience]);

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
    holdVolRef.current = NaN;
    hotspotVolRef.current = NaN;

    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }

    renderer?.render(scene, cam);
    setIsCameraReset?.("");
  }, [isCameraReset, setIsCameraReset]);

  return <div ref={mountRef} />;
}

