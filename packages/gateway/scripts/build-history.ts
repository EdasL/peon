import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const gatewayDir = resolve(import.meta.dir, "..");

async function main() {
  const result = await build({
    entryPoints: [
      resolve(gatewayDir, "src/routes/public/history-page/app.tsx"),
    ],
    bundle: true,
    minify: true,
    format: "esm",
    target: ["es2020"],
    write: false,
    jsx: "automatic",
    jsxImportSource: "preact",
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  });

  const js = result.outputFiles?.[0]?.text || "";

  // Escape for embedding in a JS template literal
  const escaped = js
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

  const output = `/**
 * Auto-generated Preact bundle for the history page.
 * DO NOT EDIT — regenerated on every build.
 */
export const historyPageJS = \`${escaped}\`;
`;

  writeFileSync(
    resolve(gatewayDir, "src/routes/public/history-page-bundle.ts"),
    output
  );
  console.log("History page JS bundle generated");
}

main().catch((err) => {
  console.error("Failed to build history page:", err);
  process.exit(1);
});
