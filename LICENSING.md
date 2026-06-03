# Licensing

Copyright (C) 2026 David Magyar

Dishton is **open source under the [GNU AGPL-3.0](./LICENSE)**, with a separate
commercial license available on request. This page explains what that means in
plain terms — the [`LICENSE`](./LICENSE) file is the legally binding text.

## TL;DR

| You want to… | What applies | Cost |
|---|---|---|
| Read, study, fork, or self-host Dishton for yourself | AGPL-3.0 | Free |
| Self-host a **modified** version that other people use over a network | AGPL-3.0 — you must publish your source changes | Free |
| Run a closed-source / proprietary hosted service based on Dishton | Commercial license required | Contact us |
| Just use the product without running servers | Use the hosted version at *(coming soon)* | Free tier + paid plan |

## Why AGPL-3.0

The AGPL is a strong copyleft license. The key clause (section 13) is the
"network use" provision: if you run a **modified** version of Dishton as a
network service, you must make your modified source available to the users of
that service.

We chose it deliberately:

- **Individuals and self-hosters are fully free.** Clone it, run it on your own
  box, modify it for your household — no strings, no fee.
- **Contributors are protected.** Improvements to the public project stay
  public; nobody can take the code, improve it privately, and run a closed
  competing hosted service off the back of the community's work.
- **It keeps the project honest.** The hosted Dishton service and the open
  source code stay in sync, because the same copyleft applies to us too.

If you only want to *use* Dishton, you never need to think about any of this —
just use the hosted app or self-host. The license only constrains people who
**redistribute or run a modified service**.

## What the AGPL requires of you

If you distribute Dishton or run a modified version as a network service, you
must, broadly:

1. Keep it under AGPL-3.0 (or a compatible license).
2. Make the **complete corresponding source** of your version available to its
   users — including your modifications.
3. Preserve the copyright and license notices.

This is a summary, not legal advice — read [`LICENSE`](./LICENSE) for the
authoritative terms.

## Commercial / proprietary license

The AGPL's copyleft is incompatible with some commercial uses — for example,
running a closed-source hosted product built on Dishton, or embedding it in a
proprietary application you don't want to open-source.

For those cases a **separate commercial license** is available that removes the
AGPL obligations. It is negotiated per use case rather than sold off a price
list. To enquire, email **david.magyar0@gmail.com** with a short description of
your intended use.

## The hosted service

The maintainers operate a hosted version of Dishton (the managed
AI-powered recipe import runs server-side, so you never need an API key). The
hosted service is the recommended way to use Dishton for most people and is
where paid plans (e.g. unlimited AI imports) live. The hosted product and this
open source repository are licensed separately: **the code is AGPL-3.0; using
the hosted service is governed by its own terms of service**, not this license.

## Contributions

Unless stated otherwise, contributions you submit are accepted under the
AGPL-3.0 license of the project. If a contributor license agreement (CLA)
becomes necessary to support the dual-licensing model above, it will be
documented in `CONTRIBUTING.md` before being required.

## Questions

Open an issue or email **david.magyar0@gmail.com**.
