{{- define "aidacrm.labels" -}}
app.kubernetes.io/name: aidacrm
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: aidacrm
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "aidacrm.fullname" -}}
{{ .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
