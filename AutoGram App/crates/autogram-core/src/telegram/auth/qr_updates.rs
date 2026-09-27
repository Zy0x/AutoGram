//! QR re-export policy follows Telegram's updateLoginToken/expiry protocol.
use grammers_client::tl;
use grammers_session::updates::UpdatesLike;

pub(super) fn needs_refresh(update: &UpdatesLike) -> bool {
    match update {
        UpdatesLike::ConnectionClosed | UpdatesLike::MalformedUpdates => true,
        UpdatesLike::Updates(updates) => match updates {
            tl::enums::Updates::UpdateShort(short) => is_login(&short.update),
            tl::enums::Updates::Updates(batch) => batch.updates.iter().any(is_login),
            tl::enums::Updates::Combined(batch) => batch.updates.iter().any(is_login),
            tl::enums::Updates::TooLong => true,
            _ => false,
        },
        _ => false,
    }
}

fn is_login(update: &tl::enums::Update) -> bool {
    matches!(update, tl::enums::Update::LoginToken)
}

pub(super) fn should_export(has_token: bool, expires_at: i64, now: i64, notified: bool) -> bool {
    !has_token || expires_at <= now || notified
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_token_is_not_regenerated_on_every_ui_poll() {
        assert!(!should_export(true, 130, 100, false));
        assert!(!should_export(true, 130, 129, false));
        assert!(should_export(true, 130, 130, false));
        assert!(should_export(true, 130, 100, true));
        assert!(should_export(false, 0, 100, false));
    }

    #[test]
    fn server_confirmation_and_reconnect_trigger_recheck() {
        let token = UpdatesLike::Updates(tl::enums::Updates::UpdateShort(tl::types::UpdateShort {
            update: tl::enums::Update::LoginToken,
            date: 100,
        }));
        assert!(needs_refresh(&token));
        assert!(needs_refresh(&UpdatesLike::ConnectionClosed));
        let unrelated =
            UpdatesLike::Updates(tl::enums::Updates::UpdateShort(tl::types::UpdateShort {
                update: tl::enums::Update::Config,
                date: 100,
            }));
        assert!(!needs_refresh(&unrelated));
    }
}
