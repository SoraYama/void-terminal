import "server-only";
import type { DeploymentMode } from "../deployment";
import { AppError } from "./errors";

/** Read at request time so one image can serve either deployment profile. */
export function deploymentMode(): DeploymentMode {
  const mode = process.env.DEPLOYMENT_MODE;
  if (mode === undefined) return "self-hosted";
  if (mode === "self-hosted" || mode === "hosted") return mode;
  throw new AppError(
    "DEPLOYMENT_CONFIG",
    "The deployment mode is not configured correctly.",
    503,
  );
}

/** Enforce the server profile before credentials, account admission or provider work. */
export function assertRequestMode(mode: "byok" | "shared"): void {
  const deployment = deploymentMode();
  if ((deployment === "hosted" && mode !== "shared") ||
      (deployment === "self-hosted" && mode !== "byok")) {
    throw new AppError(
      "MODE_NOT_ALLOWED",
      "This request mode is not available on this deployment.",
      403,
    );
  }
}
