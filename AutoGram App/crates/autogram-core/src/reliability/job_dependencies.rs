//! Job Dependency Graph Engine
//! Manages parent-child job dependencies ('HARD_BLOCK', 'SOFT_SEQUENCE', 'CLEANUP') atomically via SQLite.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DependencyType {
    HardBlock,
    SoftSequence,
    Cleanup,
}

impl DependencyType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DependencyType::HardBlock => "HARD_BLOCK",
            DependencyType::SoftSequence => "SOFT_SEQUENCE",
            DependencyType::Cleanup => "CLEANUP",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "HARD_BLOCK" => DependencyType::HardBlock,
            "SOFT_SEQUENCE" => DependencyType::SoftSequence,
            "CLEANUP" => DependencyType::Cleanup,
            _ => DependencyType::HardBlock,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobDependency {
    pub id: i64,
    pub parent_job_id: i64,
    pub child_job_id: i64,
    pub dependency_type: DependencyType,
    pub created_at: i64,
}

pub fn add_dependency(
    conn: &Connection,
    parent_id: i64,
    child_id: i64,
    dep_type: DependencyType,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO job_dependencies (parent_job_id, child_job_id, dependency_type, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![parent_id, child_id, dep_type.as_str(), now],
    )
    .map_err(|e| format!("failed to insert job dependency: {e}"))?;

    Ok(())
}

pub fn is_child_blocked(conn: &Connection, child_id: i64) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(
            "SELECT j.status, d.dependency_type
             FROM job_dependencies d
             JOIN jobs j ON j.id = d.parent_job_id
             WHERE d.child_job_id = ?1",
        )
        .map_err(|e| format!("prepare statement error: {e}"))?;

    let rows = stmt
        .query_map(params![child_id], |row| {
            let status: String = row.get(0)?;
            let dep_type_str: String = row.get(1)?;
            Ok((status, dep_type_str))
        })
        .map_err(|e| format!("query error: {e}"))?;

    for r in rows {
        let (status, dep_type_str) = r.map_err(|e| e.to_string())?;
        let dep_type = DependencyType::from_str(&dep_type_str);
        if dep_type == DependencyType::HardBlock && status != "COMPLETED" {
            return Ok(true);
        }
    }

    Ok(false)
}

pub fn get_child_jobs(conn: &Connection, parent_id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT child_job_id FROM job_dependencies WHERE parent_job_id = ?1")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![parent_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut children = Vec::new();
    for r in rows {
        if let Ok(child_id) = r {
            children.push(child_id);
        }
    }

    Ok(children)
}
