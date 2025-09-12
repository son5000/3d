import { useMemo } from "react";
import { useState, useEffect } from "react";

// ✅ FFT 텍스트 파일을 파싱하는 함수
export function parseFFTText(text) {
  // 텍스트를 줄 단위로 나눔
  const lines = text.split("\n");
  const results = []; // 결과 데이터를 담을 배열

  let min = null; // min 값
  let max = null; // max 값
  let shift = null; // shift 값 (vision 정보)
  let thermalPalette = null; // add

  // ✅ 한 줄씩 반복 파싱
  lines.forEach((line) => {
    line = line.trim(); // 좌우 공백 제거

    // ✅ 빈 줄은 건너뜀
    if (!line) return;

    // ───────────────────────── thermal 줄일 때만 pal 파싱 ─────────────────────────  add
    if (
      thermalPalette === null &&
      line.startsWith("thermal") &&
      line.includes("pal=")
    ) {
      const thermalPaletteMatch = line.match(/pal\s*=\s*(\d+)/);
      if (thermalPaletteMatch) {
        thermalPalette = parseInt(thermalPaletteMatch[1]);
      }
    }
    // ───────────────────────────────────────────────────────────────────────────

    // ✅ min, max, shift 설정 줄인지 확인
    if (
      line.includes("min=") ||
      line.includes("max=") ||
      line.includes("shift=")
    ) {
      // ✅ 정규식으로 각각의 값 추출
      const minMatch = line.match(/min\s*=\s*(-?\d+)/);
      const maxMatch = line.match(/max\s*=\s*(-?\d+)/);
      const shiftMatch = line.match(/shift\s*=\s*(-?\d+)/);

      // ✅ 값이 있으면 숫자로 저장
      if (minMatch) min = parseInt(minMatch[1]);
      if (maxMatch) max = parseInt(maxMatch[1]);
      if (shiftMatch) shift = parseInt(shiftMatch[1]);

      return; // ✅ 설정 줄은 데이터 처리 안 하고 return
    }

    // ✅ 측정 데이터 줄 파싱 시작

    // ✅ 타임스탬프 추출
    const timestamp = line.match(/T([^/]+)/)?.[1]?.trim();

    // ✅ /D, /B, /V, /P, /H, /G 값 추출
    const d = line.match(/\/D\s*([^/]+)/)?.[1]; // Distance
    const b = line.match(/\/B\s*([^/]+)/)?.[1]; // Band
    const v = line.match(/\/V\s*([^/]+)/)?.[1]; // Volume
    const p = line.match(/\/P\s*([^/]+)/)?.[1]; // Peak
    const h = line.match(/\/H\s*([^/]+)/)?.[1]; // khz
    const g = line.match(/\/G\s*([^/]+)/)?.[1]; // Gps
    const a = line.match(/\/A\s*([^/]+)/)?.[1]; //

    // ✅ /F 값 (raw fft 데이터, 16진수 문자열) 추출
    const fHex = line.match(/\/F([A-Fa-f0-9]+)$/)?.[1];
    // ✅ 16진수 데이터 → 숫자 배열로 변환
    const fParsed = fHex ? parseHexFFT(fHex) : [];

    // ✅ 파싱한 데이터를 results 배열에 객체 형태로 저장
    // ✅ 최신 데이터를 배열 앞에 넣기 위해 unshift 사용
    results.unshift({
      timestamp, // 시간
      d: parseFloat(d), // Distance → 숫자
      b: parseFloat(b), // Band → 숫자
      v: parseFloat(v), // Volume → 숫자
      p: parseFloat(p), // Peak → 숫자
      h: parseFloat(h), // khz → 숫자
      a: parseFloat(a),
      shift,
      // thermalPalette: thermalPalette,    // add
      g: g ? g.split(",").map(Number) : [], // gps
      fParsed, // raw fft 값 배열
    });
  });

  // ✅ 첫 번째 데이터 (가장 최근 데이터) 추출
  let firstOfIndex = null;

  for (let i = 0; i < results.length; i++) {
    const fParsed = results[i].fParsed;
    if (Array.isArray(fParsed) && fParsed.some((v) => v !== 0)) {
      firstOfIndex = results[i];
      break; // 찾았으면 종료
    }
  }

  // ✅ 최종 결과 리턴
  // results: 스펙트로그램용 (전체 배열)
  // firstOfIndex: fft 그래프용 (가장 최근 1개)

  return { min, max, shift, results, firstOfIndex, thermalPalette };
}

// ✅ 16진수 문자열을 2자리씩 읽어서 숫자 배열로 바꾸는 함수
const parseHexFFT = (hexStr) => {
  let result = []; // 최종 숫자 배열
  const hexData = hexStr; // /F 다음의 16진수 문자열
  let minValue = 255; // 가장 작은 0이 아닌 값 찾기 (후보 초기값)

  // ✅ 두 글자씩 끊어서 16진수 → 숫자로 변환
  for (let i = 0; i < hexData.length; i += 2) {
    const hexPair = hexData.slice(i, i + 2); // 예: '5a'
    const value = parseInt(hexPair, 16); // 예: '5a' → 90
    if (value > 0 && value < minValue) {
      minValue = value; // 0이 아닌 최소값 갱신
    }
    result.push(value); // 배열에 추가
  }
  return result; // ✅ 최종 숫자 배열 반환
};

export function useFftDataParser(file) {
  const [parsedData, setParsedData] = useState(null);
  const [firstParsed, setFirstParsed] = useState(null);
  const [fftInfo, setFftInfo] = useState({
    shift: null,
    p: null,
    h: null,
    min: null,
    max: null,
    timestamp: null,
    src: null,
    mode: null,
    d: null,
    b: null,
    g: null,
    v: null,
    a: null,
    // thermalPalette: null, // add
  });
  useEffect(() => {
    if (!file?.data?.blob) return;

    fetch(file.data.blob)
      .then((res) => res.text())
      .then((text) => {
        const parsed = parseFFTText(text);

        const currentShift = parsed?.shift;
        let src = null;
        let mode = null;

        switch (currentShift) {
          case 10:
            src = "/images/elec.png";
            mode = "전기";
            break;
          case 6:
            src = "/images/gas.png";
            mode = "가스";
            break;
          case 1:
            src = "/images/audible.png";
            mode = "가청";
            break;
          default:
            src = null;
            mode = null;
        }

        setFftInfo({
          min: parsed?.min,
          p: parsed.firstOfIndex?.p,
          h: parsed.firstOfIndex?.h,
          d: parsed.firstOfIndex?.d,
          b: parsed.firstOfIndex?.b,
          v: parsed.firstOfIndex?.v,
          g: parsed.firstOfIndex?.g,
          a: parsed.firstOfIndex?.a,
          max: parsed.firstOfIndex?.fParsed?.length
            ? Math.max(...parsed.firstOfIndex.fParsed)
            : null,
          timestamp: parsed.firstOfIndex?.timestamp,
          src,
          mode,
        });
        setParsedData(parsed.results);
        setFirstParsed(parsed.firstOfIndex);

        // ✅ shift에 따라 src 설정
      })
      .catch((err) => console.error("FFT 데이터 파싱 실패:", err));
  }, [file]);

  return { parsedData, firstParsed, fftInfo };
}

export function useFftPoints(DATA) {
  return useMemo(() => {
    if (!DATA || !DATA.fParsed || !DATA.p) {
      return { points: [], maxValue: null, maxIndex: null };
    }

    if (DATA.shift) {
    }

    const fParsed = DATA.fParsed;
    const frequencyStep = 48000 / fParsed.length;

    const ampValues = fParsed.map((i) => (i / 255.0) * DATA.p);

    const { avgdB, bandingHz } = shiftAvg(ampValues, DATA.shift);

    const points = bandingHz.map((amp, i) => ({
      x: (i * frequencyStep) / 1000 - frequencyStep / 2000,
      y: amp,
    }));

    let maxdB = Math.max(...ampValues);
    const maxIndex = ampValues.indexOf(maxdB);
    let maxhz = points[maxIndex]?.x ?? null;
    maxdB = maxdB.toFixed(1);
    maxhz = maxhz.toFixed(2);
    if (Number(maxhz) <= 1) {
      maxhz = 0;
    }

    return { points, maxdB, maxhz, avgdB };
  }, [DATA]);
}

function shiftAvg(ampValues, shift) {
  let startIdx = 0;
  let lastIdx = 0;
  let sum = 0;
  let sumCnt = 0;
  let avgdB = 0;

  switch (shift) {
    case 1:
      startIdx = 0;
      lastIdx = 150;
      break;
    case 6:
      startIdx = 120;
      lastIdx = 300;
      break;
    case 10:
      startIdx = 220;
      lastIdx = 512;
      break;
    default:
      startIdx = 0;
      lastIdx = 512;
  }

  let bandingHz = [...ampValues];

  for (let i = 0; i < 512; i++) {
    if (i >= startIdx && i <= lastIdx) {
      sum += ampValues[i] * ampValues[i];
      sumCnt++;
    } else {
      bandingHz[i] = 0;
    }
  }

  avgdB = Math.sqrt(sum / sumCnt);

  avgdB = avgdB.toFixed(1);

  return { avgdB, bandingHz };
}
