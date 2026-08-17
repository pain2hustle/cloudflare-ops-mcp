# Terms of Use

Effective: August 17, 2026

These terms cover the open-source Cloudflare Ops MCP project and the hosted connector at `cfops.nothingunseen.com`. The project is made by AMH — Artificial Mind Hive and operated by Service Pricer LLC.

## Open-source code

The repository code is licensed under the [MIT License](LICENSE). The MIT License governs copying, modification, distribution, and use of the code. These Terms govern use of the optional hosted service and related project surfaces.

## Your authority and responsibility

You may connect or change only Cloudflare accounts, zones, domains, Workers, Pages projects, and other resources you own or are authorized to manage. You are responsible for:

- choosing least-privilege Cloudflare permissions;
- protecting API tokens, OAuth grants, and connector keys;
- reviewing dry-run plans and diffs before approval;
- verifying DNS, email, cache, Pages, Turnstile, and Worker changes;
- maintaining appropriate backups, deployment versions, and recovery procedures;
- complying with law and third-party agreements.

An AI-generated plan is not a substitute for operator review. Do not approve a change you do not understand.

## Safety boundaries

Mutation tools are designed to be dry-run by default and require an explicit apply instruction. You must not bypass authorization, isolation, confirmation, rate-limit, audit, or safety controls. Do not use the service to access another person's account, disrupt systems, distribute malware, conceal abuse, or perform unlawful activity.

## Hosted connector

Hosted access is provided as an evolving convenience and may be limited, changed, suspended, or discontinued. A `cfops_` connector key is confidential and may be revoked if compromised, abused, or required to protect users or the service. The operator may deploy security fixes that change an endpoint, scope, tool, or workflow.

## Third-party services

Cloudflare, GitHub, and your selected MCP/AI client are independent third parties with their own terms, availability, and data practices. Cloudflare Ops MCP is an unofficial project and is not affiliated with, endorsed by, sponsored by, or made by Cloudflare, Inc.

## No professional advice

Outputs are technical automation assistance, not legal, security, compliance, deliverability, financial, or other professional advice. DNS and email-policy changes can interrupt websites or mail. Cache and deployment changes can affect production traffic.

## Disclaimer

TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SOFTWARE AND HOSTED SERVICE ARE PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND. THE OPERATOR DOES NOT WARRANT THAT OUTPUTS WILL BE COMPLETE, ERROR-FREE, SECURE, OR SUITABLE FOR A PARTICULAR PURPOSE.

## Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, AMH, SERVICE PRICER LLC, CONTRIBUTORS, AND MAINTAINERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST DATA, REVENUE, PROFITS, EMAIL, TRAFFIC, OR BUSINESS INTERRUPTION ARISING FROM USE OF THE PROJECT OR HOSTED SERVICE.

Some jurisdictions do not allow every disclaimer or limitation, so portions of these sections may not apply to you.

## Termination and changes

You may stop using the project at any time and revoke the connector in Cloudflare. Access may be suspended for abuse, security risk, legal requirements, or service protection. Material term changes will be committed to this file with a new effective date. Continued hosted-service use after a change means you accept the updated terms.

## Contact

Questions may be directed through [servicepricer.app](https://servicepricer.app) or a GitHub issue that contains no credentials or private account data.

This is a practical open-source service policy and is not a substitute for review by qualified counsel.
