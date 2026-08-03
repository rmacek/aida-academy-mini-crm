# AIDA Academy Mini-CRM

Workshop-Anwendung für isolierte AIDA-Verkaufschancen. Sie verwaltet Termine,
Aufgaben, Notizen, Dokumente, mehrere Unterhaltungen und daraus entstandene
Artefakte. Der serverseitige Copilot übergibt immer nur den Snapshot der gerade
geöffneten Verkaufschance an die tenantgebundene AIDA-API.

## Technische Leitplanken

- Private Sites-Anwendung mit benutzergebundenen Daten in D1.
- Dokumente in R2; Metadaten und Eigentümerprüfung in D1.
- AIDA-Zugangstoken ausschließlich als serverseitiges Sites-Secret.
- Lokale Modellverarbeitung wird verlangt (`cloudProcessingConfirmed=false`).
- Synthetische Workshop-Daten mit zwei unterschiedlichen Kontextmarkern.
- Keine CRM-Fachlogik in AIDA selbst.

## Lokal prüfen

Voraussetzung ist Node.js `>=22.13.0`. Für einen lokalen UI-Lauf `.dev.vars.example`
nach `.dev.vars` kopieren und den Service-Account-Token ausschließlich dort
eintragen. `.dev.vars` wird nicht versioniert.

```bash
npm install
npm run db:generate
npm run lint
npm test
npm run dev
```

## Laufzeitvariablen

| Name | Zweck |
| --- | --- |
| `AIDA_API_BASE_URL` | Basis-URL der AIDA-Instanz |
| `AIDA_SERVICE_TOKEN` | Tenantgebundener Service-Account-Token (Secret) |
| `AIDA_MODEL_PROFILE_NAME` | Exakter Name des freigegebenen Modellprofils |
| `ACADEMY_DEMO_MODE` | Nur lokal auf `local` setzen; nie in Produktion |

Die Sites-Bindings `DB` und `DOCUMENTS` sind in `.openai/hosting.json`
deklariert. Schemaänderungen werden über `npm run db:generate` nachvollziehbar
unter `drizzle/` abgelegt.
