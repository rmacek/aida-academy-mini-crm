import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const version = "1.0.19";
const chartRoot = new URL("../deploy/olares/aidacrm/", import.meta.url);

const [app, serviceAccount, networkPolicy, runtimeSecret, manifest, chart, values, helpers] =
  await Promise.all([
    readFile(new URL("templates/app.yaml", chartRoot), "utf8"),
    readFile(new URL("templates/service-account.yaml", chartRoot), "utf8"),
    readFile(new URL("templates/network-policy.yaml", chartRoot), "utf8"),
    readFile(new URL("templates/runtime-secret.yaml", chartRoot), "utf8"),
    readFile(new URL("OlaresManifest.yaml", chartRoot), "utf8"),
    readFile(new URL("Chart.yaml", chartRoot), "utf8"),
    readFile(new URL("values.yaml", chartRoot), "utf8"),
    readFile(new URL("templates/_helpers.tpl", chartRoot), "utf8"),
  ]);

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source section start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source section end: ${endNeedle}`);
  return source.slice(start, end);
}

function manifestEnvironmentBlock(name) {
  const startNeedle = `  - envName: ${name}`;
  const start = manifest.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing manifest environment variable: ${name}`);
  const nextEnvironment = manifest.indexOf("\n  - envName:", start + startNeedle.length);
  const options = manifest.indexOf("\noptions:", start + startNeedle.length);
  const candidates = [nextEnvironment, options].filter(index => index !== -1);
  assert.ok(candidates.length > 0, `Missing end of manifest environment block: ${name}`);
  return manifest.slice(start, Math.min(...candidates));
}

function runtimeSecretStringDataEntries() {
  const startNeedle = "stringData:\n";
  assert.equal(
    runtimeSecret.split(startNeedle).length - 1 === 1,
    true,
    "Unique runtime Secret stringData contract",
  );

  return runtimeSecret
    .slice(runtimeSecret.indexOf(startNeedle) + startNeedle.length)
    .trimEnd()
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => {
      const match = /^  ([A-Z0-9_]+): (.+)$/.exec(line);
      assert.equal(Boolean(match), true, "Valid runtime Secret stringData contract");
      return { name: match[1], value: match[2] };
    });
}

test("pod and ServiceAccount disable API token automount", () => {
  assert.equal(
    /serviceAccountName: \{\{ include "aidacrm\.fullname" \. \}\}\n      automountServiceAccountToken: false/.test(app),
    true,
    "Pod service account token automount contract",
  );
  assert.equal(
    /^kind: ServiceAccount[\s\S]*^automountServiceAccountToken: false$/m.test(serviceAccount),
    true,
    "ServiceAccount token automount contract",
  );
});

test("workload names, selectors, and runtime Secret are release scoped", () => {
  assert.equal(/^  name: \{\{ include "aidacrm\.fullname" \. \}\}$/m.test(app), true, "Workload release-scoped name contract");
  assert.equal(/^  namespace: \{\{ \.Release\.Namespace \}\}$/m.test(app), true, "Workload release namespace contract");
  assert.equal(/^      app\.kubernetes\.io\/instance: \{\{ \.Release\.Name \}\}$/m.test(app), true, "Workload release instance contract");
  assert.equal(/^  name: \{\{ include "aidacrm\.fullname" \. \}\}$/m.test(serviceAccount), true, "ServiceAccount release-scoped name contract");
  assert.equal(/name: \{\{ printf "%s-default-deny" \(include "aidacrm\.fullname" \.\) \}\}/.test(networkPolicy), true, "NetworkPolicy release-scoped name contract");
  assert.equal(/^      app\.kubernetes\.io\/instance: \{\{ \.Release\.Name \}\}$/m.test(networkPolicy), true, "NetworkPolicy release instance contract");
  assert.equal(
    /name: \{\{ printf "%s-runtime" \(include "aidacrm\.fullname" \.\) \}\}/.test(runtimeSecret),
    true,
    "Runtime Secret release-scoped name contract",
  );
  assert.equal(
    /secretRef:\n                name: \{\{ printf "%s-runtime" \(include "aidacrm\.fullname" \.\) \}\}/.test(app),
    true,
    "Workload runtime Secret reference contract",
  );
});

test("Helm helpers bound release names and include complete standard labels", () => {
  for (const name of ["aidacrm.labels", "aidacrm.fullname"]) {
    const definition = `{{- define "${name}" -}}`;
    assert.equal(
      helpers.split(definition).length - 1,
      1,
      `Unique Helm helper definition contract: ${name}`,
    );
  }

  const labels = section(
    helpers,
    '{{- define "aidacrm.labels" -}}\n',
    "\n{{- end }}",
  );
  assert.equal(
    labels ===
      `{{- define "aidacrm.labels" -}}
app.kubernetes.io/name: aidacrm
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: aidacrm
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}`,
    true,
    "Standard Helm labels helper contract",
  );

  const fullname = section(
    helpers,
    '{{- define "aidacrm.fullname" -}}\n',
    "\n{{- end }}",
  );
  assert.equal(
    fullname ===
      `{{- define "aidacrm.fullname" -}}
{{ .Release.Name | trunc 63 | trimSuffix "-" }}`,
    true,
    "DNS-safe Helm fullname helper contract",
  );
});

test("internal application ingress is same-namespace TCP/3000 only", () => {
  const ingress = section(networkPolicy, "  ingress:\n", "  egress:\n");

  assert.equal(
    /# Public ingress is HTTPS\/443 only and terminates before this pod; internal traffic reaches TCP\/3000\./.test(ingress),
    true,
    "Ingress boundary documentation contract",
  );
  assert.equal(
    /- from:\n        - podSelector: \{\}\n      ports:\n        - protocol: TCP\n          port: 3000/.test(ingress),
    true,
    "Ingress source and port contract",
  );
  assert.equal(/namespaceSelector:/.test(ingress), false, "Ingress namespace selector exclusion contract");
  assert.equal(
    JSON.stringify([...ingress.matchAll(/^          port: (\d+)$/gm)].map(match => match[1])) === JSON.stringify(["3000"]),
    true,
    "Ingress port order contract",
  );
});

test("egress permits scoped DNS, same-namespace PostgreSQL, and external HTTPS only", () => {
  const egress = networkPolicy.slice(networkPolicy.indexOf("  egress:\n"));

  assert.equal(
    /namespaceSelector:\n            matchLabels:\n              kubernetes\.io\/metadata\.name: kube-system\n          podSelector:\n            matchLabels:\n              k8s-app: kube-dns/.test(egress),
    true,
    "Scoped DNS egress contract",
  );
  assert.equal(
    /- to:\n        - podSelector: \{\}\n      ports:\n        - protocol: TCP\n          port: 5432/.test(egress),
    true,
    "Same-namespace PostgreSQL egress contract",
  );
  assert.equal(
    /# Standard NetworkPolicy cannot select the runtime-configured AIDA FQDN\.\n    # Limit external egress to HTTPS and rely on the enforced HTTPS URL and tenant-scoped server token\./.test(egress),
    true,
    "External egress limitation documentation contract",
  );
  assert.equal(/- ports:\n        - protocol: TCP\n          port: 443\s*$/.test(egress), true, "External HTTPS egress contract");
  assert.equal(
    JSON.stringify([...egress.matchAll(/^          port: (\d+)$/gm)].map(match => match[1])) ===
      JSON.stringify(["53", "53", "5432", "443"]),
    true,
    "Egress port order contract",
  );
  assert.equal(/^          port: (?:80|3000|8080)$/m.test(egress), false, "Prohibited egress port exclusion contract");
});

test("runtime credentials are required tenant inputs without literal secret values", () => {
  const databaseNames = [
    "CRM_POSTGRES_HOST",
    "CRM_POSTGRES_PORT",
    "CRM_POSTGRES_DATABASE",
    "CRM_POSTGRES_USERNAME",
    "CRM_POSTGRES_PASSWORD",
  ];
  const credentialNames = ["CRM_BOOTSTRAP_ADMIN_PASSWORD", "AIDA_SERVICE_TOKEN"];
  const inputNames = [...databaseNames, ...credentialNames];
  const expectedRuntimeSecret = new Map([
    ["CRM_POSTGRES_HOST", "{{ .Values.postgres.host | quote }}"],
    ["CRM_POSTGRES_PORT", "{{ .Values.postgres.port | quote }}"],
    ["CRM_POSTGRES_DATABASE", "{{ .Values.postgres.databases.aidacrm | quote }}"],
    ["CRM_POSTGRES_USERNAME", "{{ .Values.postgres.username | quote }}"],
    ["CRM_POSTGRES_PASSWORD", "{{ .Values.postgres.password | quote }}"],
    [
      "CRM_BOOTSTRAP_ADMIN_PASSWORD",
      '{{ required "CRM_BOOTSTRAP_ADMIN_PASSWORD is required" .Values.olaresEnv.CRM_BOOTSTRAP_ADMIN_PASSWORD | quote }}',
    ],
    ["AIDA_SERVICE_TOKEN", '{{ required "AIDA_SERVICE_TOKEN is required" .Values.olaresEnv.AIDA_SERVICE_TOKEN | quote }}'],
  ]);
  const adminPassword = manifestEnvironmentBlock("CRM_BOOTSTRAP_ADMIN_PASSWORD");
  const serviceToken = manifestEnvironmentBlock("AIDA_SERVICE_TOKEN");

  for (const name of credentialNames) {
    assert.equal(
      manifest.split(`  - envName: ${name}`).length - 1 === 1,
      true,
      `Unique Olares password environment contract: ${name}`,
    );
  }
  for (const block of [adminPassword, serviceToken]) {
    assert.equal(/^    required: true$/m.test(block), true, "secret input must require a value");
    assert.equal(/^    type: password$/m.test(block), true, "secret input must use password type");
    assert.equal(/^    default:/m.test(block), false, "secret input must not define a default");
  }
  assert.deepEqual(
    credentialNames.filter(name => /^    type: password$/m.test(manifestEnvironmentBlock(name))),
    credentialNames,
  );
  const postgresMiddleware = section(manifest, "middleware:\n", "\nenvs:\n");
  assert.equal(
    /^  postgres:\n    username: aidacrm\n    databases:\n      - name: aidacrm\n        distributed: false$/m.test(postgresMiddleware),
    true,
    "PostgreSQL middleware contract",
  );
  assert.deepEqual(
    inputNames.filter(name => name.startsWith("CRM_POSTGRES_")),
    databaseNames,
  );
  assert.equal(/Tenantgebundener AIDA-Service-Account-Token/.test(serviceToken), true, "AIDA service token input must document tenant-bound purpose");

  const envFrom = section(app, "          envFrom:\n", "          env:\n");
  assert.equal(
    envFrom ===
      `          envFrom:
            - secretRef:
                name: {{ printf "%s-runtime" (include "aidacrm.fullname" .) }}
`,
    true,
    "Workload envFrom runtime Secret contract",
  );
  const runtimeSecretEntries = runtimeSecretStringDataEntries();
  assert.equal(
    runtimeSecretEntries.length === expectedRuntimeSecret.size,
    true,
    "Exact runtime Secret stringData contract",
  );
  for (const [name, expectedValue] of expectedRuntimeSecret) {
    const matches = runtimeSecretEntries.filter(entry => entry.name === name);
    assert.equal(
      matches.length === 1,
      true,
      `Unique runtime Secret stringData key contract: ${name}`,
    );
    assert.equal(
      matches[0]?.value === expectedValue,
      true,
      `Exact runtime Secret stringData value contract: ${name}`,
    );
  }
  assert.deepEqual(
    [...runtimeSecret.matchAll(/^  ([A-Z0-9_]+):/gm)].map(match => match[1]),
    inputNames,
  );
  for (const name of inputNames) {
    assert.equal(
      new RegExp(`^  ${name}: \\{\\{.+\\}\\}$`, "m").test(runtimeSecret),
      true,
      `Runtime Secret mapping must exist for ${name}`,
    );
  }
});

test("workload uses non-root, read-only, seccomp, and drop-all controls", () => {
  assert.equal(/^        runAsNonRoot: true$/m.test(app), true, "Non-root workload contract");
  assert.equal(/^        runAsUser: 10001$/m.test(app), true, "Workload user identity contract");
  assert.equal(/^        runAsGroup: 10001$/m.test(app), true, "Workload group identity contract");
  assert.equal(/seccompProfile:\n          type: RuntimeDefault/.test(app), true, "RuntimeDefault seccomp contract");
  assert.equal(/^            allowPrivilegeEscalation: false$/m.test(app), true, "Privilege escalation exclusion contract");
  assert.equal(/^            readOnlyRootFilesystem: true$/m.test(app), true, "Read-only root filesystem contract");
  assert.equal(/capabilities:\n              drop:\n                - ALL/.test(app), true, "Drop-all capabilities contract");
});

test("each installation uses a dedicated non-distributed PostgreSQL database", () => {
  assert.equal(
    /middleware:\n  postgres:\n    username: aidacrm\n    databases:\n      - name: aidacrm\n        distributed: false/.test(manifest),
    true,
    "Dedicated PostgreSQL database contract",
  );
  assert.equal(/Jede Installation besitzt eine eigene PostgreSQL-Datenbank\./.test(manifest), true, "Installation database isolation documentation contract");
  assert.equal(/^  allowMultipleInstall: true$/m.test(manifest), true, "Multiple installation contract");
});

test("deployment version surfaces are aligned to 1.0.19", () => {
  const escapedVersion = version.replaceAll(".", "\\.");

  assert.equal(new RegExp(`^version: ${escapedVersion}$`, "m").test(chart), true, "Chart version contract");
  assert.equal(new RegExp(`^appVersion: ${escapedVersion}$`, "m").test(chart), true, "Chart application version contract");
  assert.equal(new RegExp(`^  version: '${escapedVersion}'$`, "m").test(manifest), true, "Manifest version contract");
  assert.equal(new RegExp(`^  versionName: '${escapedVersion}'$`, "m").test(manifest), true, "Manifest version name contract");
  assert.equal(new RegExp(`^  tag: ${escapedVersion}$`, "m").test(values), true, "Runtime image tag contract");
});
