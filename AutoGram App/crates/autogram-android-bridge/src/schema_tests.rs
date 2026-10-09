use rusqlite::Connection;

const MIGRATION: &str = include_str!("../../../database/migrations/024_android_local_records.sql");
const MASTER: &str = include_str!("../../../database/schema.sql");

#[test]
fn native_upload_checkpoint_schema_is_repeatable_and_matches_master() {
    let runtime = Connection::open_in_memory().unwrap();
    runtime.execute_batch(include_str!("../../../database/migrations/015_transfer_control_plane_v4.sql")).unwrap();
    let upload = include_str!("../../../database/migrations/026_native_cloud_uploads.sql");
    runtime.execute_batch(upload).unwrap();
    runtime.execute_batch(upload).unwrap();
    let master = Connection::open_in_memory().unwrap();
    master.execute_batch(MASTER).unwrap();
    assert_eq!(columns(&runtime,"native_cloud_uploads"),columns(&master,"native_cloud_uploads"));
    let count: i64 = runtime.query_row("SELECT count(*) FROM native_cloud_uploads",[],|row| row.get(0)).unwrap();
    assert_eq!(count,0);
}

fn columns(connection: &Connection, table: &str) -> Vec<(String, String, i64, Option<String>, i64)> {
    connection.prepare(&format!("PRAGMA table_info({table})")).unwrap()
        .query_map([], |row| Ok((row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))
        .unwrap().collect::<Result<_, _>>().unwrap()
}

#[test]
fn android_tables_match_master_and_migration_is_repeatable() {
    let runtime = Connection::open_in_memory().unwrap();
    runtime.execute_batch(MIGRATION).unwrap();
    runtime.execute_batch(MIGRATION).unwrap();
    let master = Connection::open_in_memory().unwrap();
    master.execute_batch(MASTER).unwrap();
    for table in ["android_drive_items", "android_transfer_tasks"] {
        assert_eq!(columns(&runtime, table), columns(&master, table));
    }
    for index in ["idx_android_drive_parent", "idx_android_transfer_state"] {
        let query = "SELECT sql FROM sqlite_master WHERE type='index' AND name=?1";
        let actual: String = runtime.query_row(query, [index], |row| row.get(0)).unwrap();
        let expected: String = master.query_row(query, [index], |row| row.get(0)).unwrap();
        assert_eq!(actual, expected);
    }
}

#[test]
fn native_download_schema_matches_master_without_promoting_metadata_jobs() {
    let runtime = Connection::open_in_memory().unwrap();
    runtime.execute_batch(MIGRATION).unwrap();
    let download = include_str!("../../../database/migrations/025_native_cloud_downloads.sql");
    runtime.execute_batch(download).unwrap();
    runtime.execute_batch(download).unwrap();
    let master = Connection::open_in_memory().unwrap();
    master.execute_batch(MASTER).unwrap();
    assert_eq!(columns(&runtime, "native_cloud_downloads"), columns(&master, "native_cloud_downloads"));
    let count: i64 = runtime.query_row("SELECT count(*) FROM native_cloud_downloads", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 0);
}
