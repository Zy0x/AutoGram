use super::{UploadError, UploadFileSnapshot, UPLOAD_PART_BYTES};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};
use tokio_util::sync::CancellationToken;

fn open_regular(path: &Path) -> Result<File, UploadError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| UploadError::Io)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || std::fs::canonicalize(path).map_err(|_| UploadError::Io)? != path
    {
        return Err(UploadError::SourceChanged);
    }
    File::open(path).map_err(|_| UploadError::Io)
}
/// Run on a blocking thread. Buffer bounded to one MTProto part, never the full file.
pub fn snapshot_upload_file(path: &Path) -> Result<UploadFileSnapshot, UploadError> {
    snapshot_upload_file_cancellable(path, &CancellationToken::new())
}

/// Cancels bounded hashing before queue admission, without publishing a partial snapshot.
pub fn snapshot_upload_file_cancellable(
    path: &Path,
    cancel: &CancellationToken,
) -> Result<UploadFileSnapshot, UploadError> {
    if cancel.is_cancelled() {
        return Err(UploadError::Cancelled);
    }
    let mut file = open_regular(path)?;
    let size = file.metadata().map_err(|_| UploadError::Io)?.len();
    if size == 0 || size > UPLOAD_PART_BYTES as u64 * 8000 {
        return Err(UploadError::InvalidRequest);
    }
    let mut sha = Sha256::new();
    let mut md5 = md5::Context::new();
    let mut parts = Vec::new();
    let mut buffer = vec![0; UPLOAD_PART_BYTES];
    let mut total = 0;
    while total < size {
        if cancel.is_cancelled() {
            return Err(UploadError::Cancelled);
        }
        let length = (size - total).min(UPLOAD_PART_BYTES as u64) as usize;
        file.read_exact(&mut buffer[..length])
            .map_err(|_| UploadError::SourceChanged)?;
        sha.update(&buffer[..length]);
        md5.consume(&buffer[..length]);
        parts.push(hex::encode(Sha256::digest(&buffer[..length])));
        total += length as u64;
    }
    let mut extra = [0];
    if file.read(&mut extra).map_err(|_| UploadError::Io)? != 0 {
        return Err(UploadError::SourceChanged);
    }
    let snapshot = UploadFileSnapshot {
        path: path.to_owned(),
        size,
        sha256: hex::encode(sha.finalize()),
        md5: format!("{:x}", md5.finalize()),
        part_sha256: parts,
    };
    if cancel.is_cancelled() {
        return Err(UploadError::Cancelled);
    }
    snapshot.validate()?;
    Ok(snapshot)
}

pub(super) struct UploadSource {
    file: File,
    snapshot: UploadFileSnapshot,
}
impl UploadSource {
    pub fn open(snapshot: &UploadFileSnapshot) -> Result<Self, UploadError> {
        snapshot.validate()?;
        let file = open_regular(&snapshot.path)?;
        if file.metadata().map_err(|_| UploadError::Io)?.len() != snapshot.size {
            return Err(UploadError::SourceChanged);
        }
        Ok(Self {
            file,
            snapshot: snapshot.clone(),
        })
    }
    pub fn part(&mut self, index: usize) -> Result<Vec<u8>, UploadError> {
        let expected = self
            .snapshot
            .part_sha256
            .get(index)
            .ok_or(UploadError::InvalidRequest)?;
        let offset = index as u64 * UPLOAD_PART_BYTES as u64;
        let mut buffer =
            vec![0; (self.snapshot.size - offset).min(UPLOAD_PART_BYTES as u64) as usize];
        self.file
            .seek(SeekFrom::Start(offset))
            .map_err(|_| UploadError::Io)?;
        self.file
            .read_exact(&mut buffer)
            .map_err(|_| UploadError::SourceChanged)?;
        if hex::encode(Sha256::digest(&buffer)) != *expected {
            return Err(UploadError::SourceChanged);
        }
        Ok(buffer)
    }
    pub fn verify_all(&mut self, cancel: &CancellationToken) -> Result<(), UploadError> {
        if self.file.metadata().map_err(|_| UploadError::Io)?.len() != self.snapshot.size {
            return Err(UploadError::SourceChanged);
        }
        let mut sha = Sha256::new();
        let mut md5 = md5::Context::new();
        for part in 0..self.snapshot.parts() {
            if cancel.is_cancelled() {
                return Err(UploadError::Cancelled);
            }
            let bytes = self.part(part)?;
            sha.update(&bytes);
            md5.consume(&bytes);
        }
        if hex::encode(sha.finalize()) != self.snapshot.sha256
            || format!("{:x}", md5.finalize()) != self.snapshot.md5
        {
            return Err(UploadError::SourceChanged);
        }
        Ok(())
    }
}
