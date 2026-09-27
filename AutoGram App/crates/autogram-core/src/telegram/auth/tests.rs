use super::*;
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};

#[derive(Default)]
struct TestVault(Mutex<HashMap<String, Vec<u8>>>);
impl AuthSecretStore for TestVault {
    fn read(&self, key: &str) -> Result<Option<Vec<u8>>, AuthError> {
        Ok(self.0.lock().get(key).cloned())
    }
    fn write(&self, key: &str, value: &[u8]) -> Result<(), AuthError> {
        self.0.lock().insert(key.into(), value.to_vec());
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<(), AuthError> {
        self.0.lock().remove(key);
        Ok(())
    }
    fn keys(&self) -> Result<Vec<String>, AuthError> {
        Ok(self.0.lock().keys().cloned().collect())
    }
}
fn credentials() -> ApiCredentials {
    ApiCredentials {
        api_id: 123,
        api_hash: "a".repeat(32),
    }
}

#[test]
fn credentials_and_account_names_reject_invalid_or_path_like_inputs() {
    assert!(credentials().validate().is_ok());
    assert!(ApiCredentials {
        api_id: 0,
        api_hash: "a".repeat(32)
    }
    .validate()
    .is_err());
    assert!(ApiCredentials {
        api_id: 1,
        api_hash: "z".repeat(32)
    }
    .validate()
    .is_err());
    for id in ["../private", "tg_../private", "tg_", "tg_a", "tg_1/2"] {
        assert!(account_key(&AccountId(id.into())).is_err());
    }
    assert_eq!(
        account_key(&AccountId("tg_123".into())).unwrap(),
        "account_tg_123"
    );
    for phone in ["", "12345", "+123a456", "+12", "+12345678901234567890"] {
        assert!(validate_phone(phone).is_err());
    }
    assert!(validate_phone("+12345678901").is_ok());
}

#[tokio::test]
async fn creating_and_cancelling_attempt_does_not_create_an_account_or_send_code() {
    let vault = Arc::new(TestVault::default());
    let engine = AuthEngine::new(vault.clone());
    assert!(!engine.configured().unwrap());
    engine.configure(credentials()).unwrap();
    let first = engine.create_attempt(Some("+12345678901".into())).unwrap();
    let second = engine.create_attempt(None).unwrap();
    assert_ne!(first, second);
    assert!(!engine.cancel(&first));
    assert!(engine.cancel(&second));
    assert_eq!(
        engine
            .advance(second, AuthAction::PollQr)
            .await
            .err()
            .unwrap()
            .code,
        "login_expired"
    );
    assert!(engine.list_accounts().unwrap().is_empty());
    assert_eq!(vault.keys().unwrap(), vec!["api"]);
}

#[tokio::test]
async fn persisted_flood_wait_survives_new_engine_and_cannot_be_bypassed_by_new_attempt() {
    let vault = Arc::new(TestVault::default());
    let engine = AuthEngine::new(vault.clone());
    engine.configure(credentials()).unwrap();
    vault
        .write(
            "auth_cooldown",
            &serde_json::to_vec(&(unix_seconds() + 900)).unwrap(),
        )
        .unwrap();
    let restarted = AuthEngine::new(vault);
    let error = restarted.create_attempt(None).err().unwrap();
    assert_eq!(error.code, "flood_wait");
    assert!(error.retry_after_seconds >= 899); // Do not cap server FloodWait to 300s.
}

#[test]
fn unsigned_session_is_not_a_saved_authorized_account() {
    use grammers_session::{storages::MemorySession, SessionData};
    assert!(snapshot_session(&MemorySession::from(SessionData::default())).is_err());
    let vault = Arc::new(TestVault::default());
    vault.write("account_tg_123", b"corrupt").unwrap();
    assert_eq!(
        AuthEngine::new(vault).list_accounts().err().unwrap().code,
        "vault_error"
    );
}

#[test]
fn snapshot_preserves_home_and_other_negotiated_dc_keys() {
    use grammers_session::{storages::MemorySession, SessionData};
    let mut data = SessionData::default();
    data.home_dc = 2;
    data.dc_options.get_mut(&2).unwrap().auth_key = Some([42; 256]);
    data.dc_options.get_mut(&4).unwrap().auth_key = Some([43; 256]);
    let saved = snapshot_session(&MemorySession::from(data)).unwrap();
    assert_eq!(saved.home_dc, 2);
    assert_eq!(saved.dc_options[&2].auth_key, Some([42; 256]));
    assert_eq!(saved.dc_options[&4].auth_key, Some([43; 256]));
}

#[test]
fn rpc_errors_are_redacted_and_flood_wait_retains_server_duration() {
    use grammers_mtsender::{InvocationError, RpcError};
    let error = super::transport::map_rpc(InvocationError::Rpc(RpcError {
        code: 420,
        name: "FLOOD_WAIT".into(),
        value: Some(700),
        caused_by: None,
    }));
    assert_eq!(error.retry_after_seconds, 700);
    let error = super::transport::map_rpc(InvocationError::Rpc(RpcError {
        code: 500,
        name: "private-provider-message".into(),
        value: None,
        caused_by: None,
    }));
    assert_eq!(error.to_string(), "telegram_request_failed");
}
