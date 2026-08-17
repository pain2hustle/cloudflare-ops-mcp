# AMH WT knowledge vault

This Git-tracked directory is secondary safekeeping for approved, tested, and redacted agent knowledge only.

Store entries under:

```text
<site>/<YYYY-MM-DD_HH-mm-ssZ>_<type>.json
```

Allowed content:

- approved template and capability revisions;
- redacted release/deployment manifests;
- test and verification receipts;
- compact lessons that contain no user data or secrets.

Never store OAuth records, connector/API keys, cookies, raw crawl bodies, client IPs, private job context, unredacted logs, or database contents here. Candidate revisions remain in the Durable Object until reviewed. A Git commit or pull request is a separate master-approved promotion step.
