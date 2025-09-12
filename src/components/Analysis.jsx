import { useEffect,useRef } from "react";

export default  function Analysis ({
  analysis
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const analyser = analysis?.analyser;
    if (!analyser) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.width;
    const height = canvas.height;
    const g = canvas.getContext("2d");

    const buffer = new Float32Array(analyser.fftSize); // 재사용 버퍼
    let rafId = 0;

    

    const draw = () => {
      analyser.getFloatTimeDomainData(buffer);

      // 배경
      g.clearRect(0, 0, width, height);
      g.fillStyle = "#63707dff";
      g.fillRect(0, 0, width, height);

      // 중앙선
      g.strokeStyle = "#ffffffff";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, height / 2);
      g.lineTo(width, height / 2);
      g.stroke();

      // 파형
      g.strokeStyle = "#87ff62ff";
      g.lineWidth = 2;
      g.beginPath();

      const step = buffer.length / width; // 수평 샘플 스텝
      for (let x = 0; x < width; x++) {
        const i = (x * step) | 0;
        const v = buffer[i];              // -1..1
        const y = (1 - (v + 1) / 2) * height; // 위가 0
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [analysis]);

  return (
    <div className="analysis">
      <canvas ref={canvasRef} />
    </div>
  );
}
