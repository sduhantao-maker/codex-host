declare const __CODEXHOST_PERSONAL_BUILD_VERSION__: string | undefined;

/** Display identity only; update comparisons continue to use the Host's semantic version. */
export const PERSONAL_BUILD_VERSION =
  typeof __CODEXHOST_PERSONAL_BUILD_VERSION__ === "string"
    ? __CODEXHOST_PERSONAL_BUILD_VERSION__
    : null;
