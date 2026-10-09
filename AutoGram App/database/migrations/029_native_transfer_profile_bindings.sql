-- Account-scoped ownership and selection for the shared v4 profile definitions.
CREATE TABLE IF NOT EXISTS native_transfer_profile_bindings (
    account_id TEXT NOT NULL,
    authorized_user_id INTEGER NOT NULL CHECK(authorized_user_id > 0),
    local_profile_id TEXT NOT NULL,
    profile_key TEXT NOT NULL UNIQUE REFERENCES transfer_profiles(profile_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1)),
    PRIMARY KEY(account_id, authorized_user_id, local_profile_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_native_transfer_profile_active
ON native_transfer_profile_bindings(account_id, authorized_user_id) WHERE selected=1;
CREATE TRIGGER IF NOT EXISTS native_transfer_profile_owner_immutable
BEFORE UPDATE OF account_id, authorized_user_id, local_profile_id, profile_key
ON native_transfer_profile_bindings BEGIN
    SELECT RAISE(ABORT, 'native_transfer_profile_owner_immutable');
END;
