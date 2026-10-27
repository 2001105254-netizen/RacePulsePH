# RacePulse email delivery

Public DNS and the delivered Gmail messages were inspected on 27 October 2026.

## Findings

- Sender and return path: `events@racepulseph.com`, delivered through Google SMTP.
- SPF: passes; the domain publishes `v=spf1 include:_spf.google.com ~all`.
- DKIM: passes with the `google` selector and the `racepulseph.com` signing domain.
- DMARC: **missing**. `_dmarc.racepulseph.com` has no public TXT record.
- The domain's authoritative nameservers are Squarespace DNS.
- The original logo was present as a correctly referenced inline PNG in the
  delivered MIME message. A blocked image does not indicate a missing attachment.
- Gmail classified the two inspected messages as Spam even with SPF/DKIM passing.
  Its headers do not reveal the complete classification reason. Missing DMARC is
  a configuration gap; fixing it alone cannot guarantee Inbox placement.

## Required Squarespace DNS change

Add the following **new TXT record** in the DNS settings for `racepulseph.com`:

| Setting | Value |
| --- | --- |
| Type | TXT |
| Host / Name | `_dmarc` |
| Value | `v=DMARC1; p=none; adkim=r; aspf=r` |
| TTL | Provider default |

This is an initial monitoring policy. It does not request rejection or quarantine
of legitimate mail, and it does not change MX, SPF or DKIM. Check the live DNS
again immediately before adding it; if a DMARC record now exists, review and
update that record rather than adding a second one. After propagation, inspect a
newly delivered message for `dmarc=pass` aligned with `racepulseph.com`.

Publishing this record requires access to the Squarespace domain account; the
repository and SMTP app password cannot edit public DNS. No DNS change has been
made by the app or its setup scripts.

The domain-owner DNS update is deferred at the user's request. The app changes
and the Inbox correction do not publish DMARC or guarantee future Inbox placement.

## Implemented in the application

- The email header uses a verified HTTPS logo on the same domain, with explicit
  dimensions, readable alt text and a visible text wordmark. It remains branded
  when a mail client blocks images; it no longer depends on CID image resolution.
- Sender, SMTP envelope and Reply-To are aligned to the configured mailbox.
  Messages have matching plain-text/HTML content and identify automated mail.
- Both code screens prominently instruct recipients to check **Spam or Junk**
  and identify the sender. Account verification does not claim a code was sent
  until the email service returns a valid delivery response.
- The two original messages in the connected Gmail account were moved from Spam
  to Inbox at the user's request. This corrects that mailbox's existing messages;
  it does not force future delivery or override Gmail for other recipients.

Deploy the cloud `accountApi` and its secrets before publishing the updated
frontend and security rules so users can request signup/password-reset codes.
A frontend-only Git update cannot create that backend endpoint.

## Operating guidance

Send only requested account messages, keep sending volume consistent, handle
bounces, and monitor domain reputation using Google Postmaster Tools when enough
traffic is available. Do not add unsubscribe links to security codes or use
forged spam-score headers to try to force delivery. Gmail controls classification.

Sources:

- [Google email sender guidelines](https://support.google.com/mail/answer/81126)
- [Google DMARC setup](https://support.google.com/a/answer/2466580)
- [Gmail image blocking](https://support.google.com/mail/answer/145919)
