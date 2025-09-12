// useThreeCore.js
import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";

/**
 * Three.js 오브젝트(트리) 내부의 GPU 리소스를 정리(dispose)합니다.
 */
function disposeObject3D(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose?.();
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      mats.forEach((m) => {
        m?.map?.dispose?.();
        m?.normalMap?.dispose?.();
        m?.roughnessMap?.dispose?.();
        m?.metalnessMap?.dispose?.();
        m?.aoMap?.dispose?.();
        m?.dispose?.();
      });
    }
  });
}

/**
 * React + Three.js 기본 환경(씬/카메라/렌더러/컨트롤/렌더루프/리사이즈) 세팅 훅
 *
 * 요구사항:
 * - targetX = (클릭된 X + 50), targetY = 200 (컨테이너 좌표계)
 * - 선은 타깃과 가장 가까운 "원 둘레" 지점에서 시작
 */
export default function useThreeCore({
  fov = 60,
  near = 0.01,
  far = 5000,
  background = 0xf2ffff,
  enableControlsRotate = false,
} = {}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const labelRendererRef = useRef(null);
  const svgRef = useRef(null);

  // 라벨/라인 목록: { el, obj, line }
  const labelsRef = useRef([]);

  // 클릭으로 정해지는 타깃 좌표 (컨테이너 기준)
  const targetRef = useRef({ x: 0, y: 200, has: false });

  // 모델 그룹 / 레이캐스트
  const groupRef = useRef(new THREE.Group());
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseNdcRef = useRef(new THREE.Vector2());

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    scene.add(groupRef.current);
    sceneRef.current = scene;

    // Camera
    const w = wrap.clientWidth || 1;
    const h = wrap.clientHeight || 1;
    const camera = new THREE.PerspectiveCamera(fov, w / h, near, far);
    camera.position.set(0, 0, -0.1);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    wrap.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Light
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 3.0);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 1, 1);
    scene.add(hemi, dir);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableRotate = enableControlsRotate;
    controlsRef.current = controls;

    // CSS2DRenderer
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(w, h);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    wrap.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    // SVG 오버레이 (리더 라인)
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.pointerEvents = "none";
    svg.style.overflow = "visible";
    wrap.appendChild(svg);
    svgRef.current = svg;

    // Render loop
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);

      const W = wrap.clientWidth || 1;
      const H = wrap.clientHeight || 1;

      // 타깃 좌표 (클릭되기 전이면 기본값 0,200)
      const tx = Math.max(0, Math.min(W, targetRef.current?.x ?? 0));
      const ty = Math.max(0, Math.min(H, targetRef.current?.y ?? 200));

      const world = new THREE.Vector3();
      for (const { el, obj, line } of labelsRef.current) {
        if (!line) continue;

        // 라벨(원 중심) 스크린 좌표
        obj.getWorldPosition(world);
        const ndc = world.clone().project(camera);
        const cx = (ndc.x * 0.5 + 0.5) * W;
        const cy = (-ndc.y * 0.5 + 0.5) * H;

        // 클리핑 체크
        const off = ndc.z < -1 || ndc.z > 1;
        line.setAttribute("visibility", off ? "hidden" : "visible");
        if (off) continue;

        // 라벨 원 반지름(px)
        const r = Math.max(el.offsetWidth, el.offsetHeight) * 0.5;

        // 중심 → 타깃 방향
        const dx = tx - cx;
        const dy = ty - cy;
        const d = Math.hypot(dx, dy);

        // 원 둘레의 최근접 교점(PX)
        const px = d > 0 ? cx + (dx / d) * r : cx + r;
        const py = d > 0 ? cy + (dy / d) * r : cy;

        // 선: (PX) → (타깃)
        line.setAttribute("x1", px.toFixed(1));
        line.setAttribute("y1", py.toFixed(1));
        line.setAttribute("x2", tx.toFixed(1));
        line.setAttribute("y2", ty.toFixed(1));
      }
    };
    tick();

    // Resize
    const onResize = () => {
      if (!rendererRef.current || !cameraRef.current) return;
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      rendererRef.current.setSize(w, h);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      labelRendererRef.current?.setSize(w, h);
      svgRef.current?.setAttribute("width", w);
      svgRef.current?.setAttribute("height", h);

      // 저장된 타깃도 컨테이너 범위로 보정
      if (targetRef.current) {
        targetRef.current.x = Math.max(0, Math.min(w, targetRef.current.x));
        targetRef.current.y = Math.max(0, Math.min(h, targetRef.current.y));
      }
    };
    window.addEventListener("resize", onResize);
    setReady(true);

    // Cleanup
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (labelRendererRef.current) {
        wrap.removeChild(labelRendererRef.current.domElement);
        labelRendererRef.current = null;
      }
      if (svgRef.current) {
        wrap.removeChild(svgRef.current);
        svgRef.current = null;
      }
      wrap.removeChild(renderer.domElement);

      for (const { line } of labelsRef.current) line?.remove?.();
      labelsRef.current = [];

      disposeObject3D(groupRef.current);
      scene.clear();
    };
  }, [background, fov, near, far, enableControlsRotate]);

  // 라벨 추가 (옵션에 clientX 전달 시 타깃 갱신)
  const addLabelAtHit = useCallback(
    (hit, { html, className, offset = 0.0005, clientX } = {}) => {
      if (!hit || !hit.object) return null;

      // 클릭된 X가 주어졌다면: targetX = 클릭X + 50, targetY = 200 (컨테이너 기준)
      if (typeof clientX === "number" && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();

        let x =
          clientX - rect.left > rect.width / 2
            ? clientX - rect.left + (clientX - rect.left) / 300
            : clientX - rect.left - 100;
        targetRef.current = { x, y: 200, has: true };
      }

      // 1) 라벨 DOM
      const el = document.createElement("span");
      el.className = className || "";
      el.innerHTML = html || "";
      if (!className && !html) {
        el.style.cssText = `
          width: 36px; height: 36px;
          border-radius: 50%;
          border: 3px solid #ff5252;
          background: rgba(255,82,82,.2);
          pointer-events: none;
          transform: translate(-50%, -50%);
        `;
      }

      // 2) CSS2DObject
      const label = new CSS2DObject(el);

      // 3) 라벨 위치(로컬) + 살짝 띄우기
      const localPoint = hit.object.worldToLocal(hit.point.clone());
      label.position.copy(localPoint);
      if (hit.face) {
        const nLocal = hit.face.normal.clone().normalize();
        label.position.add(nLocal.multiplyScalar(offset));
      }

      // 4) 메시에 부착
      hit.object.add(label);

      // 5) SVG 라인 생성
      const svg = svgRef.current;
      let line = null;
      if (svg) {
        const lineEl = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line"
        );
        lineEl.setAttribute("stroke", "#ff5252");
        lineEl.setAttribute("stroke-width", "2");
        lineEl.setAttribute("stroke-linecap", "round");
        lineEl.setAttribute("x1", "0");
        lineEl.setAttribute("y1", "0");
        lineEl.setAttribute("x2", "0");
        lineEl.setAttribute("y2", "0");
        svg.appendChild(lineEl);
        line = lineEl;
      }

      const rec = { el, obj: label, line };
      labelsRef.current.push(rec);
      return rec;
    },
    []
  );

  const clearLabels = useCallback(() => {
    for (const { obj, line } of labelsRef.current) {
      obj.parent?.remove(obj);
      line?.remove?.();
    }
    labelsRef.current = [];
  }, []);

  const loadPLY = useCallback(
    (plyUrl, textureUrl) =>
      new Promise((resolve, reject) => {
        const loader = new PLYLoader();
        loader.load(
          plyUrl,
          (geometry) => {
            geometry.computeVertexNormals();
            geometry.center();
            clearLabels();
            const texture = textureUrl
              ? new THREE.TextureLoader().load(textureUrl)
              : null;
            const mat = new THREE.MeshStandardMaterial({
              map: texture || null,
            });
            const mesh = new THREE.Mesh(geometry, mat);
            mesh.scale.setScalar(0.002);
            mesh.rotateZ(Math.PI);

            const group = groupRef.current;
            group.children.forEach((c) => {
              group.remove(c);
              disposeObject3D(c);
            });
            group.add(mesh);
            resolve(mesh);
          },
          undefined,
          (err) => reject(err)
        );
      }),
    [clearLabels]
  );

  const intersectAtClient = useCallback((clientX, clientY) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return [];
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNdcRef.current.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycasterRef.current.setFromCamera(mouseNdcRef.current, camera);
    return raycasterRef.current.intersectObject(groupRef.current, true);
  }, []);

  const rotateGroup = useCallback((dx, dy, speed = 0.0009) => {
    const g = groupRef.current;
    g.rotateY(dx * speed);
    g.rotateX(dy * speed);
  }, []);

  return {
    // refs
    containerRef,
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    groupRef,
    // state
    ready,
    // utils
    loadPLY,
    intersectAtClient,
    rotateGroup,
    addLabelAtHit, // 호출 시 옵션으로 { clientX: e.clientX } 넘기면 targetX = 클릭X+50 적용
    clearLabels,
  };
}
