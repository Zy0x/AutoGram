# Forwarder cloud control plane

The migration in `migrations/20260901000000_forwarder_cloud.sql` defines the metadata-only
Supabase boundary for Media Forwarder V2. Every table carries `user_id` and enables RLS;
policies require `auth.uid() = user_id`.

`functions/v1-jobs` authenticates the caller, validates ciphertext size/version boundaries,
supports revision-checked job updates, event/decision reads, and enqueues signed device
commands for validate/run/pause/resume/cancel, plus device `claim`/`ack` endpoints. Telegram sessions, API hashes, filesystem
paths, decrypted captions, and raw media remain on the encrypted Desktop/Android device.
Atomic relay claiming is exposed by the `claim_relay_command(uuid)` database function for
the device worker.
