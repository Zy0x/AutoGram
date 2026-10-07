use super::*;

#[test]
fn extracts_multiple_distinct_urls_without_trailing_punctuation() {
    assert_eq!(
        extract_http_urls(
            "See https://example.com/a, then https://t.me/demo. https://example.com/a"
        ),
        vec![
            "https://example.com/a".to_string(),
            "https://t.me/demo".to_string()
        ]
    );
}

#[test]
fn extracts_utf16_entity_ranges_and_normalizes_bare_urls() {
    let text = "😀 visit example.com now";
    assert_eq!(utf16_slice(text, 9, 11).as_deref(), Some("example.com"));
    assert_eq!(
        normalize_entity_url("example.com/path").as_deref(),
        Some("https://example.com/path")
    );
    assert_eq!(
        normalize_entity_url("tg://resolve?domain=telegram").as_deref(),
        Some("tg://resolve?domain=telegram")
    );
}

#[test]
fn native_delivery_uses_telegram_attributes_not_filename_extension() {
    use grammers_client::tl::{enums::DocumentAttribute, types::DocumentAttributeVideo};

    let native_video = DocumentAttribute::Video(DocumentAttributeVideo {
        round_message: false,
        supports_streaming: true,
        nosound: false,
        duration: 1.0,
        w: 1280,
        h: 720,
        preload_prefix_size: None,
        video_start_ts: None,
        video_codec: None,
    });
    assert!(has_native_delivery(&[native_video]));
    assert!(!has_native_delivery(&[DocumentAttribute::Filename(
        grammers_client::tl::types::DocumentAttributeFilename {
            file_name: "sent-as-file.mp4".to_string(),
        }
    ),]));
    assert_eq!(
        fallback_document_name(19024, Some("video/mp4"), true),
        "video_19024.mp4"
    );
    assert_eq!(
        fallback_document_name(19024, Some("video/mp4"), false),
        "file_19024.mp4"
    );
}

#[test]
fn plain_mentions_are_not_catalog_urls() {
    assert!(extract_http_urls("@thuandmuda").is_empty());
    assert!(extract_http_urls("plain Telegram service text").is_empty());
    assert_eq!(
        extract_http_urls("source https://t.me/thuandmuda"),
        vec!["https://t.me/thuandmuda".to_string()]
    );
}

#[test]
fn telegram_photo_name_never_uses_caption_as_extension() {
    assert_eq!(canonical_photo_name(43_639), "photo_43639.jpg");
    assert_eq!(canonical_photo_name(6), "photo_6.jpg");
}

fn dummy_row(id: i64) -> MediaFileRow {
    MediaFileRow {
        id,
        folder_id: None,
        name: format!("file_{}.dat", id),
        size: 1024,
        mime_type: Some("application/octet-stream".to_string()),
        icon_type: "file".to_string(),
        created_at: Some("1700000000".to_string()),
        has_thumb: false,
        as_document: true,
        backend: "grammers".to_string(),
        thumb_data_url: None,
        topic_id: None,
        identity_source: None,
        peer_id: None,
        account_id: None,
        peer_kind: None,
        peer_username: None,
        grouped_id: None,
        is_saved_messages: None,
        telegram_category: None,
        telegram_subtype: None,
        drive_category: None,
        drive_format: None,
    }
}

#[test]
fn test_normalize_search_cursor_scope_rejection_peer() {
    let stale = ScopedMediaSearchCursor {
        scope: SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: None,
            min_id: 0,
        },
        photo_video: LaneCursor {
            fetch_offset_id: 15000,
            exhausted: false,
        },
        document: LaneCursor {
            fetch_offset_id: 12000,
            exhausted: false,
        },
        pending_photo_video: vec![dummy_row(14999)],
        pending_document: vec![dummy_row(11999)],
    };

    let new_scope = SearchScope {
        account_id: "user_a".to_string(),
        peer_id: "100222222".to_string(),
        topic_id: None,
        min_id: 0,
    };

    let normalized = normalize_search_cursor(Some(stale), &new_scope, 0);
    assert_eq!(normalized.scope.peer_id, "100222222");
    assert_eq!(normalized.photo_video.fetch_offset_id, 0);
    assert_eq!(normalized.document.fetch_offset_id, 0);
    assert!(normalized.pending_photo_video.is_empty());
    assert!(normalized.pending_document.is_empty());
}

#[test]
fn test_normalize_search_cursor_scope_rejection_topic() {
    let stale = ScopedMediaSearchCursor {
        scope: SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: Some(42),
            min_id: 0,
        },
        photo_video: LaneCursor {
            fetch_offset_id: 9000,
            exhausted: false,
        },
        document: LaneCursor {
            fetch_offset_id: 8000,
            exhausted: false,
        },
        pending_photo_video: vec![],
        pending_document: vec![],
    };

    let new_scope = SearchScope {
        account_id: "user_a".to_string(),
        peer_id: "100111111".to_string(),
        topic_id: Some(99),
        min_id: 0,
    };

    let normalized = normalize_search_cursor(Some(stale), &new_scope, 0);
    assert_eq!(normalized.scope.topic_id, Some(99));
    assert_eq!(normalized.photo_video.fetch_offset_id, 0);
    assert_eq!(normalized.document.fetch_offset_id, 0);
}

#[test]
fn test_normalize_search_cursor_scope_rejection_account() {
    let stale = ScopedMediaSearchCursor {
        scope: SearchScope {
            account_id: "account_1".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: None,
            min_id: 0,
        },
        photo_video: LaneCursor {
            fetch_offset_id: 5000,
            exhausted: false,
        },
        document: LaneCursor {
            fetch_offset_id: 4000,
            exhausted: false,
        },
        pending_photo_video: vec![],
        pending_document: vec![],
    };

    let new_scope = SearchScope {
        account_id: "account_2".to_string(),
        peer_id: "100111111".to_string(),
        topic_id: None,
        min_id: 0,
    };

    let normalized = normalize_search_cursor(Some(stale), &new_scope, 0);
    assert_eq!(normalized.scope.account_id, "account_2");
    assert_eq!(normalized.photo_video.fetch_offset_id, 0);
}

#[test]
fn test_normalize_search_cursor_scope_rejection_min_id() {
    // Delta baseline change (e.g. historical min_id 0 -> delta min_id 10000)
    let stale = ScopedMediaSearchCursor {
        scope: SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: None,
            min_id: 0,
        },
        photo_video: LaneCursor {
            fetch_offset_id: 5000,
            exhausted: false,
        },
        document: LaneCursor {
            fetch_offset_id: 4000,
            exhausted: false,
        },
        pending_photo_video: vec![],
        pending_document: vec![],
    };

    let delta_scope = SearchScope {
        account_id: "user_a".to_string(),
        peer_id: "100111111".to_string(),
        topic_id: None,
        min_id: 10000,
    };

    let normalized = normalize_search_cursor(Some(stale), &delta_scope, 0);
    assert_eq!(normalized.scope.min_id, 10000);
    assert_eq!(normalized.photo_video.fetch_offset_id, 0);
    assert_eq!(normalized.document.fetch_offset_id, 0);
}

#[test]
fn test_normalize_search_cursor_scope_retain_matching() {
    let valid = ScopedMediaSearchCursor {
        scope: SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: None,
            min_id: 0,
        },
        photo_video: LaneCursor {
            fetch_offset_id: 901,
            exhausted: false,
        },
        document: LaneCursor {
            fetch_offset_id: 701,
            exhausted: false,
        },
        pending_photo_video: vec![dummy_row(900)],
        pending_document: vec![dummy_row(700)],
    };

    let scope = SearchScope {
        account_id: "user_a".to_string(),
        peer_id: "100111111".to_string(),
        topic_id: None,
        min_id: 0,
    };

    let normalized = normalize_search_cursor(Some(valid), &scope, 0);
    assert_eq!(normalized.photo_video.fetch_offset_id, 901);
    assert_eq!(normalized.document.fetch_offset_id, 701);
    assert_eq!(normalized.pending_photo_video.len(), 1);
    assert_eq!(normalized.pending_document.len(), 1);
}

#[test]
fn test_buffered_k_way_merge_exact_page_size() {
    // Synthetic stream:
    // PV: 1000, 990, 980, 970, 960
    // DOC: 995, 985, 975, 965, 955
    let mut pv = vec![
        dummy_row(1000),
        dummy_row(990),
        dummy_row(980),
        dummy_row(970),
        dummy_row(960),
    ];
    let mut doc = vec![
        dummy_row(995),
        dummy_row(985),
        dummy_row(975),
        dummy_row(965),
        dummy_row(955),
    ];

    // Page 1 with limit = 4
    let page1 = buffered_k_way_merge(&mut pv, &mut doc, 4);
    let ids1: Vec<i64> = page1.iter().map(|f| f.row.id).collect();
    assert_eq!(ids1, vec![1000, 995, 990, 985]);
    assert_eq!(pv.len(), 3); // 980, 970, 960
    assert_eq!(doc.len(), 3); // 975, 965, 955

    // Page 2 with limit = 4
    let page2 = buffered_k_way_merge(&mut pv, &mut doc, 4);
    let ids2: Vec<i64> = page2.iter().map(|f| f.row.id).collect();
    assert_eq!(ids2, vec![980, 975, 970, 965]);
    assert_eq!(pv.len(), 1); // 960
    assert_eq!(doc.len(), 1); // 955

    // Page 3 with limit = 4
    let page3 = buffered_k_way_merge(&mut pv, &mut doc, 4);
    let ids3: Vec<i64> = page3.iter().map(|f| f.row.id).collect();
    assert_eq!(ids3, vec![960, 955]);
    assert_eq!(pv.len(), 0);
    assert_eq!(doc.len(), 0);

    // Combined verification: zero missing, zero duplicate, sorted descending
    let mut all_ids = Vec::new();
    all_ids.extend(ids1);
    all_ids.extend(ids2);
    all_ids.extend(ids3);
    assert_eq!(
        all_ids,
        vec![1000, 995, 990, 985, 980, 975, 970, 965, 960, 955]
    );
}

#[test]
fn test_buffered_k_way_merge_overlap_deduplication() {
    // PV: 1000, 990, 980
    // DOC: 995, 990, 985
    let mut pv = vec![dummy_row(1000), dummy_row(990), dummy_row(980)];
    let mut doc = vec![dummy_row(995), dummy_row(990), dummy_row(985)];

    let page = buffered_k_way_merge(&mut pv, &mut doc, 10);
    let ids: Vec<i64> = page.iter().map(|f| f.row.id).collect();
    assert_eq!(ids, vec![1000, 995, 990, 985, 980]);
    // Message ID 990 appears only once!
    assert_eq!(ids.iter().filter(|&&id| id == 990).count(), 1);
    assert_eq!(
        page.iter().find(|item| item.row.id == 990).unwrap().lane,
        SearchLane::Both
    );
}

#[test]
fn test_overlap_exactly_at_page_boundary() {
    // PV = [1000, 900]
    // DOC = [1000, 800]
    // limit = 1
    let mut pv = vec![dummy_row(1000), dummy_row(900)];
    let mut doc = vec![dummy_row(1000), dummy_row(800)];

    // Page 1: Must pop both 1000 from PV and DOC simultaneously and emit only once with SearchLane::Both
    let p1 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert_eq!(p1.len(), 1);
    assert_eq!(p1[0].row.id, 1000);
    assert_eq!(p1[0].lane, SearchLane::Both);
    assert_eq!(pv.len(), 1); // 900
    assert_eq!(doc.len(), 1); // 800

    // Page 2: Must emit 900 from PV
    let p2 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert_eq!(p2.len(), 1);
    assert_eq!(p2[0].row.id, 900);
    assert_eq!(p2[0].lane, SearchLane::PhotoVideo);
    assert_eq!(pv.len(), 0);
    assert_eq!(doc.len(), 1); // 800

    // Page 3: Must emit 800 from DOC
    let p3 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert_eq!(p3.len(), 1);
    assert_eq!(p3[0].row.id, 800);
    assert_eq!(p3[0].lane, SearchLane::Document);
    assert_eq!(pv.len(), 0);
    assert_eq!(doc.len(), 0);

    // Page 4: Exhausted
    let p4 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert!(p4.is_empty());

    let mut all_ids = Vec::new();
    all_ids.extend(p1.iter().map(|f| f.row.id));
    all_ids.extend(p2.iter().map(|f| f.row.id));
    all_ids.extend(p3.iter().map(|f| f.row.id));
    assert_eq!(all_ids, vec![1000, 900, 800]);
    // 1000 appeared strictly once across page boundaries!
    assert_eq!(all_ids.iter().filter(|&&id| id == 1000).count(), 1);
}

#[test]
fn test_buffered_k_way_merge_uneven_lanes() {
    // PV: 1000, 900, 800, 700, 600
    // DOC: 5000
    let mut pv = vec![
        dummy_row(1000),
        dummy_row(900),
        dummy_row(800),
        dummy_row(700),
        dummy_row(600),
    ];
    let mut doc = vec![dummy_row(5000)];

    let page1 = buffered_k_way_merge(&mut pv, &mut doc, 2);
    let ids1: Vec<i64> = page1.iter().map(|f| f.row.id).collect();
    assert_eq!(ids1, vec![5000, 1000]);

    let page2 = buffered_k_way_merge(&mut pv, &mut doc, 10);
    let ids2: Vec<i64> = page2.iter().map(|f| f.row.id).collect();
    assert_eq!(ids2, vec![900, 800, 700, 600]);
}

#[test]
fn test_buffered_k_way_merge_single_item_pages() {
    let mut pv = vec![dummy_row(300), dummy_row(100)];
    let mut doc = vec![dummy_row(200)];

    let p1 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert_eq!(p1[0].row.id, 300);

    let p2 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert_eq!(p2[0].row.id, 200);

    let p3 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert_eq!(p3[0].row.id, 100);

    let p4 = buffered_k_way_merge(&mut pv, &mut doc, 1);
    assert!(p4.is_empty());
}

#[test]
fn test_buffered_k_way_merge_exhaustion_conditions() {
    let cursor_running = ScopedMediaSearchCursor {
        scope: SearchScope {
            account_id: "a".to_string(),
            peer_id: "p".to_string(),
            topic_id: None,
            min_id: 0,
        },
        photo_video: LaneCursor {
            fetch_offset_id: 100,
            exhausted: false,
        },
        document: LaneCursor {
            fetch_offset_id: 1,
            exhausted: true,
        },
        pending_photo_video: vec![],
        pending_document: vec![],
    };

    let has_more = !cursor_running.photo_video.exhausted
        || !cursor_running.document.exhausted
        || !cursor_running.pending_photo_video.is_empty()
        || !cursor_running.pending_document.is_empty();
    assert_eq!(has_more, true);

    let cursor_exhausted = ScopedMediaSearchCursor {
        scope: SearchScope {
            account_id: "a".to_string(),
            peer_id: "p".to_string(),
            topic_id: None,
            min_id: 0,
        },
        photo_video: LaneCursor {
            fetch_offset_id: 1,
            exhausted: true,
        },
        document: LaneCursor {
            fetch_offset_id: 1,
            exhausted: true,
        },
        pending_photo_video: vec![],
        pending_document: vec![],
    };

    let has_more_final = !cursor_exhausted.photo_video.exhausted
        || !cursor_exhausted.document.exhausted
        || !cursor_exhausted.pending_photo_video.is_empty()
        || !cursor_exhausted.pending_document.is_empty();
    assert_eq!(has_more_final, false);
}

#[test]
fn test_frontier_scheduler_emits_without_refetch_when_safe() {
    let mut pv = vec![
        dummy_row(1050),
        dummy_row(1040),
        dummy_row(1030),
        dummy_row(1020),
    ];
    let mut doc = vec![];
    let mut emitted = Vec::new();

    // DOC frontier is 1000, not exhausted. All PV rows > 1000 are provably safe to emit!
    let step = drain_provably_safe_frontier(
        &mut pv,
        &mut doc,
        1000,
        1000,
        false,
        false,
        4,
        &mut emitted,
    );
    assert_eq!(emitted.len(), 4);
    let emitted_ids: Vec<i64> = emitted.iter().map(|f| f.row.id).collect();
    assert_eq!(emitted_ids, vec![1050, 1040, 1030, 1020]);
    assert!(pv.is_empty());
    assert_eq!(step, FrontierStep::Finished);
}

#[test]
fn test_frontier_scheduler_fetches_when_candidate_crosses_other_frontier() {
    let mut pv = vec![dummy_row(990)];
    let mut doc = vec![];
    let mut emitted = Vec::new();

    // DOC frontier is 1000, not exhausted. PV item 990 <= 1000 cannot be emitted blindly!
    let step = drain_provably_safe_frontier(
        &mut pv,
        &mut doc,
        1000,
        1000,
        false,
        false,
        4,
        &mut emitted,
    );
    assert_eq!(
        emitted.len(),
        0,
        "Candidate <= other frontier must NOT be emitted blindly"
    );
    assert_eq!(step, FrontierStep::FetchDoc);
    assert_eq!(pv.len(), 1);
}

#[test]
fn test_frontier_equal_boundary_requires_fetch() {
    let mut pv = vec![dummy_row(1000)];
    let mut doc = vec![];
    let mut emitted = Vec::new();

    // Boundary test: PV item 1000 == DOC frontier 1000. Strict inequality (> vs >=) MUST trigger FetchDoc!
    let step = drain_provably_safe_frontier(
        &mut pv,
        &mut doc,
        1000,
        1000,
        false,
        false,
        1,
        &mut emitted,
    );
    assert_eq!(emitted.len(), 0);
    assert_eq!(
        step,
        FrontierStep::FetchDoc,
        "Exact equal boundary must require fetching other lane"
    );
}

#[test]
fn test_unknown_initial_frontier_requires_fetch() {
    let mut pv = vec![dummy_row(5000)];
    let mut doc = vec![];
    let mut emitted = Vec::new();

    // doc_offset == 0 represents uninitialized/unknown frontier -> MUST FETCH DOC
    let step =
        drain_provably_safe_frontier(&mut pv, &mut doc, 5000, 0, false, false, 1, &mut emitted);
    assert_eq!(emitted.len(), 0);
    assert_eq!(step, FrontierStep::FetchDoc);
}

#[test]
fn test_existing_200_buffered_rows_can_serve_next_page_without_rpc() {
    let mut pv: Vec<MediaFileRow> = (101..=200).rev().map(dummy_row).collect();
    let mut doc: Vec<MediaFileRow> = (1..=100).rev().map(dummy_row).collect();

    let mut page1 = Vec::new();
    let step1 =
        drain_provably_safe_frontier(&mut pv, &mut doc, 100, 1, true, true, 100, &mut page1);
    assert_eq!(page1.len(), 100);
    assert_eq!(page1[0].row.id, 200);
    assert_eq!(page1[99].row.id, 101);
    assert_eq!(step1, FrontierStep::Finished);

    let mut page2 = Vec::new();
    let step2 =
        drain_provably_safe_frontier(&mut pv, &mut doc, 100, 1, true, true, 100, &mut page2);
    assert_eq!(page2.len(), 100);
    assert_eq!(page2[0].row.id, 100);
    assert_eq!(page2[99].row.id, 1);
    assert_eq!(step2, FrontierStep::Finished);

    assert!(pv.is_empty());
    assert!(doc.is_empty());
}

#[test]
fn test_one_exhausted_lane_never_refetched() {
    let mut pv = vec![];
    let mut doc = vec![];
    let mut emitted = Vec::new();

    // PV is exhausted, DOC is not -> scheduler MUST ONLY request FetchDoc
    let step =
        drain_provably_safe_frontier(&mut pv, &mut doc, 50, 50, true, false, 10, &mut emitted);
    assert_eq!(step, FrontierStep::FetchDoc);

    // DOC is exhausted, PV is not -> scheduler MUST ONLY request FetchPv
    let step2 =
        drain_provably_safe_frontier(&mut pv, &mut doc, 50, 50, false, true, 10, &mut emitted);
    assert_eq!(step2, FrontierStep::FetchPv);
}

#[test]
fn test_sparse_doc_lane_cannot_starve() {
    // PV has 100 items (1000..901). DOC has 1 item at 950 (matching PV 950 cross-lane duplicate).
    let mut pv: Vec<MediaFileRow> = (901..=1000).rev().map(dummy_row).collect();
    let mut doc: Vec<MediaFileRow> = vec![dummy_row(950)];
    let mut emitted = Vec::new();

    // 1. First drain: emits 1000..951 (50 items) + 950 (1 item from Both).
    // Since DOC buffer is now empty and doc_offset = 950, next PV candidate (949) <= 950 requires FetchDoc!
    let step1 = drain_provably_safe_frontier(
        &mut pv,
        &mut doc,
        901,
        950,
        true,
        false,
        100,
        &mut emitted,
    );
    assert_eq!(
        step1,
        FrontierStep::FetchDoc,
        "Scheduler must pause PV emission and fetch DOC at boundary"
    );
    assert_eq!(emitted.len(), 51); // 1000..951 (50 items) + 950 (1 item via EmitBoth)
    assert_eq!(emitted[0].row.id, 1000);
    assert_eq!(emitted[50].row.id, 950);
    assert_eq!(
        emitted[50].lane,
        SearchLane::Both,
        "Matching cross-lane 950 must be tagged Both and deduplicated"
    );

    // 2. DOC search completes and finds no more items (doc_exhausted = true)
    let step2 = drain_provably_safe_frontier(
        &mut pv,
        &mut doc,
        901,
        950,
        true,
        true,
        100,
        &mut emitted,
    );
    assert_eq!(step2, FrontierStep::Finished);
    assert_eq!(emitted.len(), 100); // exactly 100 unique items (950 deduplicated)
    assert_eq!(emitted[51].row.id, 949);
    assert_eq!(emitted[99].row.id, 901);
    assert!(pv.is_empty());
    assert!(doc.is_empty());
}

#[test]
fn test_frontier_scheduler_matches_full_reference_merge_scale() {
    for scale in [1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] {
        // Generate synthetic descending streams for PV and DOC
        let pv_all: Vec<MediaFileRow> = (1..=(scale as i64))
            .filter(|id| id % 2 == 0 || id % 7 == 0)
            .rev()
            .map(dummy_row)
            .collect();
        let doc_all: Vec<MediaFileRow> = (1..=(scale as i64))
            .filter(|id| id % 3 == 0 || id % 7 == 0)
            .rev()
            .map(dummy_row)
            .collect();

        // Reference merge: full concat, sort descending, dedup by ID
        let mut reference = Vec::with_capacity(pv_all.len() + doc_all.len());
        reference.extend(pv_all.iter().map(|r| r.id));
        reference.extend(doc_all.iter().map(|r| r.id));
        reference.sort_unstable_by(|a, b| b.cmp(a));
        reference.dedup();

        // Paginated simulated frontier scheduler merge using O(1) cursor indexing
        let mut emitted_stream = Vec::with_capacity(reference.len());
        let mut pending_pv = Vec::new();
        let mut pending_doc = Vec::new();
        let mut pv_cursor = 0usize;
        let mut doc_cursor = 0usize;
        let mut pv_offset = 0i32;
        let mut doc_offset = 0i32;
        let mut pv_exhausted = false;
        let mut doc_exhausted = false;

        let page_limit = 100usize;

        while emitted_stream.len() < reference.len() {
            let mut page_emitted = Vec::new();

            while page_emitted.len() < page_limit {
                let step = drain_provably_safe_frontier(
                    &mut pending_pv,
                    &mut pending_doc,
                    pv_offset,
                    doc_offset,
                    pv_exhausted,
                    doc_exhausted,
                    page_limit,
                    &mut page_emitted,
                );

                if page_emitted.len() >= page_limit || step == FrontierStep::Finished {
                    break;
                }

                match step {
                    FrontierStep::FetchBoth => {
                        // Replenish PV chunk in O(1) via slice
                        if !pv_exhausted {
                            let rem = pv_all.len() - pv_cursor;
                            let take_cnt = 100.min(rem);
                            if take_cnt > 0 {
                                let chunk = &pv_all[pv_cursor..pv_cursor + take_cnt];
                                pv_cursor += take_cnt;
                                if let Some(last) = chunk.last() {
                                    pv_offset = last.id as i32;
                                }
                                pending_pv.extend_from_slice(chunk);
                            }
                            if pv_cursor >= pv_all.len() {
                                pv_exhausted = true;
                            }
                        }
                        // Replenish DOC chunk in O(1) via slice
                        if !doc_exhausted {
                            let rem = doc_all.len() - doc_cursor;
                            let take_cnt = 100.min(rem);
                            if take_cnt > 0 {
                                let chunk = &doc_all[doc_cursor..doc_cursor + take_cnt];
                                doc_cursor += take_cnt;
                                if let Some(last) = chunk.last() {
                                    doc_offset = last.id as i32;
                                }
                                pending_doc.extend_from_slice(chunk);
                            }
                            if doc_cursor >= doc_all.len() {
                                doc_exhausted = true;
                            }
                        }
                    }
                    FrontierStep::FetchPv => {
                        if !pv_exhausted {
                            let rem = pv_all.len() - pv_cursor;
                            let take_cnt = 100.min(rem);
                            if take_cnt > 0 {
                                let chunk = &pv_all[pv_cursor..pv_cursor + take_cnt];
                                pv_cursor += take_cnt;
                                if let Some(last) = chunk.last() {
                                    pv_offset = last.id as i32;
                                }
                                pending_pv.extend_from_slice(chunk);
                            }
                            if pv_cursor >= pv_all.len() {
                                pv_exhausted = true;
                            }
                        }
                    }
                    FrontierStep::FetchDoc => {
                        if !doc_exhausted {
                            let rem = doc_all.len() - doc_cursor;
                            let take_cnt = 100.min(rem);
                            if take_cnt > 0 {
                                let chunk = &doc_all[doc_cursor..doc_cursor + take_cnt];
                                doc_cursor += take_cnt;
                                if let Some(last) = chunk.last() {
                                    doc_offset = last.id as i32;
                                }
                                pending_doc.extend_from_slice(chunk);
                            }
                            if doc_cursor >= doc_all.len() {
                                doc_exhausted = true;
                            }
                        }
                    }
                    _ => break,
                }
            }

            if page_emitted.is_empty() {
                break;
            }
            for item in page_emitted {
                emitted_stream.push(item.row.id);
            }
        }

        assert_eq!(
            emitted_stream.len(),
            reference.len(),
            "Scale {scale}: emitted count must match reference exactly"
        );
        assert_eq!(
            emitted_stream, reference,
            "Scale {scale}: emitted sequence must be 100% identical to reference descending order"
        );
    }
}

#[test]
fn test_truncate_first_line_multibyte_safe() {
    // Test Chinese characters (3 bytes per char) - crash was at byte index 60 (inside char '六')
    let chinese_caption = "这是一个很长的测试说明文字，用来测试六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六六";
    let res = truncate_first_line(chinese_caption, 60);
    assert!(res.ends_with('…'));
    assert_eq!(res.chars().count(), 61); // 60 chars + 1 ellipsis

    // Test Arabic characters (2 bytes per char) - crash was inside 'و'
    let arabic_caption = "وَاعْتَصِمُوا بِحَبْلِ اللَّهِ جَمِيعًا وَلَا تَفَرَّقُوا وَاذْكُرُوا نِعْمَتَ اللَّهِ عَلَيْكُمْ إِذْ كُنتُمْ أَعْدَاءً فَأَلَّفَ بَيْنَ قُلُوبِكُمْ";
    let res_ar = truncate_first_line(arabic_caption, 60);
    assert!(res_ar.ends_with('…'));
    assert_eq!(res_ar.chars().count(), 61);

    // Test emojis (4 bytes per char)
    let emoji_caption = "🚀🔥🎉✨🌟💡🛡️⚡🎯🎨".repeat(10);
    let res_emoji = truncate_first_line(&emoji_caption, 60);
    assert!(res_emoji.ends_with('…'));

    // Short string should not be truncated
    let short = "Hello World";
    assert_eq!(truncate_first_line(short, 60), "Hello World");
}

#[test]
fn test_preseeded_gif_does_not_skip_document_lane_on_initial_frontier() {
    // Regression test for #Gudang (U8542241823/D-1003214112048/T15415/52397):
    // When InputMessagesFilterGif pre-seeds an older GIF (id = 45000) into pending_document
    // before SearchLane::Document has been fetched (doc_offset == 0, doc_exhausted == false),
    // drain_provably_safe_frontier MUST return FrontierStep::FetchBoth (never FetchPv alone).
    let mut pending_pv = Vec::new();
    let mut pending_doc = vec![dummy_row(45000)];
    let mut emitted = Vec::new();

    let step0 = drain_provably_safe_frontier(
        &mut pending_pv,
        &mut pending_doc,
        0,
        0,
        false,
        false,
        10,
        &mut emitted,
    );
    assert_eq!(
        step0,
        FrontierStep::FetchBoth,
        "Pre-seeded GIF with doc_offset == 0 must still trigger FetchBoth so Document lane is queried"
    );
    assert!(emitted.is_empty());

    // Simulate FetchBoth: PV returns 52391..52388, DOC returns 52397..52392 and 52389 (doc_offset = 52389)
    pending_pv.extend([
        dummy_row(52391),
        dummy_row(52390),
        dummy_row(52388),
        dummy_row(52387),
    ]);
    pending_doc.extend([
        dummy_row(52397),
        dummy_row(52396),
        dummy_row(52395),
        dummy_row(52394),
        dummy_row(52393),
        dummy_row(52392),
        dummy_row(52389),
    ]);

    let step1 = drain_provably_safe_frontier(
        &mut pending_pv,
        &mut pending_doc,
        52387,
        52389,
        false,
        false,
        10,
        &mut emitted,
    );
    // Should emit 52397..52392 (6 docs), 52391..52390 (2 pvs), 52389 (1 doc) = 9 items,
    // and then pause at PV 52388 because 52388 <= doc_offset (52389) while the remaining
    // item in pending_doc is GIF 45000 (< 52389) and !doc_exhausted!
    assert_eq!(
        step1,
        FrontierStep::FetchDoc,
        "Once real documents >= doc_offset are drained, an older GIF (45000 < 52389) must not prevent FetchDoc"
    );
    let emitted_ids: Vec<i64> = emitted.iter().map(|m| m.row.id).collect();
    assert_eq!(
        emitted_ids,
        vec![52397, 52396, 52395, 52394, 52393, 52392, 52391, 52390, 52389]
    );
}

#[test]
fn test_row_matches_filtered_query_telegram_and_drive_perspectives() {
    // 1. Document-uploaded image (e.g. 52397: 20260510_060956.jpg in #Gudang)
    let mut doc_photo = dummy_row(52397);
    doc_photo.name = "20260510_060956.jpg".to_string();
    doc_photo.mime_type = Some("image/jpeg".to_string());
    doc_photo.icon_type = "image".to_string();
    doc_photo.as_document = true;
    doc_photo.telegram_category = Some("file".to_string());
    doc_photo.telegram_subtype = Some("doc_photo".to_string());
    doc_photo.drive_category = Some("image".to_string());

    // In Telegram perspective: belongs to "files", not "media" or "photos"
    assert!(row_matches_filtered_query(&doc_photo, "files"));
    assert!(!row_matches_filtered_query(&doc_photo, "media"));
    assert!(!row_matches_filtered_query(&doc_photo, "photos"));
    // In Drive perspective: belongs to "images", not "documents" or "archives"
    assert!(row_matches_filtered_query(&doc_photo, "images"));
    assert!(!row_matches_filtered_query(&doc_photo, "documents"));
    assert!(!row_matches_filtered_query(&doc_photo, "archives"));

    // 2. ZIP archive
    let mut zip_row = dummy_row(52000);
    zip_row.name = "backup.zip".to_string();
    zip_row.mime_type = Some("application/zip".to_string());
    zip_row.icon_type = "document".to_string();
    zip_row.as_document = true;
    zip_row.telegram_category = Some("file".to_string());
    zip_row.drive_category = Some("archive".to_string());

    assert!(row_matches_filtered_query(&zip_row, "files"));
    assert!(row_matches_filtered_query(&zip_row, "archives"));
    assert!(!row_matches_filtered_query(&zip_row, "documents"));
    assert!(!row_matches_filtered_query(&zip_row, "images"));

    // 3. Web / Link row
    let mut link_row = dummy_row(51000);
    link_row.name = "https://example.com".to_string();
    link_row.mime_type = Some("text/x-url".to_string());
    link_row.icon_type = "link".to_string();
    link_row.as_document = false;
    link_row.telegram_category = Some("link".to_string());
    link_row.drive_category = Some("web".to_string());

    assert!(row_matches_filtered_query(&link_row, "links"));
    assert!(row_matches_filtered_query(&link_row, "web"));
    assert!(!row_matches_filtered_query(&link_row, "files"));
}
