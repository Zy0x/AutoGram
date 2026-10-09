use crate::{
    telegram::auth::{map_rpc, AccountId, AuthEngine, AuthError, RpcDomain},
    transfer::{cloud_download::AccountScope, cloud_upload::UploadLimits},
};
use grammers_client::tl;
use tokio_util::sync::CancellationToken;

pub(super) async fn limits(
    auth: &AuthEngine,
    scope: &AccountScope,
    cancel: &CancellationToken,
) -> Result<UploadLimits, AuthError> {
    auth.account_request_scoped(
        &AccountId(scope.account_id().into()),
        &[RpcDomain::UploadParts],
        cancel,
        |client| async move {
            let me = client
                .get_me()
                .await
                .map_err(|e| map_rpc(e).for_rpc(RpcDomain::UploadParts))?;
            if me.id().bare_id_unchecked() != scope.authorized_user_id() {
                return Err(AuthError::new("account_mismatch"));
            }
            let premium = matches!(&me.raw,tl::enums::User::User(user) if user.premium);
            let response = client
                .invoke(&tl::functions::help::GetAppConfig { hash: 0 })
                .await
                .map_err(|e| map_rpc(e).for_rpc(RpcDomain::UploadParts))?;
            let tl::enums::help::AppConfig::Config(config) = response else {
                return Err(AuthError::new("upload_limits_unavailable"));
            };
            let parts_key = if premium {
                "upload_max_fileparts_premium"
            } else {
                "upload_max_fileparts_default"
            };
            let caption_key = if premium {
                "caption_length_limit_premium"
            } else {
                "caption_length_limit_default"
            };
            let max_parts = number(&config.config, parts_key)
                .ok_or_else(|| AuthError::new("upload_limits_unavailable"))?;
            let caption_utf16 = number(&config.config, caption_key)
                .or_else(|| number(&config.config, "caption_length_limit"))
                .ok_or_else(|| AuthError::new("upload_limits_unavailable"))?;
            Ok(UploadLimits {
                max_parts,
                caption_utf16,
            })
        },
    )
    .await
}
fn number(config: &tl::enums::Jsonvalue, key: &str) -> Option<u32> {
    let tl::enums::Jsonvalue::JsonObject(object) = config else {
        return None;
    };
    let mut found = None;
    for entry in &object.value {
        let tl::enums::JsonobjectValue::JsonObjectValue(entry) = entry;
        if entry.key != key {
            continue;
        }
        let tl::enums::Jsonvalue::JsonNumber(value) = &entry.value else {
            return None;
        };
        if found.is_some()
            || !value.value.is_finite()
            || value.value.fract() != 0.0
            || value.value <= 0.0
            || value.value > u32::MAX as f64
        {
            return None;
        }
        found = Some(value.value as u32);
    }
    found
}
#[cfg(test)]
mod tests {
    use super::*;
    fn config(values: &[f64]) -> tl::enums::Jsonvalue {
        tl::types::JsonObject {
            value: values
                .iter()
                .map(|value| {
                    tl::types::JsonObjectValue {
                        key: "limit".into(),
                        value: tl::types::JsonNumber { value: *value }.into(),
                    }
                    .into()
                })
                .collect(),
        }
        .into()
    }
    #[test]
    fn only_unique_positive_integer_config_values_are_accepted() {
        assert_eq!(number(&config(&[4000.0]), "limit"), Some(4000));
        for values in [
            &[0.0][..],
            &[-1.0],
            &[1.5],
            &[f64::INFINITY],
            &[4000.0, 8000.0],
        ] {
            assert_eq!(number(&config(values), "limit"), None);
        }
    }
}
