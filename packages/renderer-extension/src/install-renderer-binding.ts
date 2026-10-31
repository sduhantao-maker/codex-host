import { type RendererAgent } from "./agent-selection-state.js";
import {
  installRendererBindingProbe,
  type RendererBindingProbeApi,
} from "./renderer-binding-probe.js";
import { installCurrentRendererAdapter } from "./versioned-renderer-adapter.js";
import { installRendererSideChatControls } from "./renderer-sidechat-controls.js";

export function installRendererBinding(
  enabledAgents?: readonly RendererAgent[],
): RendererBindingProbeApi {
  window.__codexhostRendererBindingProbeV1?.dispose();
  const binding = installRendererBindingProbe({ ...(enabledAgents ? { enabledAgents } : {}) });
  const sideChats = installRendererSideChatControls(
    document,
    () => window.__codexhostHostRoutingV1,
  );
  const disposeBinding = binding.dispose.bind(binding);
  binding.dispose = () => {
    sideChats.dispose();
    disposeBinding();
  };
  try {
    const adapter = installCurrentRendererAdapter();
    binding.setAdapter(adapter.status, adapter.dispose, adapter.applyAgent, adapter.modelControl);
  } catch (error) {
    console.error(
      "codexhost Renderer Adapter installation failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    binding.setAdapter({
      state: "unsupported",
      reason: "installation-failed",
      modelUpdates: 0,
      hook: null,
    });
  }
  return binding;
}
