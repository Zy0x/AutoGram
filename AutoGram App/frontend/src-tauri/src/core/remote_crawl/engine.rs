use super::{
    extraction, jobs::Job, model::Entry, policy::Policy,
    transport::{is_markup, read_text, Response, Session, Transport},
};
use std::collections::{HashSet, VecDeque};
use url::Url;

type PageResult = (u32, Result<(Url, Response), String>);

/// Bounded breadth-first discovery. Downloads require a separate user selection.
pub fn run<T: Transport>(policy: &Policy, job: &Job, transport: &T) -> Result<bool, String> {
    let session = Session::new(policy, job, transport);
    let mut scheduled = HashSet::new();
    let mut queue = VecDeque::new();
    let mut limited = false;
    for url in &policy.seeds {
        if scheduled.contains(url) { continue; }
        if scheduled.len() == policy.request.max_pages {
            limited = true;
            continue;
        }
        scheduled.insert(url.clone());
        queue.push_back((url.clone(), 0));
    }
    let mut visited = 0;
    let mut emitted = HashSet::new();
    while !queue.is_empty() {
        job.checkpoint()?;
        let work: Vec<_> = (0..policy.request.concurrency).filter_map(|_| queue.pop_front()).collect();
        visited += work.len();
        job.update(|s| { s.pages_visited = visited; s.pages_queued = queue.len(); });
        let results: Vec<PageResult> = std::thread::scope(|scope| {
            work.iter().map(|(url, depth)| {
                scope.spawn(|| (*depth, session.fetch(url)))
            }).collect::<Vec<_>>().into_iter().map(|handle| handle.join()
                .unwrap_or_else(|_| (0, Err("remote_crawl_worker_failed".into())))).collect()
        });
        // Reaching the page budget stops scheduling, not processing this wave.
        for (depth, fetched) in results {
            job.checkpoint()?;
            let (final_url, response) = match fetched {
                Ok(value) => value,
                Err(error) if error == "remote_crawl_robots_denied" || error == "remote_crawl_scope" => {
                    job.update(|s| s.blocked += 1);
                    continue;
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
                if candidate.traverse && depth < policy.request.max_depth
                    && policy.in_scope(&candidate.url) && !policy.excluded(&candidate.url)
                    && !scheduled.contains(&candidate.url) {
                    // Deduplicate at enqueue time and cap the entire frontier.
                    if scheduled.len() < policy.request.max_pages {
                        scheduled.insert(candidate.url.clone());
                        queue.push_back((candidate.url.clone(), depth + 1));
                    } else {
                        limited = true;
                    }
                }
                if !candidate.selected || !policy.accepts(&candidate.url, &candidate.kind) { continue; }
                let key = candidate.url.to_string();
                if emitted.contains(&key) { job.update(|s| s.duplicates += 1); continue; }
                if emitted.len() == policy.request.max_results {
                    job.update(|s| s.pages_queued = queue.len());
                    return Ok(true);
                }
                emitted.insert(key.clone());
                let filename = candidate.url.path().rsplit('/').next()
                    .filter(|s| !s.is_empty()).unwrap_or("download.bin");
                job.update(|s| s.entries.push(Entry {
                    id: format!("crawl-{}", s.entries.len()), url: key,
                    source_url: final_url.to_string(), filename: filename.chars().take(180).collect(),
                    kind: candidate.kind, depth,
                }));
            }
        }
    }
    job.update(|s| s.pages_queued = 0);
    Ok(limited)
}
