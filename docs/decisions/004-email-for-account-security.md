# ADR 004 — Email for account security, not marketing

Date: 2026-11-08  
Status: Accepted (supersedes the earlier no-email decision)

## Context

The original prototype deliberately had no email. After opening the product to
real users, email is required for account verification and self-service
recovery. The product is public, so registration cannot depend on an operator
manually issuing recovery keys.

## Decision

1. Email is used only for account and security purposes:
   - registration verification codes;
   - password-reset verification codes;
   - password-change and email-change notices;
   - workspace invitations;
   - security alerts the user requests.
2. No marketing, newsletters, re-engagement campaigns or purchased lists.
3. Verification codes are 6 digits, stored hashed, expire in 10 minutes, are
   limited to 5 verification attempts, have a 60-second resend cooldown and a
   maximum of 6 sends per address per hour.
4. Password recovery supports both an email code and the recovery key.
   Email recovery revokes all sessions and resets 2FA.
5. Changing the login email requires the new address's verification code plus
   the current password; a notice is sent to the old address.
6. SMTP credentials live only in `/etc/360note/360note.env` and never in Git.
7. Test mail may only be sent to `access@126.com` or addresses explicitly
   supplied by the operator. This protects the domain's sending reputation.

## Consequences

- Users can self-register and recover accounts without manual intervention.
- The instance now depends on an external SMTP provider for registration and
  recovery. If mail fails, existing sessions continue to work and support can
  be reached through the published contact address.
- Email addresses become security-sensitive data. The privacy policy was
  updated accordingly.
- The previous ADR text (“never send email”) is obsolete and must not be
  reintroduced. Notification centre items remain in-app; they are not mirrored
  to email except for explicit security notices.
