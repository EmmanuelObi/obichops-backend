import * as esbuild from "esbuild";
import { cp, mkdir, writeFile } from "node:fs/promises";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "@codegenie/serverless-express",
  ],
  logLevel: "info",
};

const entries = [
  { in: "src/lambda.ts", out: "dist/lambda" },
  { in: "src/cron/handler.ts", out: "dist/cron/handler" },
];

await mkdir("dist", { recursive: true });

for (const { in: entry, out } of entries) {
  await esbuild.build({
    ...shared,
    entryPoints: [entry],
    outfile: `${out}.js`,
  });
  console.log(`Built ${out}.js`);
}

// pdfkit reads standard-font metrics from disk at runtime (__dirname + "/data/*.afm").
// esbuild bundles the JS but not those files — copy them beside the Lambda bundle.
await cp("node_modules/pdfkit/js/data", "dist/data", { recursive: true });
console.log("Copied pdfkit font metrics to dist/data");

// Root package.json has "type":"module" — without this, Lambda treats dist/*.js as ESM
// and module.exports is ignored (empty handler, "Dynamic require" errors).
await writeFile(
  "dist/package.json",
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);
