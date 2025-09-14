import FileValueTable from "./FileValueTable";
import FrequencySlider from "./FrequencySlider";
import Analysis from "./Analysis";
import FftBarGraph from "./FftBarGraph";
import { useEffect, useState } from "react";

export default function Info({
  isMouseOption, // ← (선택) 현재 모드 표시용
  setIsMouseOption,
  setIsCameraReset,
  isPlay,
  setIsPlay,
  setFrequencyRange,
  analysis,
  frequneyRange,
  clickSpectrum,
  distance
}) {
  const playIconSrc = `/images/${isPlay ? "play" : "pause"}_icon.png`;
  const playLabel = isPlay ? "재생" : "일시정지";

  // values를 객체로(테이블 키와 일치)
  const [values, setValues] = useState({
    avgdB: "", peakdB: "", peakHz: "",
  });


  return (
    <div className="info">
      <p>* Information</p>
      <Analysis distance={distance} analysis={analysis} />
      <div className="toolBar">
        <ul>
          <li
            onClick={() => setIsMouseOption("pointer")}
            className={isMouseOption === "pointer" ? "active" : ""}
            title="선택(포인터 모드)"
            
          >
            <p>선택</p>
            <img src="/images/mouse_pointer_1.png" alt="포인터 모드" />
          </li>

          <li
            onClick={() => setIsMouseOption("move")}
            className={isMouseOption === "move" ? "active" : ""}
            title="회전/이동(무브 모드)"
          >
            <p>회전/이동</p>
            <img src="/images/mouse_pointer_2.png" alt="무브 모드" />
          </li>

          <li
            onClick={() => setIsCameraReset("reset")}
            title="카메라/메시 초기화"
          >
            <p>초기화</p>
            <img src="/images/reset_icon.png" alt="초기화" />
          </li>

          <li onClick={() => setIsPlay(!isPlay)} title={`${playLabel} 토글`}>
            <p>{playLabel}</p>
            {/* ✅ 템플릿 문자열은 중괄호 사용 */}
            <img src={playIconSrc} alt={playLabel} />
          </li>
          <li>
            <p>모드</p>
            {/* ✅ 템플릿 문자열은 중괄호 사용 */}

            <FrequencySlider setFrequencyRange={setFrequencyRange} />
          </li>
        </ul>
      </div>

      <div className="dashboard">
        <p className="subTitleP">* fft그래프</p>
        <FftBarGraph
         frequneyRange={frequneyRange}
         data={clickSpectrum}
         values={values}
         setValues={setValues} // ← 그대로 두면 FFT 메트릭(avg/peak)이 values에 들어옴
        />
        <p className="subTitleP">* 측정 값</p>
        <FileValueTable values={values} setValues={setValues} />
      </div>
    </div>
  );
}
