// useMouseHandlers.js
import { useCallback, useRef, useState } from "react";

export function useMouseHandlers({
  cameraRef,
  groupRef,
  rotateGroup,
  intersectAtClient,
  clearLabels,
  addLabelAtHit,
}) {
  const DRAG_TOL = 4;

  // 드래그 상태는 ref로(리렌더 없이 유지)
  const dragging = useRef(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  const downOnMesh = useRef(false);
  const lastDragAt = useRef(0);

  const shouldSuppressClick = () =>
    performance.now() - lastDragAt.current < 200;

  const onClick = async (e) => {
    if (shouldSuppressClick()) return;

    const hits = intersectAtClient(e.clientX, e.clientY);
    const camera = cameraRef.current;
    if (!camera) return;

    if (hits.length) {
      // 이전 마커 제거 → 새로 1개만 유지하고 싶다면
      clearLabels();

      console.log(hits[0].point);

      // 라벨 추가
      addLabelAtHit(hits[0], { clientX: e.clientX });

      // 카메라 포커스(선택)
      const { x, y } = hits[0].point;
      camera.position.set(x, y, -0.07);
    } else {
      // 배경 클릭: 마커/뷰 초기화
      clearLabels();

      camera.position.set(0, 0, -0.1);
      groupRef.current.rotation.set(0, 0, 0);
    }
  };

  const onPointerDown = useCallback(
    (e) => {
      // 메시 위면 회전 드래그 시작 안 함
      downOnMesh.current = intersectAtClient(e.clientX, e.clientY).length > 0;
      if (downOnMesh.current) return;

      dragging.current = true;
      moved.current = false;
      start.current = last.current = { x: e.clientX, y: e.clientY };

      // React Synthetic Event에서도 currentTarget로 캡처 가능
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [intersectAtClient]
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!dragging.current) return;

      const dxAll = e.clientX - start.current.x;
      const dyAll = e.clientY - start.current.y;
      if (
        !moved.current &&
        (Math.abs(dxAll) > DRAG_TOL || Math.abs(dyAll) > DRAG_TOL)
      ) {
        moved.current = true; // 드래그로 인정
      }

      if (moved.current) {
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };

        // 원하는 부호/감도로 조정
        rotateGroup(dx, -dy, 0.001);
      }
    },
    [rotateGroup]
  );

  const endDrag = useCallback((e) => {
    if (dragging.current) {
      dragging.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (moved.current) lastDragAt.current = performance.now();
    }
  }, []);

  // 필요하면 배경 밖으로 나갔을 때 초기화
  const onPointerLeave = useCallback(() => {
    dragging.current = false;
    moved.current = false;
    lastDragAt.current = performance.now();
    const cam = cameraRef.current;
    if (cam) cam.position.set(0, 0, -0.1);
    groupRef.current?.rotation.set(0, 0, 0);
  }, [cameraRef, groupRef]);

  return {
    onClick,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onPointerLeave,
  };
}
