use super::{validation::validate_id, *};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const SCHEMA: &str =
    include_str!("../../../../../database/migrations/029_native_transfer_profile_bindings.sql");
const V4: &str =
    include_str!("../../../../../database/migrations/015_transfer_control_plane_v4.sql");
const SELECT: &str =
    "SELECT b.local_profile_id,b.revision,b.selected,p.config_json,p.name,p.schema_version
    FROM native_transfer_profile_bindings b JOIN transfer_profiles p ON p.profile_id=b.profile_key";

#[derive(Clone)]
pub struct ScopedProfileStore {
    pub(super) connection: Arc<Mutex<Connection>>,
}
impl ScopedProfileStore {
    pub fn open(path: &Path) -> Result<Self, ProfileError> {
        if !path.is_absolute() {
            return Err(ProfileError::InvalidProfile);
        }
        let conn = Connection::open(path).map_err(|_| ProfileError::Database)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
            .map_err(|_| ProfileError::Database)?;
        conn.execute_batch(V4).map_err(|_| ProfileError::Database)?;
        conn.execute_batch(SCHEMA)
            .map_err(|_| ProfileError::Database)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(conn)),
        })
    }
    pub fn list(&self, scope: &AccountScope) -> Result<Vec<ScopedTransferProfile>, ProfileError> {
        let conn = self.connection.lock();
        let mut query = conn.prepare(&format!("{SELECT} WHERE b.account_id=?1 AND b.authorized_user_id=?2 ORDER BY p.name,b.local_profile_id"))
            .map_err(|_| ProfileError::Database)?;
        let rows = query
            .query_map(
                params![scope.account_id(), scope.authorized_user_id()],
                |row| decode(row, scope),
            )
            .map_err(|_| ProfileError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ProfileError::Database);
        rows
    }
    pub fn get(
        &self,
        scope: &AccountScope,
        id: &str,
    ) -> Result<ScopedTransferProfile, ProfileError> {
        validate_id(id)?;
        self.connection.lock().query_row(&format!("{SELECT} WHERE b.account_id=?1 AND b.authorized_user_id=?2 AND b.local_profile_id=?3"),
            params![scope.account_id(),scope.authorized_user_id(),id], |row| decode(row,scope))
            .optional().map_err(|_| ProfileError::Database)?.ok_or(ProfileError::NotFound)
    }
    pub fn active(
        &self,
        scope: &AccountScope,
    ) -> Result<Option<ScopedTransferProfile>, ProfileError> {
        self.connection
            .lock()
            .query_row(
                &format!(
                    "{SELECT} WHERE b.account_id=?1 AND b.authorized_user_id=?2 AND b.selected=1"
                ),
                params![scope.account_id(), scope.authorized_user_id()],
                |row| decode(row, scope),
            )
            .optional()
            .map_err(|_| ProfileError::Database)
    }
    /// expected_revision=0 creates a new definition. All edits compare the known revision.
    pub fn save(
        &self,
        scope: &AccountScope,
        id: &str,
        expected_revision: i64,
        config: FrozenTransferProfile,
    ) -> Result<ScopedTransferProfile, ProfileError> {
        validate_id(id)?;
        validate_profile(&config)?;
        if expected_revision < 0 {
            return Err(ProfileError::InvalidProfile);
        }
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ProfileError::Database)?;
        let existing: Option<(String, i64)> = tx
            .query_row(
                "SELECT profile_key,revision FROM native_transfer_profile_bindings
            WHERE account_id=?1 AND authorized_user_id=?2 AND local_profile_id=?3",
                params![scope.account_id(), scope.authorized_user_id(), id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ProfileError::Database)?;
        let now = now_ms();
        let json = serde_json::to_string(&config).map_err(|_| ProfileError::InvalidProfile)?;
        match existing {
            Some((key, revision)) => {
                if revision != expected_revision || revision == i64::MAX {
                    return Err(ProfileError::Conflict);
                }
                tx.execute("UPDATE transfer_profiles SET name=?2,schema_version=?3,config_json=?4,updated_at=?5 WHERE profile_id=?1",
                    params![key,config.profile_name,config.schema_version,json,now]).map_err(|_| ProfileError::Database)?;
                tx.execute("UPDATE native_transfer_profile_bindings SET revision=revision+1 WHERE profile_key=?1", [key])
                    .map_err(|_| ProfileError::Database)?;
            }
            None => {
                if expected_revision != 0 {
                    return Err(ProfileError::Conflict);
                }
                let key = format!("android-profile-{:032x}", rand::random::<u128>());
                tx.execute("INSERT INTO transfer_profiles(profile_id,name,schema_version,config_json,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",
                    params![key,config.profile_name,config.schema_version,json,now]).map_err(|_| ProfileError::Database)?;
                tx.execute("INSERT INTO native_transfer_profile_bindings(account_id,authorized_user_id,local_profile_id,profile_key) VALUES (?1,?2,?3,?4)",
                    params![scope.account_id(),scope.authorized_user_id(),id,key]).map_err(|_| ProfileError::Database)?;
            }
        }
        let saved = tx.query_row(&format!("{SELECT} WHERE b.account_id=?1 AND b.authorized_user_id=?2 AND b.local_profile_id=?3"),
            params![scope.account_id(),scope.authorized_user_id(),id], |row| decode(row,scope)).map_err(|_| ProfileError::Database)?;
        tx.commit().map_err(|_| ProfileError::Database)?;
        Ok(saved)
    }
    pub fn select(
        &self,
        scope: &AccountScope,
        id: &str,
        expected_revision: i64,
    ) -> Result<(), ProfileError> {
        validate_id(id)?;
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ProfileError::Database)?;
        let target = tx.query_row(&format!("{SELECT} WHERE b.account_id=?1 AND b.authorized_user_id=?2 AND b.local_profile_id=?3"),
            params![scope.account_id(),scope.authorized_user_id(),id], |row| decode(row,scope))
            .optional().map_err(|_| ProfileError::Database)?.ok_or(ProfileError::NotFound)?;
        if target.revision != expected_revision {
            return Err(ProfileError::Conflict);
        }
        tx.execute("UPDATE native_transfer_profile_bindings SET selected=0 WHERE account_id=?1 AND authorized_user_id=?2 AND selected=1",
            params![scope.account_id(),scope.authorized_user_id()]).map_err(|_| ProfileError::Database)?;
        tx.execute("UPDATE native_transfer_profile_bindings SET selected=1 WHERE account_id=?1 AND authorized_user_id=?2 AND local_profile_id=?3",
            params![scope.account_id(),scope.authorized_user_id(),id]).map_err(|_| ProfileError::Database)?;
        tx.commit().map_err(|_| ProfileError::Database)
    }
    pub fn remove(
        &self,
        scope: &AccountScope,
        id: &str,
        expected_revision: i64,
    ) -> Result<(), ProfileError> {
        validate_id(id)?;
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ProfileError::Database)?;
        let existing: Option<(String, i64)> = tx
            .query_row(
                "SELECT profile_key,revision FROM native_transfer_profile_bindings
            WHERE account_id=?1 AND authorized_user_id=?2 AND local_profile_id=?3",
                params![scope.account_id(), scope.authorized_user_id(), id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ProfileError::Database)?;
        let (key, revision) = existing.ok_or(ProfileError::NotFound)?;
        if revision != expected_revision {
            return Err(ProfileError::Conflict);
        }
        tx.execute("DELETE FROM transfer_profiles WHERE profile_id=?1", [key])
            .map_err(|_| ProfileError::Database)?;
        tx.commit().map_err(|_| ProfileError::Database)
    }
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn decode(
    row: &rusqlite::Row<'_>,
    scope: &AccountScope,
) -> rusqlite::Result<ScopedTransferProfile> {
    let json: String = row.get(3)?;
    let config: FrozenTransferProfile =
        serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let name: String = row.get(4)?;
    let schema: u32 = row.get(5)?;
    let id: String = row.get(0)?;
    let revision: i64 = row.get(1)?;
    if validate_id(&id).is_err()
        || validate_profile(&config).is_err()
        || name != config.profile_name
        || schema != config.schema_version
        || revision <= 0
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(ScopedTransferProfile {
        scope: scope.clone(),
        profile_id: id,
        revision,
        active: row.get(2)?,
        config,
    })
}
