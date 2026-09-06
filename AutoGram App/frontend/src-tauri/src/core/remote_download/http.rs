use super::Job;
use std::{fs::OpenOptions, io::{Read, Seek, SeekFrom, Write}, net::{IpAddr, SocketAddr, ToSocketAddrs}, path::Path, sync::atomic::{AtomicBool, AtomicU64, Ordering}, time::Duration};

const CHUNK: u64 = 4 * 1024 * 1024;

pub(super) fn validate_url(raw: &str) -> Result<(), String> {
    #[cfg(test)]
    if raw.starts_with("http://127.0.0.1:") { return Ok(()); }
    crate::core::remote_link_resolver::ensure_public_remote_url(raw)
        .map_err(|_| "remote_download_invalid_url".into())
}

fn public_ip(ip: IpAddr) -> bool {
    #[cfg(test)]
    if ip.is_loopback() { return true; }
    match ip {
        IpAddr::V4(v) => !v.is_private() && !v.is_loopback() && !v.is_link_local() && !v.is_broadcast()
            && !v.is_unspecified() && !v.is_multicast() && v.octets()[0] != 0
            && !(v.octets()[0] == 100 && (64..=127).contains(&v.octets()[1])),
        IpAddr::V6(v) => v.to_ipv4_mapped().map(|v| public_ip(v.into())).unwrap_or_else(||
            !v.is_loopback() && !v.is_unspecified() && !v.is_unique_local() && !v.is_unicast_link_local() && !v.is_multicast()),
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().redirects(0)
        .timeout_connect(Duration::from_secs(5)).timeout_read(Duration::from_secs(3))
        .timeout_write(Duration::from_secs(3))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36")
        .resolver(|host: &str| -> std::io::Result<Vec<SocketAddr>> {
            let addresses: Vec<_> = host.to_socket_addrs()?.filter(|a| public_ip(a.ip())).collect();
            if addresses.is_empty() { return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "public DNS required")); }
            Ok(addresses)
        }).build()
}

fn get(agent: &ureq::Agent, url: &str, range: Option<&str>, validator: Option<&str>, job: &Job) -> Result<ureq::Response, String> {
    let mut current = url.to_string();
    for _ in 0..6 {
        job.checkpoint()?;
        validate_url(&current)?;
        let parsed = url::Url::parse(&current).map_err(|_| "remote_download_invalid_url")?;
        let host = parsed.host_str().unwrap_or("");
        let referer = if host == "googlevideo.com" || host.ends_with(".googlevideo.com") { "https://www.youtube.com/".into() }
            else if host.ends_with("tiktokcdn.com") || host.ends_with("tiktok.com") { "https://www.tiktok.com/".into() }
            else { format!("{}/", parsed.origin().ascii_serialization()) };
        let mut request = agent.get(&current).set("Accept-Encoding", "identity").set("Referer", &referer);
        if let Some(range) = range { request = request.set("Range", range); }
        if let Some(validator) = validator { request = request.set("If-Range", validator); }
        let response = request.call().map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("remote_download_http_{code}"),
            _ => "remote_download_network".into(), // Never expose signed URL in error messages.
        })?;
        if (300..400).contains(&response.status()) {
            current = parsed.join(response.header("Location").ok_or("remote_download_redirect")?)
                .map_err(|_| "remote_download_redirect")?.to_string();
            continue;
        }
        return Ok(response);
    }
    Err("remote_download_redirect".into())
}

fn range_tuple(raw: &str) -> Option<(u64, u64, u64)> {
    let (range, total) = raw.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?, total.parse().ok()?))
}

fn reject_wrapper(response: &ureq::Response) -> Result<(), String> {
    let mime = response.header("Content-Type").unwrap_or("").to_ascii_lowercase();
    if ["text/html", "application/xhtml", "mpegurl", "dash+xml"].iter().any(|m| mime.contains(m)) {
        return Err("remote_download_not_file".into());
    }
    if response.header("Content-Encoding").is_some_and(|v| v != "identity") {
        return Err("remote_download_encoding".into());
    }
    Ok(())
}

pub(super) fn download(url: &str, output: &Path, connections: usize, job: &Job) -> Result<(), String> {
    let agent = agent();
    let probe = get(&agent, url, Some("bytes=0-0"), None, job)?;
    reject_wrapper(&probe)?;
    let ranged = probe.status() == 206;
    let total = if ranged {
        let (start, end, total) = range_tuple(probe.header("Content-Range").unwrap_or("")).ok_or("remote_download_range")?;
        if start != 0 || end != 0 || total == 0 { return Err("remote_download_range".into()); }
        total
    } else if probe.status() == 200 {
        probe.header("Content-Length").and_then(|s| s.parse().ok()).unwrap_or(0)
    } else { return Err("remote_download_range".into()); };
    let validator = probe.header("ETag").filter(|v| !v.starts_with("W/"))
        .or_else(|| probe.header("Last-Modified")).map(str::to_owned);
    job.update(|s| s.total += total);
    let mut file = OpenOptions::new().write(true).read(true).create_new(true).open(output).map_err(|_| "remote_download_disk_error")?;
    if !ranged {
        // Servers ignoring Range use one response; never append duplicate whole objects.
        let mut reader = probe.into_reader();
        let mut downloaded = 0u64;
        let mut buffer = vec![0u8; 128 * 1024];
        loop {
            job.checkpoint()?;
            let n = reader.read(&mut buffer).map_err(|_| "remote_download_network")?;
            if n == 0 { break; }
            reject_prefix(&buffer[..n], downloaded)?;
            if total > 0 && downloaded + n as u64 > total { return Err("remote_download_size_mismatch".into()); }
            job.checkpoint()?;
            file.write_all(&buffer[..n]).map_err(|_| "remote_download_disk_error")?;
            downloaded += n as u64;
            job.update(|s| s.downloaded += n as u64);
        }
        if total > 0 && downloaded != total { return Err("remote_download_size_mismatch".into()); }
        file.sync_all().map_err(|_| "remote_download_disk_error")?;
        return Ok(());
    }
    drop(probe);
    file.set_len(total).map_err(|_| "remote_download_disk_error")?;
    // Dynamic chunk scheduling keeps fast sockets busy without consuming RAM per file.
    let next = AtomicU64::new(0);
    let failed = AtomicBool::new(false);
    let errors = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..connections.clamp(1, 8).min(total.div_ceil(CHUNK) as usize) {
            let agent = &agent;
            let next = &next;
            let failed = &failed;
            let errors = &errors;
            let validator = validator.as_deref();
            scope.spawn(move || {
                let result = (|| {
                    let mut file = OpenOptions::new().write(true).open(output).map_err(|_| "remote_download_disk_error")?;
                    while !failed.load(Ordering::Relaxed) {
                        job.checkpoint()?;
                        let start = next.fetch_add(CHUNK, Ordering::Relaxed);
                        if start >= total { break; }
                        let end = (start + CHUNK).min(total) - 1;
                        let mut offset = start;
                        let mut last_error = "remote_download_network".to_string();
                        for attempt in 0..4 {
                            job.checkpoint()?;
                            if failed.load(Ordering::Relaxed) { return Ok(()); }
                            let part = (|| {
                                let response = get(agent, url, Some(&format!("bytes={offset}-{end}")), validator, job)?;
                                reject_wrapper(&response)?;
                                if response.status() != 206 || range_tuple(response.header("Content-Range").unwrap_or("")) != Some((offset, end, total)) {
                                    return Err("remote_download_range".into());
                                }
                                if let Some(expected) = validator {
                                    let actual = response.header("ETag").filter(|v| !v.starts_with("W/"))
                                        .or_else(|| response.header("Last-Modified"));
                                    if actual != Some(expected) { return Err("remote_download_source_changed".into()); }
                                }
                                let mut reader = response.into_reader();
                                file.seek(SeekFrom::Start(offset)).map_err(|_| "remote_download_disk_error")?;
                                let mut buffer = vec![0u8; 128 * 1024];
                                while offset <= end {
                                    job.checkpoint()?;
                                    if failed.load(Ordering::Relaxed) { return Ok(()); }
                                    let length = buffer.len().min((end - offset + 1) as usize);
                                    let n = reader.read(&mut buffer[..length]).map_err(|_| "remote_download_network")?;
                                    if n == 0 { return Err("remote_download_size_mismatch".into()); }
                                    reject_prefix(&buffer[..n], offset)?;
                                    job.checkpoint()?;
                                    file.write_all(&buffer[..n]).map_err(|_| "remote_download_disk_error")?;
                                    offset += n as u64;
                                    job.update(|s| s.downloaded += n as u64);
                                }
                                Ok::<_, String>(())
                            })();
                            match part {
                                Ok(()) => break,
                                Err(error) if error == "remote_download_network" || error == "remote_download_size_mismatch" => last_error = error,
                                Err(error) => return Err(error),
                            }
                            for _ in 0..(attempt + 1) * 2 {
                                job.checkpoint()?;
                                std::thread::sleep(Duration::from_millis(100));
                            }
                        }
                        if offset <= end { return Err(last_error); }
                    }
                    file.sync_all().map_err(|_| "remote_download_disk_error")?;
                    Ok::<_, String>(())
                })();
                if let Err(error) = result { failed.store(true, Ordering::Relaxed); errors.lock().unwrap().push(error); }
            });
        }
    });
    let error = errors.into_inner().unwrap().into_iter().next();
    if let Some(error) = error { return Err(error); }
    job.checkpoint()?;
    file.sync_all().map_err(|_| "remote_download_disk_error")?;
    Ok(())
}

fn reject_prefix(bytes: &[u8], offset: u64) -> Result<(), String> {
    if offset != 0 { return Ok(()); }
    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(128)]).trim_start().to_ascii_lowercase();
    if prefix.starts_with("#extm3u") || prefix.starts_with("<mpd") || prefix.starts_with("<!doctype html") || prefix.starts_with("<html") {
        return Err("remote_download_not_file".into());
    }
    Ok(())
}
