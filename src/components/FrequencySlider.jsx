import { useMemo, useRef, useState, useEffect, useCallback } from "react";

/**
 * FrequencySlider
 * - 무한루프: [마지막 클론] + 원본들 + [첫번째 클론]
 * - prev/next 클릭 시 슬라이드 이동
 * - 경계(클론)에 도달하면 transitionend에서 스냅(transition 없이 실제 인덱스로 점프)
 *
 * props
 * - items: [{ src, type, alt }]
 * - slideWidth: 각 슬라이드 너비(px) — 기본 50
 * - initialIndex: 시작 인덱스(클론 제외 1~items.length) — 기본 2 (원 코드 맞춤)
 * - onChange(type): 인덱스 변경 시 현재 type 콜백
 */
export default function FrequencySlider({
  items = [
    {
      src: "./images/frequency_Range_icon_audible.png",
      type: "audible",
      alt: "audible",
    },
    { src: "./images/frequency_Range_icon_gas.png", type: "gas", alt: "gas" },
    {
      src: "./images/frequency_Range_icon_elec.png",
      type: "elec",
      alt: "elec",
    },
  ],
  slideWidth = 50,
  initialIndex = 3,
  onChange,
  //   currentIndex,
  setFrequencyRange,
}) {
  // 확장 트랙(클론 포함): [last, ...items, first]
  const extended = useMemo(() => {
    if (!items.length) return [];
    const first = items[0];
    const last = items[items.length - 1];
    return [last, ...items, first];
  }, [items]);

  const slideCount = items.length; // 원본 개수
  const maxIndex = slideCount + 1; // 마지막 클론 인덱스
  const clampStart = Math.min(Math.max(initialIndex, 1), slideCount);
  const [currentIndex, setCurrentIndex] = useState(clampStart);
  const [animating, setAnimating] = useState(true); // 평소엔 true, 스냅 시 false
  const trackRef = useRef(null);

  // 현재 타입 콜백
  useEffect(() => {
    if (!extended.length) return;
    const curr = extended[currentIndex];
    if (curr?.type && onChange) onChange(curr.type);
    // 콘솔 로그 (원 코드와 동일 동작)
    // if (curr?.type) console.log(curr.type);.
    setFrequencyRange(curr.type);
  }, [currentIndex, extended, onChange]);

  // transitionend에서 무한 루프 스냅 처리
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const onTransitionEnd = () => {
      // 맨 앞 클론(0) → 실제 마지막(slideCount)로 즉시 점프
      if (currentIndex === 0) {
        setAnimating(false);
        setCurrentIndex(slideCount);
      }
      // 맨 뒤 클론(slideCount+1) → 실제 처음(1)으로 즉시 점프
      else if (currentIndex === slideCount + 1) {
        setAnimating(false);
        setCurrentIndex(1);
      }
    };

    el.addEventListener("transitionend", onTransitionEnd);
    return () => el.removeEventListener("transitionend", onTransitionEnd);
  }, [currentIndex, slideCount]);

  // 스냅 후 다음 이동부터 다시 부드럽게 애니메이션
  useEffect(() => {
    if (!animating) {
      // 다음 프레임에 transition 복구
      const id = requestAnimationFrame(() => setAnimating(true));
      return () => cancelAnimationFrame(id);
    }
  }, [animating]);

  const canGoNext = currentIndex < maxIndex; // 마지막 클론까지만 이동 허용
  const canGoPrev = currentIndex > 0; // 첫 클론까지 이동 허용

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    setAnimating(true);
    setCurrentIndex((i) => i + 1);
  }, [canGoNext]);

  const goPrev = useCallback(() => {
    if (!canGoPrev) return;
    setAnimating(true);
    setCurrentIndex((i) => i - 1);
  }, [canGoPrev]);

  // 이미지 클릭 시 next (원 jQuery 동작)
  const onImageClick = useCallback(() => {
    goNext();
  }, [goNext]);

  // 트랙 스타일 (너비/이동/애니메이션)
  const trackStyle = {
    width: `${extended.length * slideWidth}px`,
    display: "flex",
    transform: `translateX(${-slideWidth * currentIndex}px)`,
    transition: animating ? "transform 0.3s ease-in-out" : "none",
  };

  return (
    <div style={{ overflow: "hidden" }} className="frequencySliderContainer">
      <div className="frequencyRange">
        <div
          className="frequencyTrack"
          id="frequencyTrack"
          ref={trackRef}
          style={trackStyle}
        >
          {extended.map((item, idx) => (
            <div
              className="frequencyItem"
              key={`${item.type}-${idx}`}
              style={{ width: `${slideWidth}px`, flex: "0 0 auto" }}
            >
              <img
                src={item.src}
                data-type={item.type}
                alt={item.alt}
                onClick={onImageClick}
                style={{ width: "100%", display: "block", cursor: "pointer" }}
              />
            </div>
          ))}
        </div>
      </div>
      {/* prev / next 버튼 (이미지 소스는 기존 경로 사용) */}
      <div className="btnBox">
        <button className="arrow prevBtn" onClick={goPrev} aria-label="prev">
          <img src="./images/rightArrow.png" alt="prev" />
        </button>
        <button className="arrow nextBtn" onClick={goNext} aria-label="next">
          <img src="./images/leftArrow.png" alt="next" />
        </button>
      </div>
    </div>
  );
}
