import { InferenceMode, InferenceProvider } from "../core/types.js";
import { HybridInferenceProvider } from "./realInferenceProvider.js";

export function createInferenceProvider(mode: InferenceMode): InferenceProvider {
  return new HybridInferenceProvider(mode);
}
