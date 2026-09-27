use super::*;

#[derive(Default)]
struct Vault {
    records: Mutex<HashMap<String, Vec<u8>>>,
    fail_remove: Mutex<Option<String>>,
}
impl AuthSecretStore for Vault {
    fn read(&self, key: &str) -> Result<Option<Vec<u8>>, AuthError> {
        Ok(self.records.lock().get(key).cloned())
    }
    fn write(&self, key: &str, bytes: &[u8]) -> Result<(), AuthError> {
        self.records.lock().insert(key.into(), bytes.to_vec());
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<(), AuthError> {
        if self.fail_remove.lock().as_deref() == Some(key) {
            return Err(AuthError::new("vault_error"));
        }
        self.records.lock().remove(key);
        Ok(())
    }
    fn keys(&self) -> Result<Vec<String>, AuthError> {
        Ok(self.records.lock().keys().cloned().collect())
    }
}

#[test]
fn confirmed_logout_invalidates_selection_even_when_account_removal_fails() {
    let vault = Arc::new(Vault::default());
    let engine = AuthEngine::new(vault.clone());
    let id = AccountId("tg_123".into());
    *engine.selected.lock() = Some(id.clone());
    vault
        .write("active", &serde_json::to_vec(&id).unwrap())
        .unwrap();
    vault
        .write("account_tg_123", b"encrypted record fixture")
        .unwrap();
    *vault.fail_remove.lock() = Some("account_tg_123".into());
    assert_eq!(engine.finish_logout(&id).unwrap_err().code, "vault_error");
    assert!(engine.selected.lock().is_none());
    assert!(engine.last_selected().unwrap().is_none());
    assert!(vault.read("account_tg_123").unwrap().is_some());
    *vault.fail_remove.lock() = None;
    engine.finish_logout(&id).unwrap();
    assert!(vault.read("account_tg_123").unwrap().is_none());
}

#[test]
fn cleanup_retry_removes_stale_selection_without_clearing_another_account() {
    let vault = Arc::new(Vault::default());
    let engine = AuthEngine::new(vault.clone());
    let first = AccountId("tg_123".into());
    let second = AccountId("tg_456".into());
    *engine.selected.lock() = Some(first.clone());
    vault
        .write("active", &serde_json::to_vec(&first).unwrap())
        .unwrap();
    *vault.fail_remove.lock() = Some("active".into());
    assert!(engine.finish_logout(&first).is_err());
    assert!(engine.selected.lock().is_none());
    *vault.fail_remove.lock() = None;
    engine.finish_logout(&first).unwrap();
    assert!(engine.last_selected().unwrap().is_none());
    *engine.selected.lock() = Some(second.clone());
    vault
        .write("active", &serde_json::to_vec(&second).unwrap())
        .unwrap();
    engine.finish_logout(&first).unwrap();
    assert_eq!(*engine.selected.lock(), Some(second.clone()));
    assert_eq!(engine.last_selected().unwrap(), Some(second));
}

#[tokio::test]
async fn retained_flood_wait_also_blocks_account_selection_and_logout() {
    let vault = Arc::new(Vault::default());
    let engine = AuthEngine::new(vault.clone());
    assert_eq!(engine.retain_error(AuthError::wait(900)).code, "flood_wait");
    let restarted = AuthEngine::new(vault);
    let id = AccountId("tg_123".into());
    let selection = restarted.select_account(id.clone()).await.unwrap_err();
    assert_eq!(selection.code, "flood_wait");
    assert!(selection.retry_after_seconds >= 899);
    assert_eq!(restarted.logout(id).await.unwrap_err().code, "flood_wait");
}
