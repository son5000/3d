// _______file detail page => 초음파, 열화상, 자외선 테이블 (표)_______
export default function FileValueTable({ values, }) {
  let tableHeaders = [
    {
      value: values?.avgdB ?? 0,
      key: "avg_decibel",
      label: "검출",
      unit: "(dB)",
    },
    {
      value: values?.peakdB ?? 0,
      key: "peak_decibel",
      label: "최대",
      unit: "(dB)",
    },
    {
      value: values?.peakHz ?? 0,
      key: "peak_hz",
      label: "최대 주파수",
      unit: "(kHz)",
    },
    {
      value: values?.distance ?? 0,
      key: "distance",
      label: "측정거리",
      unit: "(m)",
    },
  ];

  return (
    <table className="fileValueTable">
      <thead>
        <tr>
          {tableHeaders.map(({ label, unit }) => (
            <th key={label}>
              {label}
              <span>{unit}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {tableHeaders.map((i, idx) => {
            return <td key={idx + 1}>{i.value}</td>;
          })}
        </tr>
      </tbody>
    </table>
  );
}
