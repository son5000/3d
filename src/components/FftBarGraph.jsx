import { useEffect,useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function FftBarGraph({ data , frequneyRange,values,setValues }) {

  
  // 고정값: 96 kHz 샘플레이트, fftSize=1024 → Nyquist=48 kHz
  const BIN_COUNT = 1024;        
  const STEP_HZ = 48000 / 1024;        
  const bins = data?.bins ? data?.bins : [];                
  const shiftBins = useMemo(() => {
    const temp = new Array(BIN_COUNT);
    for (let i = 0; i < BIN_COUNT; i++) {
      temp[i] = {
        x: (i * STEP_HZ) / 1000,
        y: Math.max(0, (bins[i] + 150) / 5),
      };
    }
    return temp;
  }, [bins]);



  const { points, avgdB,peakdB,peakHz } = useMemo(() => bandingHz(shiftBins, frequneyRange), [shiftBins, frequneyRange]);

  useEffect(() => {
    if (avgdB && !isNaN(avgdB)) {
      setValues({avgdB,peakdB,peakHz});
    }
  }, [avgdB, setValues]);

  const chartData = {
    datasets: [
      {
        label: "Amplitude",
        data: points,
        backgroundColor: "#1868db",
        borderSkipped: false,
      },
    ],
  };

  const options = {
    parsing: { xAxisKey: "x", yAxisKey: "y" },
    animation: false,
    maintainAspectRatio: false,
    responsive: true,
    scales: {
      x: {
        type: "linear",
        min: 0,
        max: 48, // kHz (96k 샘플레이트의 Nyquist)
        title: { display: true, text: "Frequency (kHz)" },
        ticks: { stepSize: 6, callback: (v) => `${v} kHz` },
      },
      y: {
        min: 0,
        max: 100, // 필요시 조정
        title: { display: true, text: "Amplitude (dBFS + 90)" },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const { x, y } = ctx.raw || {};
            // 원래 dBFS로 보려면 -90
            const dbfs = typeof y === "number" ? (y - 90).toFixed(1) : y;
            return `f: ${x?.toFixed(2)} kHz, ${dbfs} dBFS`;
          },
        },
      },
    },
  };

  return (
    <div className="fftGraph">
      <Bar data={chartData} options={options} />
    </div>
  );
}
function bandingHz(shiftBins, frequencyRange) {
  let startX = 0; 
  let endX = 48;
  let multiple = 1;
  let sum = 0;
  let sumCnt = 0;
  let maxY = 0;
  let maxX = 0;

  switch (frequencyRange) {
    case "audible": 
      startX = 0;  multiple = 1; endX = 10;
      break; 
    case "gas": 
      startX = 2;  multiple = 5; endX = 6.5;
      break; 
    case "elec": 
      startX = 2.5;  multiple = 10; 
      break; 
    default: 
      startX = 0;  multiple = 1;
      break; 
  } 

  let points = [...shiftBins]; 

  for (let index = 0; index < points.length; index++) {

    points[index].x = points[index].x * multiple;
    if (points[index].x < startX * multiple || points[index].x > endX * multiple) {
      points[index].y = 0;
      continue;
    }

  if (points[index].y > maxY) {
    maxY = points[index].y;
    maxX = points[index].x;
  }
    sum += points[index].y * points[index].y;
    sumCnt++;
  } 

    let avgdB = Math.sqrt(sum / sumCnt).toFixed(1);
    maxY = maxY.toFixed(1);
    maxX = maxX.toFixed(1);

  return { points, avgdB, peakdB : maxY, peakHz : maxX };
}
