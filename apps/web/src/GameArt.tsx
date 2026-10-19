// Static vector art: no images to fetch, animation loop, filters or canvas.
const alphabet: Record<string, string[]> = {
  A: ["01110", "11011", "11011", "11111", "11011", "11011", "11011"],
  B: ["11110", "11011", "11011", "11110", "11011", "11011", "11110"],
  K: ["11011", "11011", "11110", "11100", "11110", "11011", "11011"],
  F: ["11111", "11000", "11000", "11110", "11000", "11000", "11000"],
  C: ["01111", "11000", "11000", "11000", "11000", "11000", "01111"],
  T: ["11111", "01110", "00100", "00100", "00100", "00100", "00100"],
  O: ["01110", "11011", "11011", "11011", "11011", "11011", "01110"],
  R: ["11110", "11011", "11011", "11110", "11100", "11010", "11011"],
  Y: ["11011", "11011", "11011", "01110", "00100", "00100", "00100"],
};
function pixelWord(word: string) {
  return [...word]
    .flatMap((letter, index) =>
      (alphabet[letter] ?? []).flatMap((row, y) =>
        [...row].flatMap((cell, x) =>
          cell === "1" ? [`M${index * 6 + x} ${y}h1v1h-1z`] : [],
        ),
      ),
    )
    .join("");
}
const baka = pixelWord("BAKA"),
  factory = pixelWord("FACTORY");
export function GameWordmark() {
  return (
    <svg className="game-wordmark" viewBox="-1 -1 44 20" aria-hidden="true">
      <g fill="var(--pink)" transform="translate(.45 .25)">
        <path d={baka} />
        <path d={factory} transform="translate(0 10)" />
      </g>
      <g fill="var(--cyan)" transform="translate(-.3 0)">
        <path d={baka} />
        <path d={factory} transform="translate(0 10)" />
      </g>
      <g fill="currentColor">
        <path d={baka} />
        <path d={factory} transform="translate(0 10)" />
      </g>
      <path d="M26 2h15M26 4h9M26 6h12" stroke="var(--cyan)" strokeWidth=".3" />
    </svg>
  );
}

export function NeonScene() {
  return (
    <div className="neon-scene" aria-hidden="true">
      <span className="scene-label">NEON INDUSTRIES / SECTOR 01</span>
      <svg viewBox="0 0 680 330" fill="none">
        <defs>
          <linearGradient
            id="scene-sunset"
            x1="340"
            y1="27"
            x2="340"
            y2="197"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ffc179" />
            <stop offset=".45" stopColor="#ff65b9" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient
            id="scene-floor"
            x1="340"
            y1="183"
            x2="340"
            y2="330"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fa55d9" stopOpacity=".06" />
            <stop offset="1" stopColor="#8562ff" stopOpacity=".15" />
          </linearGradient>
        </defs>
        <circle cx="340" cy="112" r="84" fill="url(#scene-sunset)" />
        <path
          d="M250 132h180m-180 13h180m-180 15h180m-180 17h180m-180 18h180"
          stroke="#090b1b"
          strokeWidth="6"
        />
        <path
          d="M40 186v-38h24v-22h18v60m27 0V99h23v87m8 0v-48h28v48m8 0v-70h20v70m286 0v-69h22v69m9 0v-95h27v95m10 0v-43h37v43m20 0v-66h18v66"
          fill="#101025"
          stroke="#644683"
        />
        <path
          d="M115 110v12m0 6v12m10-30v12m0 6v12m401-25v12m10-12v12m80 4v12m0 4v12"
          stroke="#f876d0"
          opacity=".55"
        />
        <path d="M0 188h680v142H0z" fill="url(#scene-floor)" />
        <g stroke="#a354d1" strokeOpacity=".2">
          <path d="M0 205h680M0 230h680M0 268h680M0 324h680M315 188 240 330m90-142-23 142m38-142 31 142m-16-142 90 142m-75-142 159 142m-235-142L158 330m126-142L65 330m325-142 235 142" />
        </g>
        <path
          d="m118 223 219-69 224 69-224 74z"
          fill="#111327"
          stroke="#7e4ca0"
        />
        <path
          d="m118 223 219 74 224-74v14l-224 75-219-75z"
          fill="#0a0c1b"
          stroke="#443164"
        />
        <path d="m147 226 190 63 194-63" stroke="#ff5ed1" />
        <path d="m183 212 152 48 159-49" stroke="#31e8f3" strokeWidth="8" />
        <path
          d="m183 212 152 48 159-49"
          stroke="#103045"
          strokeWidth="4"
          strokeDasharray="4 5"
        />
        <g stroke="#5cecf3" strokeWidth="1.5" strokeLinejoin="round">
          <path d="m160 178 32-10 31 11-32 11z" fill="#183342" />
          <path
            d="m160 178 31 12v28l-31-11zm31 12 32-11v28l-32 11z"
            fill="#102030"
          />
          <path d="m174 180 18-6 17 6-18 6zm17 10v28m-23-28v11m10-8v11" />
        </g>
        <g stroke="#ff72bc" strokeWidth="1.5" strokeLinejoin="round">
          <path d="m285 206 38-12 39 13-38 13z" fill="#3a1b43" />
          <path
            d="m285 206 39 14v32l-39-14zm39 14 38-13v32l-38 13z"
            fill="#20152f"
          />
          <path
            d="m297 211 18 6v16l-18-6zm41 7 11-4v16l-11 4z"
            fill="#ff6ca3"
            fillOpacity=".4"
          />
          <path d="M300 201v-31l9-3 8 3v28m-17-28 9 4 8-4m-8 4v26" />
        </g>
        <g stroke="#a996ff" strokeWidth="1.5" strokeLinejoin="round">
          <path d="m436 181 33-11 34 12-34 11z" fill="#29224d" />
          <path
            d="m436 181 33 12v28l-33-12zm33 12 34-11v28l-34 11z"
            fill="#171b34"
          />
          <path d="m449 181 20-7 20 7-20 7z" fill="#aa92ff" fillOpacity=".25" />
          <path d="m449 196 11 4m17 0 15-5m-15 13 15-5" />
        </g>
        <path
          d="m255 237 9 3m137 0 9-3m-11 24 8-3"
          stroke="#ffc179"
          strokeWidth="5"
        />
        <path
          d="M34 270h40v-18m532-23v25h38M34 44h26M34 44v26m612-26h-26m26 0v26"
          stroke="#42d8e8"
          strokeOpacity=".45"
        />
      </svg>
      <span className="scene-caption">从一块铁矿，到一座不眠的工厂。</span>
    </div>
  );
}
