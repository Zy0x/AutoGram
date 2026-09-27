# AutoGram Android preview

The Android application is being developed to work independently of the desktop.
Current Debug APKs are previews, not a complete desktop replacement. A successful
installation does not mean all cloud and transfer features are available.

## Accounts and sign-in

Open **Tools → Accounts**, configure your own Telegram API ID and API hash, then
choose phone sign-in or QR sign-in. Enter the code and, if requested, your two-step
verification password only in the application. Never send these credentials in chat.
For QR sign-in, scan the displayed code through an already signed-in Telegram app.

The sign-in implementation connects directly to Telegram using the native Rust engine.
Real-account acceptance testing is still required; this preview is not certified as
ready for daily use. Telegram may require another delivery method or an official app.
Resending is enabled only when the server permits it. Rate-limit waits are retained
when the application restarts.

Stored account entries are not proof of an active login. Selecting an account checks
its identity with Telegram. After restarting the app, the last account must be checked
again. Cancelling a challenge discards its UI state; a new sign-in starts a new attempt.
If the last identity check fails after sign-in, retry the check from the challenge.

## Local protection and logout

Android encrypts new authentication records using an Android Keystore-managed key.
The key is not exported by the application. Hardware backing depends on the device;
it is not assumed. Automatic application backup and device transfer are disabled for
these records. OTPs, passwords and QR tokens are not written to the session vault.

If the key is lost or ciphertext is damaged, the application reports a storage error
instead of replacing the vault. Do not remove app data to troubleshoot without first
understanding that doing so removes local sessions and records.

Logout contacts Telegram before removing the local session. A network failure leaves
the encrypted record available for retry. If Telegram confirms logout but local cleanup
fails, that account is no longer treated as active. Other accounts are not logged out.

## Feature boundaries

Device-file preview reads content selected through Android's file picker. This is
separate from Telegram cloud streaming. Current Drive and transfer records do not prove
that remote indexing, upload, download or cloud preview has run. Crawler, Studio,
Forwarder, automation and backup parity remain under development. Unsupported actions
must not be interpreted as successful operations.

Use a dedicated test account and destination for manual acceptance testing. The preview
must not be relied on for unattended transfers or preservation of the only copy of data.
