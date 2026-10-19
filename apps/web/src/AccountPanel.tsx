import { useCallback, useEffect, useState } from "react";
import FactoryWorkspace from "./game/FactoryWorkspace";
import HudPopover from "./HudPopover";
import {
  ApiError,
  authenticate,
  getCurrentUser,
  logout,
  updateProfile,
  type User,
} from "./api/client";

type SessionState =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "member"; user: User }
  | { kind: "unavailable"; message: string };
function message(error: unknown): string {
  return error instanceof Error ? error.message : "连接失败，请稍后重试";
}

export default function AccountPanel({
  onUserChange,
}: {
  onUserChange?: (user: User | null | undefined) => void;
}) {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    onUserChange?.(
      session.kind === "loading"
        ? undefined
        : session.kind === "member"
          ? session.user
          : null,
    );
  }, [session, onUserChange]);
  const sessionExpired = useCallback(() => {
    setSession({ kind: "guest" });
    setMode("login");
    setError("登录已过期，请重新登录。");
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("连接超时，请重试")),
      5000,
    );
    void getCurrentUser(controller.signal)
      .then((user) => {
        if (!active || controller.signal.aborted) return;
        setSession(user ? { kind: "member", user } : { kind: "guest" });
        if (user) setDisplayName(user.display_name);
      })
      .catch((error: unknown) => {
        if (active)
          setSession({ kind: "unavailable", message: message(error) });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [reload]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    if (mode === "register" && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (new TextEncoder().encode(password).length > 128) {
      setError("密码最多 128 字节，请缩短后重试");
      return;
    }
    setBusy(true);
    try {
      const user = await authenticate(mode, username, password);
      setSession({ kind: "member", user });
      setDisplayName(user.display_name);
      setPassword("");
      setConfirm("");
      setNotice(
        mode === "register"
          ? "账号创建成功，欢迎来到 BakaFactory。"
          : "登录成功，欢迎回来。",
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const user = await updateProfile(displayName);
      setSession({ kind: "member", user });
      setDisplayName(user.display_name);
      setNotice("昵称已保存，刷新页面或重新登录后仍会保留。");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession({ kind: "guest" });
        setMode("login");
      }
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await logout();
      setSession({ kind: "guest" });
      setMode("login");
      setPassword("");
      setConfirm("");
      setNotice("已安全登出。");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const member = session.kind === "member";
  return (
    <section
      className={`account-card ${member ? "is-member" : session.kind === "loading" ? "is-session-loading" : "is-guest"}`}
      aria-label="账号中心"
    >
      <div className="account-heading">
        <span className="card-label">{member ? "玩家已接入" : "玩家接入"}</span>
        <span className="account-step">PLAYER ACCESS / 01</span>
      </div>
      {session.kind === "loading" ? (
        <div className="factory-loading" role="status">
          <span className="eyebrow">WORKSHOP / CONNECTING</span>
          <p>正在确认登录状态…</p>
        </div>
      ) : session.kind === "unavailable" ? (
        <div>
          <p role="alert">{session.message}</p>
          <button
            className="primary-button"
            onClick={() => {
              setSession({ kind: "loading" });
              setReload((value) => value + 1);
            }}
          >
            重试连接
          </button>
        </div>
      ) : member ? (
        <>
          <div className="member-heading">
            <div className="avatar" aria-hidden="true">
              {[...session.user.display_name][0]?.toUpperCase()}
            </div>
            <div>
              <span className="pilot-label">OPERATOR / ONLINE</span>
              <h2 title={session.user.display_name}>
                欢迎，{session.user.display_name}
              </h2>
              <p className="username-label">@{session.user.username}</p>
            </div>
            <HudPopover className="profile-settings" label="玩家档案">
              <div className="profile-footer">
                <span className="eyebrow">PLAYER PROFILE</span>
                <p className="profile-identity">@{session.user.username}</p>
                <form
                  onSubmit={(event) => void save(event)}
                  className="profile-form"
                >
                  <label htmlFor="display-name">
                    昵称
                    <input
                      id="display-name"
                      name="display_name"
                      autoComplete="nickname"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={32}
                      required
                      disabled={busy}
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      !displayName.trim() ||
                      displayName.trim() === session.user.display_name
                    }
                  >
                    {busy ? "处理中…" : "保存昵称"}
                  </button>
                </form>
                <p className="form-hint">
                  昵称支持中文，1～32 个字符。账号用户名保持不变。
                </p>
              </div>
            </HudPopover>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => void signOut()}
            >
              登出
            </button>
          </div>
          <FactoryWorkspace
            key={session.user.id}
            user={session.user}
            onSessionExpired={sessionExpired}
          />
        </>
      ) : (
        <>
          <div className="auth-tabs" role="group" aria-label="账号操作">
            <button
              aria-pressed={mode === "register"}
              disabled={busy}
              onClick={() => {
                setMode("register");
                setError("");
                setNotice("");
                setPassword("");
                setConfirm("");
              }}
            >
              创建账号
            </button>
            <button
              aria-pressed={mode === "login"}
              disabled={busy}
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
                setPassword("");
                setConfirm("");
              }}
            >
              登录
            </button>
          </div>
          <h2 className="auth-title">
            {mode === "register" ? "为你的工厂，留一个位置。" : "该继续工作了"}
          </h2>
          <p className="auth-description">
            {mode === "register"
              ? "数据会保存至 Baka 的服务器中"
              : "接回你的生产线，让霓虹继续亮起。"}
          </p>
          <form onSubmit={(event) => void submit(event)} className="auth-form">
            <label htmlFor="username">
              用户名
              <input
                id="username"
                name="username"
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                pattern="[a-zA-Z0-9_]{3,24}"
                minLength={3}
                maxLength={24}
                placeholder="例如 factory_builder"
                required
                disabled={busy}
              />
            </label>
            <p className="form-hint">
              3～24 位字母、数字或下划线，登录不区分大小写。
            </p>
            <div className="password-fields">
              <label htmlFor="password">
                密码
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  placeholder="至少 8 个字符"
                  required
                  disabled={busy}
                />
              </label>
              {mode === "register" && (
                <label htmlFor="confirm-password">
                  确认密码
                  <input
                    id="confirm-password"
                    name="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    minLength={8}
                    maxLength={128}
                    placeholder="再次输入密码"
                    required
                    disabled={busy}
                  />
                </label>
              )}
            </div>
            <button className="primary-button submit-button" disabled={busy}>
              {busy
                ? "处理中…"
                : mode === "register"
                  ? "创建账号并进入"
                  : "登录并继续游戏"}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="auth-footnote">
            无需邮箱。创建你的身份，接通第一条生产线。
          </p>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
