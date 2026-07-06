# Tools / automation

Define automation commands here. When the user asks for one of these actions and
shares the relevant vulnerability data, follow the described procedure and produce
the requested output (a command, a query, a ticket body, etc.).

These entries are **instructions for you**, the agent. The extension does not
execute anything on its own — it only passes the vulnerability context and your
reply back to the user.

## triage

When asked to "triage", produce a short risk verdict for the vulnerability in
context:

- Severity + CVSS
- Is it known-exploited / has a public exploit?
- Suggested priority: P1 / P2 / P3
- One-line justification.

## remediation

When asked for "remediation", output an ordered, copy-pasteable remediation plan
for the affected platform, plus a verification check.

## ticket

When asked to "open a ticket" / "write a ticket", output a ready-to-paste ticket
with: title, affected assets, description, remediation, and priority.
