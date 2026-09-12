use super::{extraction, jobs::Job, model::Entry, policy::Policy, transport::{is_markup, read_text, Response, Session, Transport}};
use std::collections::{HashSet, VecDeque};
use url::Url;

type PageResult = (Url, u32, Result<(Url, Response), String>);

/// Bounded breadth-first discovery. Transfer/download is deliberately outside this
/// module: a crawler result is a candidate until the user explicitly selects it.
pub fn run<T: Transport>(policy: &Policy, job: &Job, transport: &T) -> Result<bool, String> {
    let session = Session::new(policy, job, transport);
    let mut queue: VecDeque<(Url, u32)> = policy.seeds.iter().cloned().map(|url| (url, 0)).collect();
    let mut visited = HashSet::new();
    let mut emitted = HashSet::new();
    let mut limited = false;
    while !queue.is_empty() {
        job.checkpoint()?;
        let mut work = Vec::new();
        while work.len() < policy.request.concurrency {
            let Some((url, depth)) = queue.pop_front() else { break; };
            if visited.len() >= policy.request.max_pages { limited = true; break; }
            if !visited.insert(url.clone()) { continue; }
            work.push((url, depth));
        }
        if work.is_empty() { break; }
        job.update(|snapshot| { snapshot.pages_visited = visited.len(); snapshot.pages_queued = queue.len(); });
        let results: Vec<PageResult> = std::thread::scope(|scope| {
            work.iter().map(|(url, depth)| {
                scope.spawn(|| (url.clone(), *depth, session.fetch(url)))
            })
                .collect::<Vec<_>>().into_iter().map(|handle| handle.join()
                    .unwrap_or_else(|_| (work[0].0.clone(), work[0].1, Err("remote_crawl_worker_failed".into()))))
                .collect()
        });
        for (url, depth, fetched) in results {
        let (final_url, response) = match fetched {
            Ok(value) => value,
            Err(error) if error == "remote_crawl_robots_denied" || error == "remote_crawl_scope" => {
                job.update(|s| s.blocked += 1); continue;
            }
            Err(_) => { job.update(|s| s.errors += 1); continue; }
        };
        if !is_markup(&response.mime) { continue; }
        let body = match read_text(response, super::transport::HTML_BYTES, job) {
            Ok(body) => body,
            Err(_) => { job.update(|s| s.errors += 1); continue; }
        };
        let mut found = extraction::extract(&final_url, &body, &policy.request.selector)?;
        super::rules::extract(&final_url, &body, &policy.request.rules, &mut found);
        job.update(|s| s.blocked += found.blocked);
        for candidate in found.candidates {
            job.checkpoint()?;
            let key = candidate.url.to_string();
            if candidate.traverse && depth < policy.request.max_depth && policy.in_scope(&candidate.url)
                && !policy.excluded(&candidate.url) && !visited.contains(&candidate.url) {
                queue.push_back((candidate.url.clone(), depth + 1));
            }
            if !candidate.selected || !policy.accepts(&candidate.url, &candidate.kind) || !emitted.insert(key.clone()) { 
                if emitted.contains(&key) { job.update(|s| s.duplicates += 1); }
                continue;
            }
            if emitted.len() > policy.request.max_results { limited = true; break; }
            let filename = candidate.url.path().rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or("download.bin");
            job.update(|s| s.entries.push(Entry { id: format!("crawl-{}", s.entries.len()), url: key,
                source_url: final_url.to_string(), filename: filename.chars().take(180).collect(), kind: candidate.kind, depth }));
        }
        if limited { break; }
    }
        if limited { break; }
    }
    job.update(|s| s.pages_queued = queue.len());
    Ok(limited || visited.len() >= policy.request.max_pages)
}
