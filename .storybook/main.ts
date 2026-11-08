import type { StorybookConfig } from "@storybook/react-vite";

// Review surface only; picks up the project's vite.config.ts ("@" alias, tailwind).
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  staticDirs: ["../public"],
};
export default config;
