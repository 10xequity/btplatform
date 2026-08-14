-- Boomtown Platform — migration 0048: a passkey remembers that it can do Face ID / PIN
-- File: db/migrations/2026-08-14_0048_passkey-uv-ratchet_v1_0.sql · Date: 2026-08-14
-- Ships in: v0.152.0 · roadmap §-1i S-4a, §-0 B12
--
-- One additive column. `uv_required = 1` means this credential has demonstrated user
-- verification (Face ID, fingerprint, or PIN — the WebAuthn UV flag) at least once — at
-- enrolment or at any login — and from then on every assertion from it must carry that flag.
--
-- THE RATCHET IS WHAT MAKES S-4a LOCKOUT-FREE. The archive's plain fix ("required" everywhere,
-- reject every UV-less assertion) would refuse authenticators that cannot verify a user — the
-- exact trade-off §-1i flagged as an owner call. Instead: NEW enrolments must UV (the browser
-- refuses enrolment otherwise, and email sign-in still exists); EXISTING credentials keep
-- working exactly as they do today until their first verified login flips this bit, after which
-- a UV-less assertion from them is refused — because an authenticator that has proven it can
-- verify and suddenly stops is the shape of a cloned or coerced key, not a settings change.
-- The one live credential (device_label "Windows PC" — Windows Hello, which always verifies)
-- ratchets itself on the owner's first login after this ships. DEFAULT 0: every existing row is
-- untouched and no login behaviour changes until a verified login proves the capability.

ALTER TABLE webauthn_credentials ADD COLUMN uv_required INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0048',
  '2026-08-14_0048_passkey-uv-ratchet_v1_0.sql',
  'webauthn_credentials.uv_required — S-4a: once a passkey demonstrates Face ID/PIN (the WebAuthn UV flag) at enrolment or any login, every later assertion must carry it. New enrolments require UV outright; existing credentials ratchet on their first verified login, so nothing is ever locked out. DEFAULT 0 on all rows: the deploy changes no login until a credential proves the capability.'
);
