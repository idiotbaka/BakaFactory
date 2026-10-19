import { useCallback, useEffect, useRef, useState } from "react";
import { getHealth, type Health, type User } from "./api/client";
import AccountPanel from "./AccountPanel";
import { GameWordmark, NeonScene } from "./GameArt";

type Connection =
  | { kind: "checking" }
  | { kind: "online"; health: Health; time: Date }
  | { kind: "offline"; message: string };

function FactoryMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="m16 2 13 7v14l-13 7L3 23V9z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M9 21V12l7 4V9l7 4v8H9Z"
        fill="currentColor"
        fillOpacity=".15"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M13 21v-3m6 3v-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function App() {
  const [player, setPlayer] = useState<User | null>(null);
  const [connection, setConnection] = useState<Connection>({
    kind: "checking",
  });
  const controller = useRef<AbortController | null>(null);
  const check = useCallback(() => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(
      () => request.abort(new Error("连接超时，请稍后重试")),
      5000,
    );
    void getHealth(request.signal)
      .then((health) => {
        if (controller.current === request && !request.signal.aborted)
          setConnection({ kind: "online", health, time: new Date() });
      })
      .catch((error: unknown) => {
        if (controller.current === request)
          setConnection({
            kind: "offline",
            message: error instanceof Error ? error.message : "无法连接服务器",
          });
      })
      .finally(() => clearTimeout(timeout));
  }, []);
  useEffect(() => {
    void check();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [check]);
  const online = connection.kind === "online";
  const retry = () => {
    setConnection({ kind: "checking" });
    void check();
  };
  return (
    <div className={`shell ${player ? "game-shell" : "landing-shell"}`}>
      <header className="site-header">
        <a href="/" className="brand" aria-label="BakaFactory 首页">
          <FactoryMark />
          <span>
            BAKA<span className="brand-muted">FACTORY</span>
            <small>NEON INDUSTRIES</small>
          </span>
        </a>
        <span className="header-label">自动化永不眠 / IDLE AUTOMATION</span>
        {player && (
          <span className="header-connection">
            <span className={`connection-dot ${connection.kind}`} />
            <span className="connection-label">
              {online
                ? "Server: Online"
                : connection.kind === "checking"
                  ? "连接检查中"
                  : "Server: Offline"}
            </span>
            <button
              aria-label="重新检查服务器状态"
              onClick={retry}
              disabled={connection.kind === "checking"}
            >
              ↻
            </button>
          </span>
        )}
        <span className="stage-tag">BUILD. CONNECT. REPEAT.</span>
      </header>
      <main>
        <div className="landing-content">
          {!player && (
            <section className="landing-hero" aria-label="霓虹工厂">
              <div className="eyebrow">
                <span /> IDLE FACTORY / ONLINE WORLD
              </div>
              <h1>
                <span className="sr-only">BAKA FACTORY · 霓虹工厂</span>
                <GameWordmark />
              </h1>
              <div className="hero-slogan">
                让工厂，<em>接管黑夜。</em>
              </div>
              <p className="intro">
                开采、熔炼、装配。接通你的第一条生产线，
                <br />
                让每一次归来，都有新的齿轮为你转动。
              </p>
              <NeonScene />
              <div className="game-loop">
                <span>
                  <b>01</b> BUILD / 建造
                </span>
                <i>→</i>
                <span>
                  <b>02</b> CONNECT / 连通
                </span>
                <i>→</i>
                <span>
                  <b>03</b> AUTOMATE / 自动化
                </span>
              </div>
            </section>
          )}
          <AccountPanel onUserChange={setPlayer} />
        </div>
        {!player && (
          <section
            className={`status-card ${connection.kind}`}
            aria-label="游戏连接状态"
          >
            <div className="status-row" role="status" aria-live="polite">
              <span className="status-dot" />
              <h2>
                Server:{" "}
                {online
                  ? "Online"
                  : connection.kind === "checking"
                    ? "Checking"
                    : "Offline"}
              </h2>
              <span className="status-description">
                {online
                  ? "连接就绪 · 你的工厂正在等待"
                  : connection.kind === "checking"
                    ? "正在接入工厂网络…"
                    : "连接中断，请确认服务已启动"}
              </span>
              <button
                onClick={retry}
                disabled={connection.kind === "checking"}
                aria-label="重新检查服务器状态"
              >
                <span aria-hidden="true">↻</span> 重连
              </button>
            </div>
            {connection.kind === "offline" && (
              <p className="error-detail">{connection.message}</p>
            )}
            <details className="connection-details">
              <summary>连接详情</summary>
              <div className="metrics">
                <div>
                  <span>VERSION</span>
                  <strong>
                    {online ? `v${connection.health.version}` : "—"}
                  </strong>
                </div>
                <div>
                  <span>DATABASE</span>
                  <strong>{online ? "SQLite · Ready" : "—"}</strong>
                </div>
                <div>
                  <span>ENVIRONMENT</span>
                  <strong>
                    {online ? connection.health.environment : "—"}
                  </strong>
                </div>
              </div>
              <p>
                {online
                  ? `最后检查 ${connection.time.toLocaleTimeString("zh-CN", { hour12: false })}`
                  : "等待服务响应"}
              </p>
            </details>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>
          BAKAFACTORY <span className="footer-dot">/</span>{" "}
          一座工厂，一整个不眠之夜。
        </span>
        <span>NO RUSH. JUST FLOW.</span>
      </footer>
    </div>
  );
}
