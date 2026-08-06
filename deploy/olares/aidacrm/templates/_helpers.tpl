{{- define "aidacrm.labels" -}}
app.kubernetes.io/name: aidacrm
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: aidacrm
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{- define "aidacrm.fullname" -}}
{{- .Release.Name -}}
{{- end }}
