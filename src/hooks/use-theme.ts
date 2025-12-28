import { useOpenAiGlobal } from "./use-openai-global";
import { type Theme } from "./types";

export const useTheme = (): Theme | null => {
  return useOpenAiGlobal("theme");
};

