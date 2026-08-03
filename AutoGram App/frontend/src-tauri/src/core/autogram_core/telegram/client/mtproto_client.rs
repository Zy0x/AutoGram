//! MTProto Client Wrapper

use super::session::SessionMetadata;

pub struct MtprotoClientWrapper {
    pub session: SessionMetadata,
}

impl MtprotoClientWrapper {
    pub fn new(session: SessionMetadata) -> Self {
        Self { session }
    }
}
