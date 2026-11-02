export { readRuntimeMetadata } from "./runtime-metadata.js";
export type {
  ArtifactDownloadProgress,
  ArtifactDownloader,
  ArtifactDownloadResult,
  ArtifactSource,
} from "./artifact.js";
export {
  UPDATE_RUNTIME_ENV,
  defaultUpdateStateDirectory,
  parseDistributionMetadata,
  resolveInstalledUpdateContext,
  type DistributionMetadata,
  type InstalledUpdateContext,
} from "./distribution.js";
export {
  CODEXHOST_LATEST_RELEASE_URL,
  compareSemanticVersions,
  expectedInstallerAssetName,
  fetchLatestGitHubRelease,
  parseLatestGitHubRelease,
  selectInstallerReleaseArtifact,
  type CodexhostLatestRelease,
  type CodexhostReleaseAsset,
  type GitHubReleaseFetchOptions,
  type InstallerReleaseTarget,
  type SelectedReleaseArtifact,
} from "./github-release.js";
export {
  fetchLatestGitHubReleaseWithGitHubCli,
  type GitHubCliReleaseFetchOptions,
  type GitHubCliRunner,
} from "./github-cli-release.js";
export {
  acquireUpdateOperationLock,
  cleanupTerminalUpdateState,
  discoverActiveUpdateStatus,
  discoverLatestUpdateStatus,
  isUpdateOperationActive,
  recoverUpdateOperationLock,
  type DiscoveredUpdateStatus,
  type UpdateOperationLock,
} from "./operation-state.js";
export type {
  BackgroundUpdateInstallation,
  BackgroundUpdatePhase,
  BackgroundUpdateStatus,
} from "./status.js";
export {
  createBackgroundUpdateManager,
  type BackgroundUpdateManager,
  type BackgroundUpdateManagerDependencies,
  type CommonUpdateOptions,
  type MacOsDmgUpdateOptions,
  type NpmUpdateOptions,
  type PreparedBackgroundUpdate,
  type PreparedUpdateInfo,
  type StartedBackgroundUpdate,
  type WindowsInstallerUpdateOptions,
} from "./update-manager.js";

export const packageMetadata = {
  name: "@codexhost/update-manager",
} as const;

// Official installers would replace this fork's side-chat changes.
export const UPDATE_INSTALLATION_DISABLED_REASON: string | null =
  "This personal build uses controlled upgrades. Merge and validate upstream changes in sduhantao-maker/codex-host, then install your own build.";
