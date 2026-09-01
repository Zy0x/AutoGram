# Forwarder cloud control plane

The migration in `migrations/20260901000000_forwarder_cloud.sql` defines the metadata-only
Supabase boundary for Media Forwarder V2. Every table carries `user_id` and enables RLS;
policies require `auth.uid() = user_id`.

`functions/v1-jobs` is intentionally small: it authenticates the caller, validates the
versioned ciphertext payload, and persists job metadata. Telegram sessions, API hashes,
filesystem paths, decrypted captions, and raw media remain on the encrypted Desktop/Android
device. Actual Telegram work is claimed by a signed device relay command in a later rollout.
