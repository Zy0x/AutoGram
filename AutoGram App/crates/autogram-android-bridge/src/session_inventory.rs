//! Offline filename inventory. Never parses, opens, or authenticates session contents.

use crate::BridgeSessionSummary;
use std::{collections::BTreeMap, fs, io, path::Path};

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Include junctions and other reparse points, not only symlink tags.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub(crate) fn scan(root: &Path) -> io::Result<Vec<BridgeSessionSummary>> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    let mut names = BTreeMap::<String, (bool, bool)>::new();
    for entry in fs::read_dir(root)? {
        // Fail explicitly rather than presenting a partial listing as complete.
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if is_link(&metadata) || !metadata.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let (name, native) = if let Some(name) = file_name.strip_suffix(".grammers.json") {
            (name, true)
        } else if let Some(name) = file_name.strip_suffix(".session") {
            (name, false)
        } else {
            continue;
        };
        if name.trim().is_empty() || name.ends_with("_preview") {
            continue;
        }
        let sources = names.entry(name.to_string()).or_default();
        if native {
            sources.0 = true;
        } else {
            sources.1 = true;
        }
    }
    Ok(names
        .into_iter()
        .map(|(name, (native, legacy))| BridgeSessionSummary {
            name,
            status: if native {
                "unverified"
            } else {
                "migration_required"
            }
            .into(),
            source: match (native, legacy) {
                (true, true) => "grammers+migration_source",
                (true, false) => "grammers",
                _ => "telethon_migration_source",
            }
            .into(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("autogram-inventory-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }

        fn file(&self, name: &str) {
            fs::write(self.0.join(name), b"invalid-session-dummy-content").unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Only the UUID directory created by this test, never a runtime root.
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn inventory_is_sorted_deduplicated_and_never_claims_authorization() {
        let fixture = Fixture::new();
        for name in [
            "Primary.grammers.json",
            "Both.session",
            "Both.grammers.json",
            "Legacy.session",
        ] {
            fixture.file(name);
        }
        let items = scan(&fixture.0).unwrap();
        assert_eq!(
            items
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["Both", "Legacy", "Primary"]
        );
        assert_eq!(items[0].source, "grammers+migration_source");
        assert_eq!(items[0].status, "unverified");
        assert_eq!(items[1].source, "telethon_migration_source");
        assert_eq!(items[1].status, "migration_required");
        assert_eq!(items[2].source, "grammers");
        assert_eq!(items[2].status, "unverified");
    }

    #[test]
    fn ignores_directories_preview_empty_names_and_unrelated_files() {
        let fixture = Fixture::new();
        for name in [
            ".session",
            ".grammers.json",
            "  .session",
            "A_preview.session",
            "B_preview.grammers.json",
            "backup.session-journal",
            "file.json",
        ] {
            fixture.file(name);
        }
        fs::create_dir(fixture.0.join("Fake.session")).unwrap();
        fs::create_dir(fixture.0.join("Fake.grammers.json")).unwrap();
        assert!(scan(&fixture.0).unwrap().is_empty());
    }

    #[test]
    fn missing_is_empty_but_invalid_root_is_an_error() {
        let fixture = Fixture::new();
        assert!(scan(&fixture.0.join("missing")).unwrap().is_empty());
        fixture.file("not-a-directory");
        assert!(scan(&fixture.0.join("not-a-directory")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn ignores_linked_files_and_rejects_linked_inventory_root() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fixture.file("payload");
        symlink(fixture.0.join("payload"), fixture.0.join("Fake.session")).unwrap();
        symlink(fixture.0.join("missing"), fixture.0.join("Broken.session")).unwrap();
        symlink(&fixture.0, fixture.0.join("redirect")).unwrap();
        assert!(scan(&fixture.0).unwrap().is_empty());
        assert!(scan(&fixture.0.join("redirect")).is_err());
    }
}
