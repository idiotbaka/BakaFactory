import { memo } from "react";

// Integer SVG geometry shares the ground belts' dark track / steel / neon palette.
function UndergroundVisual({
  rotation = 0,
  exit = false,
}: {
  rotation?: number;
  exit?: boolean;
}) {
  return (
    <svg
      className="underground-visual"
      viewBox="0 0 30 30"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <g transform={`rotate(${-rotation} 15 15)`}>
        <path d="M0 7H30V23H0Z" fill="#080b17" />
        <path d="M0 7H30V10H0ZM0 20H30V23H0Z" fill="#657184" />
        <path d="M1 8H29V9H1ZM1 21H29V22H1Z" fill="#b4c6cd" />
        <path
          d="M2 11H4V19H2ZM7 11H9V19H7ZM12 11H14V19H12ZM17 11H19V19H17ZM22 11H24V19H22Z"
          fill="#28324b"
        />
        <g transform={exit ? "translate(30 0) scale(-1 1)" : undefined}>
          <path d="M17 3H29V27H17L13 23V7Z" fill="#080b17" />
          <path d="M18 4H28V26H18L14 22V8Z" fill="#66758b" />
          <path d="M18 5H27V8H17L15 10V8Z" fill="#c6d7dc" />
          <path d="M18 9H27V22H18L16 20V11Z" fill="#141a2b" />
          <path d="M19 11H27V20H19Z" fill="#080b17" />
          <path d="M21 23H26V25H21Z" fill={exit ? "#46eff2" : "#ff72cf"} />
          <path d="M18 5H20V7H18ZM24 5H26V7H24Z" fill="#e3bd70" />
          <path d="M19 5H20V7H19ZM25 5H26V7H25Z" fill="#31364c" />
        </g>
        <path
          d={
            exit
              ? "M19 12L24 15 19 18V16H15V14H19Z"
              : "M7 12L12 15 7 18V16H3V14H7Z"
          }
          fill={exit ? "#46eff2" : "#ff72cf"}
        />
      </g>
    </svg>
  );
}
export default memo(UndergroundVisual);
