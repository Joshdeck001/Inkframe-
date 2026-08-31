import nextPlugin from "eslint-config-next";

export default [
  ...nextPlugin,
  {
    ignores: ["node_modules/**", ".next/**"],
  },
];
