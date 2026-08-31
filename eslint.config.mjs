import nextPlugin from "eslint-config-next";

const config = [
  ...nextPlugin,
  {
    ignores: ["node_modules/**", ".next/**"],
  },
];

export default config;
