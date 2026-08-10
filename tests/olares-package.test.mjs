import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const version = "1.0.19";
const chartRoot = new URL("../deploy/olares/aidacrm/", import.meta.url);

test("all app and Olares package version surfaces are aligned", async () => {
  const [packageJson, packageLock, chart, manifest, dockerfile] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("Chart.yaml", chartRoot), "utf8"),
    readFile(new URL("OlaresManifest.yaml", chartRoot), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(packageJson).version, version);
  assert.equal(JSON.parse(packageLock).version, version);
  assert.match(chart, new RegExp(`^version: ${version.replaceAll(".", "\\.")}$`, "m"));
  assert.match(chart, new RegExp(`^appVersion: ${version.replaceAll(".", "\\.")}$`, "m"));
  assert.match(manifest, new RegExp(`^  version: '${version.replaceAll(".", "\\.")}'$`, "m"));
  assert.match(manifest, new RegExp(`^  versionName: '${version.replaceAll(".", "\\.")}'$`, "m"));
  assert.match(dockerfile, new RegExp(`^ARG VERSION=${version.replaceAll(".", "\\.")}$`, "m"));
});

test("Marketplace scanners can resolve the immutable runtime image", async () => {
  const [values, chart, deployment, workflow] = await Promise.all([
    readFile(new URL("values.yaml", chartRoot), "utf8"),
    readFile(new URL("Chart.yaml", chartRoot), "utf8"),
    readFile(new URL("templates/app.yaml", chartRoot), "utf8"),
    readFile(new URL("../.github/workflows/deliver.yml", import.meta.url), "utf8"),
  ]);

  assert.match(values, /^  repository: ghcr\.io\/rmacek\/aida-academy-mini-crm$/m);
  assert.match(values, new RegExp(`^  tag: ${version.replaceAll(".", "\\.")}$`, "m"));
  assert.match(
    chart,
    /^  aida\.iqxgroup\.io\/image-repository: ghcr\.io\/rmacek\/aida-academy-mini-crm$/m,
  );
  assert.match(
    deployment,
    /required "[^"\n]+" \(index \.Chart\.Annotations "aida\.iqxgroup\.io\/image-repository"\)/,
  );
  assert.match(
    deployment,
    /image: "\{\{ \$imageRepository \}\}:\{\{ \.Chart\.AppVersion \}\}"/,
  );
  assert.doesNotMatch(
    deployment,
    /image:\s*"[^"\n]*\.Values\.image\.repository[^"\n]*"/,
  );

  const chartAnnotationRewrite =
    'sed -i "s|^  aida\\.iqxgroup\\.io/image-repository: .*|  aida.iqxgroup.io/image-repository: $image_repository|" deploy/olares/aidacrm/Chart.yaml';
  const helmPackage = "helm package deploy/olares/aidacrm --destination delivery";
  const chartAnnotationRewriteIndex = workflow.indexOf(chartAnnotationRewrite);
  const helmPackageIndex = workflow.indexOf(helmPackage);

  assert.notEqual(chartAnnotationRewriteIndex, -1);
  assert.notEqual(helmPackageIndex, -1);
  assert.ok(chartAnnotationRewriteIndex < helmPackageIndex);
});

test("allows asynchronous HTTPS AIDA jobs and database egress only", async () => {
  const [networkPolicy, manifest] = await Promise.all([
    readFile(new URL("templates/network-policy.yaml", chartRoot), "utf8"),
    readFile(new URL("OlaresManifest.yaml", chartRoot), "utf8"),
  ]);

  assert.match(networkPolicy, /port: 443\n/);
  assert.match(networkPolicy, /port: 5432\n/);
  assert.doesNotMatch(networkPolicy, /port: 80\n/);
  assert.doesNotMatch(networkPolicy, /port: 8080\n/);
  assert.match(manifest, /^  apiTimeout: 0$/m);
  assert.match(manifest, /regex: '\^https:\/\/\[\^\?\#\]\+\$'/);
});
