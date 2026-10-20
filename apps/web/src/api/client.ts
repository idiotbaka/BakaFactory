import createClient from "openapi-fetch";
import type { paths, components } from "./schema";
const client = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "same-origin",
});
export type Health = components["schemas"]["Health"];
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const { data, error } = await client.GET("/health", { signal });
  if (error)
    throw new Error(`${error.error.message} · 请求 ${error.error.request_id}`);
  if (
    !data ||
    data.status !== "ok" ||
    data.database !== "ok" ||
    typeof data.version !== "string" ||
    !["local", "test", "production"].includes(data.environment)
  ) {
    throw new Error("服务器返回了无效的状态数据");
  }
  return data;
}

export type User = components["schemas"]["User"];
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
function failure(
  status: number,
  error?: components["schemas"]["ErrorResponse"],
): never {
  throw new ApiError(
    status,
    error?.error?.message ?? "服务暂时不可用，请稍后再试",
  );
}
export async function getCurrentUser(
  signal?: AbortSignal,
): Promise<User | null> {
  const { data, error, response } = await client.GET("/api/v1/me", { signal });
  if (response.status === 401) return null;
  if (!data) failure(response.status, error);
  return data.user;
}
export async function authenticate(
  mode: "register" | "login",
  username: string,
  password: string,
): Promise<User> {
  const options = {
    body: { username, password },
    signal: AbortSignal.timeout(10000),
  };
  const { data, error, response } =
    mode === "register"
      ? await client.POST("/api/v1/auth/register", options)
      : await client.POST("/api/v1/auth/login", options);
  if (!data) failure(response.status, error);
  return data.user;
}
export async function logout(): Promise<void> {
  const { error, response } = await client.POST("/api/v1/auth/logout", {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) failure(response.status, error);
}
export async function updateProfile(display_name: string): Promise<User> {
  const { data, error, response } = await client.PATCH("/api/v1/me/profile", {
    body: { display_name },
    signal: AbortSignal.timeout(10000),
  });
  if (!data) failure(response.status, error);
  return data.user;
}

export type Factory = components["schemas"]["Factory"];
export type FactoryDetail = components["schemas"]["FactoryDetail"];
export type Catalog = components["schemas"]["Catalog"];
export type Definition = components["schemas"]["Definition"];
export type BuildingDefinition = components["schemas"]["BuildingDefinition"];
export type BuildingInstance = components["schemas"]["BuildingInstance"];
export type BuildingPlacement = components["schemas"]["BuildingPlacement"];
export type MachineState = components["schemas"]["MachineState"];
export type Simulation = components["schemas"]["Simulation"];
export type ItemTransfer = components["schemas"]["ItemTransfer"];
export type TransferEndpoint = components["schemas"]["TransferEndpoint"];
export async function getCatalog(signal?: AbortSignal): Promise<Catalog> {
  const { data, error, response } = await client.GET("/api/v1/definitions", {
    signal,
  });
  if (!data) failure(response.status, error);
  return data;
}
export async function gameHeartbeat(sessionID: string, signal?: AbortSignal) {
  const { data, error, response } = await client.POST(
    "/api/v1/game/heartbeat",
    {
      body: { session_id: sessionID },
      signal,
    },
  );
  if (!data) failure(response.status, error);
  return data;
}
export async function downloadSave(sessionID: string, signal?: AbortSignal) {
  const { data, error, response } = await client.GET("/api/v1/game/save", {
    params: { header: { "X-Game-Session": sessionID } },
    signal,
  });
  if (!data) failure(response.status, error);
  return data.backup;
}
export async function uploadSave(
  sessionID: string,
  baseVersion: number,
  save: components["schemas"]["GameSave"],
  signal?: AbortSignal,
) {
  const { data, error, response } = await client.PUT("/api/v1/game/save", {
    params: { header: { "X-Game-Session": sessionID } },
    body: { base_version: baseVersion, save },
    signal,
  });
  if (!data || !data.backup) failure(response.status, error);
  return data.backup;
}
