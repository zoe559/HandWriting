# Security

This project is designed to run **locally**:

- The Node server binds to `127.0.0.1` by default.
- There is **no authentication**.
- It reads and writes local files under `submissions/` and `feedback/`.
- Handwriting pages can contain personal information.

## Do not expose it publicly

Do **not** bind it to `0.0.0.0` or put it behind a public URL without adding
authentication, HTTPS, access control and rate limiting. Anyone who can reach
the server can submit pages and read existing submissions/reports.

## Never commit user data

`submissions/`, `feedback/`, `tmp/` and `.port` are ignored by `.gitignore`.
Do not force-add them. If they were committed, treat the handwriting/report
data as exposed and rewrite the repository history.

## Reporting

For security issues in this repository, open a GitHub issue (without posting
personal handwriting or reports) or contact the maintainer privately.
