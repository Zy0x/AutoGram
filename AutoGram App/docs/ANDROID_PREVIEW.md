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
An APK update must use the same signing identity as the installed application. If
an update is rejected because of its signature, keep the installed app and its data;
do not uninstall it or clear storage. A build signed with the original key is required.

New local builds reuse a permanent signing identity kept outside the build caches.
Keep the signing keystore and its credentials safe: losing them can prevent future
updates to APKs signed with that identity. Local credentials are encrypted for the
current Windows user and machine; copying that encrypted credential file to another
computer does not by itself unlock the key. Protect the drive and arrange a secure,
recoverable backup before migrating computers. Generating a new identity does not
make it compatible with an older APK signed by a different key.

Logout contacts Telegram before removing the local session. A network failure leaves
the encrypted record available for retry. If Telegram confirms logout but local cleanup
fails, that account is no longer treated as active. Other accounts are not logged out.

## Cloud Drives and preview

After selecting a server-verified account, Cloud Drives can read Saved Messages or a
chat/channel selected from **Choose chat or channel**. Search requests go to Telegram;
**Load more** reads the next message page. A page may contain no matching media while
more messages remain. Forum locations are identified from Telegram metadata. Their
topic list, names, colors and closed status are fetched from Telegram, with refresh
and additional pages in the topic hub. Selecting a topic requests its message scope
on the server; it does not reuse an unrelated first page of chat history. Legacy
locally created topic drafts are not treated as cloud topics. Physical-device
acceptance for this path is still pending; virtual folders remain incomplete.

Topic creation, forwarding, tagging, moving, cloud deletion, duplicate cleanup and
Remote Link upload are not yet connected to complete Android executors. These actions
report unavailable instead of successful completion and do not change cloud files.

Cards use message metadata and any thumbnail already included by Telegram. Opening a
supported image, UTF-8 text, audio or video requests real media bytes. Image preview is
limited to 20 MB compressed data and downsampled for display; text preview is limited to
256 KB. Audio/video support depends on the device decoder. Unsupported formats are not
reported as successful previews. Archive and document-family parity is not complete.

The Drive archive browser reads ordinary ZIP catalogs and stored/deflated entries
through bounded ranges. Its in-memory limits are 8 MB for the directory and 100 MB
for compressed or decoded entries. Encrypted archives and ZIP64 are not certified;
do not treat this browser as a complete replacement for desktop archive tools.

The range source does not require a full forward buffer before the player can prepare.
Network, decoder and file layout still affect start time; playback is not guaranteed
instant. Seeking requests the required position rather than downloading all preceding
bytes. Closing the preview or changing account invalidates the old stream.

Preview uses the available screen area with fixed close and previous/next controls.
The overflow menu provides file information and download without crowding the title.
Navigation follows the current gallery filter and date order within the same
account and location; folders and unsupported neighboring formats are skipped. Images
support pinch/pan, double-tap zoom and reset; text scrolls independently of the controls.
Video fits its measured aspect ratio, with integrated play/pause and seek controls.
The progressive player separates a 200 ms startup threshold from its 15–50 second
ongoing buffer window, and supplies the saved position before preparing the media.
Failed reads can be retried. Transport setup and native byte conversion run separately
from the display thread. The exact-range reader reuses previously requested slices;
the video pipeline also fetches bounded chunks ahead and uses a temporary, per-stream disk cache. These
buffers are separate from the threshold for starting playback. Device testing is still
required to verify start/resume performance on the current build.

**Settings → Remember cloud playback position** controls local resume history. Positions
are separated by account and message, expire after 90 days and contain no media URL,
credential or local file path. Clear playback history removes these positions only.

## Cloud downloads

Open a cloud media card and choose **More → Download**, then inspect **Cloud downloads**
from the gallery overflow menu or the download icon in Transfers. New download jobs retain their original account, even when you switch
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

## Workspace and gallery navigation

Opening the app verifies the saved session with Telegram. Subsequent account-change
events consume the engine's verified selection without repeatedly restarting the
login gate; unverified or revoked accounts still cannot open the workspace.

The bottom navigation has four destinations: Home, Drive, Transfers and Tools.
It reserves its own space rather than floating over the collection. Settings and all
secondary destinations remain available in Tools. The Dashboard provides account
access, media from the currently loaded collection and compact Remote Link/Studio
shortcuts. This collection is not an account-wide recent-files index.
In Cloud Drives, the top circular rail selects actual Telegram locations;
Saved Messages is always directly available. Scroll horizontally for more locations
and use more to load additional results. The rail is the single Drive navigation surface;
there is no repeated location-title row below it. The overflow menu beside the rail
contains the complete Drive picker, view options and refresh;
an unsuccessful location request also provides retry. The selected location is highlighted.
Drive and forum-topic selectors stay above the collection while you scroll; the Drive
rail becomes compact to leave more room for media. In a forum group, select a topic
directly or open Topics for the full paginated picker. Loading and unsuccessful topic
requests remain visible with retry. Recent locations use the latest loaded Telegram
metadata rather than an old group label. Ordinary groups and channels have no forum
topic picker.

The collection uses the thumbnail aspect ratio chosen in View options, grouped by
message dates in your device time zone. Files with no known date remain in a separate
group. Search, media-type filters,
list view and long-press selection remain available. The collection menu contains the
existing actions; their availability has not changed. View options remain in the
collection overflow menu; search stays below the Drive rail at the collection start.
In compact navigation, use the search icon; an active or nonempty search stays visible.
Selecting files reserves
space for the action bar. Cloud downloads remain separate from legacy local transfer
records. Tools uses grouped rows without additional nested cards.

## Remaining feature boundaries

Settings reports available space from the shared native engine's filesystem measurement,
not a fixed storage estimate or the configured cache budget. Storage-provider errors
leave the reading unavailable. Encoder capabilities are not assumed from the device
type: the Android processing adapter is still incomplete and does not return a
manufactured hardware profile. A valid desktop media output does not prove Android
Studio support.

Device-file preview reads content selected through Android's file picker. This is
separate from Telegram cloud streaming. Old transfer records do not prove execution;
only the new cloud-download path performs the workflow above. Upload parity and
real-account testing of the packaged app are still required. Crawler, Studio,
Forwarder, automation and backup parity remain under development. Unsupported actions
must not be interpreted as successful operations.

Use a dedicated test account and destination for manual acceptance testing. The preview
must not be relied on for unattended transfers or preservation of the only copy of data.
