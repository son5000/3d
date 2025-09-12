import ThreeViewer from "./components/ThreeViewer";
import { useState } from "react";
import Info from "./components/Info";
import "./css/import.css";

export default function App() {
  const [isMouseOption, setIsMouseOption] = useState("");
  const [isCameraReset, setIsCameraReset] = useState("");
  const [isPlay, setIsPlay] = useState(false);
  const [frequneyRange, setFrequencyRange] = useState("elec");
  const [analysis, setAnalysis] = useState(null); 
  const [clickSpectrum, setClickSpectrum] = useState(null);
  const [currentVlaues,setCurrentVlaues] = useState({
    avgdB : '',
    peakdB : '',
    peakHz : '',
    distance :''
  })

  const audioUrls = {
    tl: `/assets/${frequneyRange}_left.wav`,
    bl: `/assets/${frequneyRange}_left.wav`,
    tr: `/assets/${frequneyRange}_right.wav`,
    br: `/assets/${frequneyRange}_right.wav`,
    hotspot:`/assets/${frequneyRange}_hotspot.wav`,
  };



  return (
    <div id="root" className="container">
      <header>
        <img src="/images/mainLogo.png" alt="" />
      </header>
      <div>
        <ThreeViewer
          plyUrl="/assets/sample.ply"
          textureUrl="/assets/sample.png"
          mouseMode={isMouseOption}
          isCameraReset={isCameraReset}
          setIsCameraReset={setIsCameraReset}
          isPlay={isPlay}
          onAnalysisReady={setAnalysis}
          onClickSpectrum={setClickSpectrum}
          // 🔊 카메라-코너 배경음 설정
          ambience={{
            distance: 0.5,          // 카메라로부터 코너까지 거리
            urls: audioUrls,        // 코너별 파일
            gains: { tl: 0.001, tr: 0.001, bl: 0.001, br: 0.001,hotspot:2.0  }, // 기본 볼륨
            autoplay: isPlay,       // 사용자 토글로 재생 시작(첫 제스처 필요)
            hotspot: {
              pos: [7.5, 3, 0],
              distanceModel: "exponential", // 급격 감쇠
              refDistance: 0.5 ,             // 20cm 정도 기준 거리
              maxDistance: 3.0,             // 1m 이상 멀어지면 거의 무음
              rolloff: 2.0,                 // 감쇠 속도 크게
            }
            // 아래 3개는 선택(줌아웃 시 점점 작아지게 하고 싶다면)
          }}
        />

        <Info
          isMouseOption={isMouseOption}
          setIsMouseOption={setIsMouseOption}
          isCameraReset={isCameraReset}
          setIsCameraReset={setIsCameraReset}
          isPlay={isPlay}
          setIsPlay={setIsPlay}
          frequneyRange={frequneyRange}
          setFrequencyRange={setFrequencyRange}
          analysis={analysis}
          clickSpectrum={clickSpectrum} 
        />
      </div>
    </div>
  );
}
