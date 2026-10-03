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

## Cloud Drives and preview

After selecting a server-verified account, Cloud Drives can read Saved Messages or a
chat/channel selected from **Choose chat or channel**. Search requests go to Telegram;
**Load more** reads the next message page. A page may contain no matching media while
more messages remain. Folder and forum-topic navigation are not yet equivalent to desktop.

Cards use message metadata and any thumbnail already included by Telegram. Opening a
supported image, UTF-8 text, audio or video requests real media bytes. Image preview is
limited to 20 MB compressed data and downsampled for display; text preview is limited to
256 KB. Audio/video support depends on the device decoder. Unsupported formats are not
reported as successful previews. Archive and document-family parity is not complete.

The range source does not require a full forward buffer before the player can prepare.
Network, decoder and file layout still affect start time; playback is not guaranteed
instant. Seeking requests the required position rather than downloading all preceding
bytes. Closing the preview or changing account invalidates the old stream.

**Settings → Remember cloud playback position** controls local resume history. Positions
are separated by account and message, expire after 90 days and contain no media URL,
credential or local file path. Clear playback history removes these positions only.

## Cloud downloads

Open a cloud media card and choose **Download**, then inspect **Cloud downloads** in
Cloud Drives. New download jobs retain their original account, even when you switch
accounts. The native engine verifies source identity, writes bounded chunks and checks
actual file size and SHA-256. Pause, resume, cancel and retry act on these real jobs,
not older metadata-only transfer records.

**Ready to save** means the file has been verified in app-private storage. Choose
**Save…** to create an output through Android's document picker. The selected output
is copied, closed, reopened and checked independently before **Output copy verified**
appears. Nonempty documents are rejected without truncation. An interrupted or failed
save may leave a partial document; select a new output to retry. The verified internal
file remains available. Full downloads require sufficient internal storage as well as
space in the selected output location. The save picker proposes the name and media type
from the selected Telegram listing; these display details are not proof of file identity.

Active downloads use a foreground service. Android may defer scheduled jobs or stop
processes; flushed checkpoints support recovery. Source failures during recovery remain
visible, and delayed commit recovery respects Telegram's FloodWait deadline. Paused/failed jobs require explicit
resume/retry. Force-stop is respected: transfers cannot continue until Android permits
the application to run again. Real Telegram/device acceptance is still pending.

## Remaining feature boundaries

Device-file preview reads content selected through Android's file picker. This is
separate from Telegram cloud streaming. Old transfer records do not prove execution;
only the new cloud-download path performs the workflow above. Upload parity and
real-account testing of the packaged app are still required. Crawler, Studio,
Forwarder, automation and backup parity remain under development. Unsupported actions
must not be interpreted as successful operations.

Use a dedicated test account and destination for manual acceptance testing. The preview
must not be relied on for unattended transfers or preservation of the only copy of data.
