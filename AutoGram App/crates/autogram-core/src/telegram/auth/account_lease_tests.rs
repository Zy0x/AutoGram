use super::*;
use crate::telegram::auth::AuthSecretStore;
use grammers_session::SessionData;

struct EmptyVault;
impl AuthSecretStore for EmptyVault {
    fn read(&self, _: &str) -> Result<Option<Vec<u8>>, AuthError> { Ok(None) }
    fn write(&self, _: &str, _: &[u8]) -> Result<(), AuthError> { Err(AuthError::new("fixture_write_forbidden")) }
    fn remove(&self, _: &str) -> Result<(), AuthError> { Err(AuthError::new("fixture_write_forbidden")) }
    fn keys(&self) -> Result<Vec<String>, AuthError> { Ok(Vec::new()) }
}
fn fixture() -> (Arc<AuthEngine>, AccountId) {
    let engine = Arc::new(AuthEngine::new(Arc::new(EmptyVault)));
    let id = AccountId("tg_123".into());
    // Closures submit no RPC: only local synchronization is exercised.
    engine.accounts.lock().insert(id.0.clone(), Arc::new(Connection::new(1, SessionData::default())));
    *engine.selected.lock() = Some(id.clone());
    (engine, id)
}

#[tokio::test]
async fn work_stays_pinned_when_ui_selects_another_account() {
    let (engine, id) = fixture();
    let started = Arc::new(tokio::sync::Notify::new());
    let finish = Arc::new(tokio::sync::Notify::new());
    let worker = engine.clone(); let signal = started.clone(); let done = finish.clone();
    let task = tokio::spawn(async move {
        worker.account_request(&id, &CancellationToken::new(), |_| async move {
            signal.notify_one(); done.notified().await; Ok(42)
        }).await
    });
    started.notified().await;
    *engine.selected.lock() = Some(AccountId("tg_456".into()));
    engine.scope_revision.send_modify(|revision| *revision += 1);
    finish.notify_one();
    assert_eq!(task.await.unwrap().unwrap(), 42);
}

#[tokio::test]
async fn revocation_cancels_the_inflight_account_request() {
    let (engine, id) = fixture();
    let started = Arc::new(tokio::sync::Notify::new());
    let worker = engine.clone(); let owner = id.clone(); let signal = started.clone();
    let task = tokio::spawn(async move {
        worker.account_request(&owner, &CancellationToken::new(), |_| async move {
            signal.notify_one(); std::future::pending::<Result<(), AuthError>>().await
        }).await
    });
    started.notified().await; engine.invalidate_account(&id);
    assert_eq!(task.await.unwrap().unwrap_err().code, "not_authorized");
}

#[tokio::test]
async fn cancellation_cannot_become_success() {
    let (engine, id) = fixture();
    let cancel = CancellationToken::new(); cancel.cancel();
    let result = engine.account_request(&id, &cancel, |_| async { Ok(1) }).await;
    assert_eq!(result.unwrap_err().code, "operation_cancelled");
}

#[tokio::test]
async fn persisted_account_name_alone_cannot_run_background_work() {
    let engine = AuthEngine::new(Arc::new(EmptyVault));
    let result = engine.account_request(&AccountId("tg_123".into()), &CancellationToken::new(), |_| async { Ok(1) }).await;
    assert_eq!(result.unwrap_err().code, "not_authorized");
}

#[tokio::test]
async fn revoking_background_account_does_not_invalidate_another_selected_scope() {
    let (engine, id) = fixture();
    *engine.selected.lock() = Some(AccountId("tg_456".into()));
    let revision = engine.cloud_revision();
    engine.invalidate_account(&id);
    assert_eq!(engine.cloud_revision(), revision);
    assert_eq!(*engine.selected.lock(), Some(AccountId("tg_456".into())));
}

#[tokio::test]
async fn late_revocation_cannot_remove_a_newer_connection() {
    let (engine, id) = fixture();
    let old = engine.accounts.lock().get(&id.0).unwrap().clone();
    let replacement = Arc::new(Connection::new(1, SessionData::default()));
    engine.accounts.lock().insert(id.0.clone(), replacement.clone());
    engine.invalidate_connection(&id, &old);
    assert!(Arc::ptr_eq(engine.accounts.lock().get(&id.0).unwrap(), &replacement));
    assert_eq!(*engine.selected.lock(), Some(id));
}
