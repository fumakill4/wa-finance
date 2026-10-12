# Security review — 2026-10-13

Prepared by i729. This review records tested source changes; it is not a certification of the deployed service.

## Change

Require verified Firebase identity in every environment, validate session identifiers, compare internal tokens in constant time, require per-account Apps Script secrets and fixed spreadsheet ownership, and allow Apps Script requests only to Google endpoints with checked redirects. Remove owner names, workstation paths and private network details from current documentation.

## Validation

Authentication, path, SSRF and Apps Script anonymous/cross-user command tests passed; backend JavaScript syntax checks passed; frontend production build passed.

## Dependency audit

Counts refer to package findings across the complete locked dependency tree, including tooling; they are not counts of distinct exploitable production vulnerabilities.

| Package project | Before | After | Remaining critical | Remaining high |
| --- | ---: | ---: | ---: | ---: |
| wa-finance/Vault/frontend | 40 | 15 | 0 | 11 |
| wa-finance/Vault/backend | 18 | 9 | 0 | 3 |

## Required before rollout

Deploy the gateway changes through the existing controlled server workflow. Previously saved non-Google endpoints will be rejected. Configure private APPS_SCRIPT_AUTH_CONFIG as a map from verified Firebase UID to its exact endpoint and unique secret (at least 32 characters). Set matching GATEWAY_SECRET, GATEWAY_USER_ID and SPREADSHEET_ID in that Apps Script project; deploy both sides together. No authentication secret belongs in browser configuration or a public repository. The SQL expense routes scope records by authenticated user; Firestore users/{uid} rules were already owner-scoped. Review deployed rules, backups, logs and old Git history separately.

## Scope

Source and locally fetched Git branches/tags/available pull-request heads were inspected. Private production settings, actual database policies, deployed binaries, backup stores, and third-party service permissions were not changed. Current-source cleanup does not remove data from Git history, existing forks, cached copies, or previously downloaded assets. Sensitive values are intentionally omitted.
