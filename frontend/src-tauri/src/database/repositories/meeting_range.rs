//! Efficient meeting retrieval by timestamp range (contract §3).
//!
//! `meetings.created_at` is TEXT with mixed formats (RFC3339 `...T...+00:00` / `...Z`
//! written by `DateTime<Utc>` binds, and naive `YYYY-MM-DD HH:MM:SS.ffffff` written
//! by `NaiveDateTime` binds — contract §1). Raw string comparison is therefore
//! forbidden (§10.6): the WHERE clause normalizes through SQLite's `datetime()`,
//! which accepts both formats and a trailing `Z`.
//!
//! The contract's calendar-day semantics are frontend-computed UTC instants
//! (§10.2): this repository takes `DateTime<Utc>` bounds, encodes them as RFC3339
//! UTC strings via sqlx, and applies a half-open range
//! `datetime(created_at) >= datetime(start) AND datetime(created_at) < datetime(end)`.
//! No `LIKE`/prefix string matching on timestamps is used anywhere.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Error as SqlxError, SqlitePool};
use tracing::info;

/// Row produced by the contract §3.2 query. `created_at`/`updated_at` are returned
/// verbatim (stored representation may be RFC3339 or naive — §3.2 selects them raw).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingRangeItem {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    /// Total meeting duration in seconds, derived per contract §3.3. `None` when unknown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct MeetingRangeRow {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    folder_path: Option<String>,
    seg_sum: Option<f64>,
    last_end: Option<f64>,
}

impl MeetingRangeRow {
    /// Contract §3.3 duration derivation rule:
    /// 1. `last_end` (MAX audio_end_time) when present and > 0.0;
    /// 2. else `seg_sum` (SUM of segment durations) when present and > 0.0;
    /// 3. else `None`.
    fn duration_seconds(&self) -> Option<f64> {
        if let Some(last_end) = self.last_end {
            if last_end > 0.0 {
                return Some(last_end);
            }
        }
        if let Some(seg_sum) = self.seg_sum {
            if seg_sum > 0.0 {
                return Some(seg_sum);
            }
        }
        None
    }

    fn into_item(self) -> MeetingRangeItem {
        let duration_seconds = self.duration_seconds();
        MeetingRangeItem {
            id: self.id,
            title: self.title,
            created_at: self.created_at,
            updated_at: self.updated_at,
            folder_path: self.folder_path,
            duration_seconds,
        }
    }
}

pub struct MeetingRangeRepository;

impl MeetingRangeRepository {
    /// Meetings whose `created_at` falls in `[start, end)` (half-open), ordered by
    /// `created_at` ascending (contract §3.2). Rejects `start >= end`.
    ///
    /// Bound `DateTime<Utc>` values are encoded by sqlx as RFC3339 UTC strings, the
    /// same representation `datetime()` accepts for the stored column values.
    pub async fn get_meetings_by_range(
        pool: &SqlitePool,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<MeetingRangeItem>, SqlxError> {
        if start >= end {
            return Err(SqlxError::Protocol(
                "start must be strictly before end".to_string(),
            ));
        }

        info!(
            "Querying meetings by range [{}, {})",
            start.to_rfc3339(),
            end.to_rfc3339()
        );

        let rows = sqlx::query_as::<_, MeetingRangeRow>(
            "SELECT m.id, m.title, m.created_at, m.updated_at, m.folder_path,
                    SUM(t.duration) AS seg_sum,
                    MAX(t.audio_end_time) AS last_end
             FROM meetings m
             LEFT JOIN transcripts t ON t.meeting_id = m.id
             WHERE datetime(m.created_at) >= datetime(?1) AND datetime(m.created_at) < datetime(?2)
             GROUP BY m.id
             ORDER BY datetime(m.created_at) ASC",
        )
        .bind(start)
        .bind(end)
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(MeetingRangeRow::into_item).collect())
    }

    /// Distinct UTC dates (`YYYY-MM-DD`) that have at least one meeting in
    /// `[start, end)`, ascending (contract §3.2, `api_get_dates_with_meetings`).
    pub async fn get_dates_with_meetings(
        pool: &SqlitePool,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<String>, SqlxError> {
        if start >= end {
            return Err(SqlxError::Protocol(
                "start must be strictly before end".to_string(),
            ));
        }

        let dates: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT date(m.created_at)
             FROM meetings m
             WHERE datetime(m.created_at) >= datetime(?1) AND datetime(m.created_at) < datetime(?2)
             ORDER BY date(m.created_at) ASC",
        )
        .bind(start)
        .bind(end)
        .fetch_all(pool)
        .await?;

        Ok(dates)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to open in-memory sqlite");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("failed to run migrations");
        pool
    }

    /// Inserts a meeting with an explicit stored `created_at` string so tests can
    /// exercise the mixed stored formats directly (RFC3339 `Z`, RFC3339 `+00:00`,
    /// naive space-separated).
    async fn insert_meeting(pool: &SqlitePool, id: &str, title: &str, created_at: &str) {
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind(title)
            .bind(created_at)
            .bind(created_at)
            .execute(pool)
            .await
            .expect("failed to insert test meeting");
    }

    async fn insert_transcript(
        pool: &SqlitePool,
        id: &str,
        meeting_id: &str,
        end_time: Option<f64>,
        duration: Option<f64>,
    ) {
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration)
             VALUES (?, ?, 'x', '2026-08-15T09:00:00Z', ?, ?, ?)",
        )
        .bind(id)
        .bind(meeting_id)
        .bind(end_time)
        .bind(end_time)
        .bind(duration)
        .execute(pool)
        .await
        .expect("failed to insert test transcript");
    }

    fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, mo, d, h, mi, s).unwrap()
    }

    #[tokio::test]
    async fn test_date_range_half_open_boundaries_across_mixed_formats() {
        let pool = test_pool().await;

        // Boundary fixtures: one second before the day, midnight exactly, mid-day,
        // last nanosecond of the day, midnight of the next day — across all three
        // stored format families.
        insert_meeting(&pool, "m-prev-day", "Before", "2026-08-14T23:59:59Z").await;
        insert_meeting(
            &pool,
            "m-midnight",
            "Midnight",
            "2026-08-15T00:00:00.000000000+00:00",
        )
        .await;
        // Naive (space-separated) stored format — must still be found because the
        // query normalizes via datetime() rather than comparing raw strings.
        insert_meeting(
            &pool,
            "m-naive",
            "Naive format",
            "2026-08-15 12:00:00.123456",
        )
        .await;
        insert_meeting(
            &pool,
            "m-end-nano",
            "End of day",
            "2026-08-15T23:59:59.999999999+00:00",
        )
        .await;
        insert_meeting(&pool, "m-next-day", "After", "2026-08-16T00:00:00Z").await;

        let day_start = utc(2026, 8, 15, 0, 0, 0);
        let day_end = utc(2026, 8, 16, 0, 0, 0);

        let items = MeetingRangeRepository::get_meetings_by_range(&pool, day_start, day_end)
            .await
            .expect("range query failed");

        let ids: Vec<&str> = items.iter().map(|m| m.id.as_str()).collect();
        // m-prev-day excluded (created_at < start); m-next-day excluded
        // (created_at >= end); the naive-format row included via datetime().
        assert_eq!(
            ids,
            vec!["m-midnight", "m-naive", "m-end-nano"],
            "half-open [start, end) boundaries with mixed stored formats"
        );
    }

    #[tokio::test]
    async fn test_utc_midnight_belongs_to_new_day() {
        let pool = test_pool().await;
        insert_meeting(
            &pool,
            "m-midnight",
            "Midnight",
            "2026-08-15T00:00:00.000000000+00:00",
        )
        .await;
        insert_meeting(
            &pool,
            "m-before-midnight",
            "1ns before",
            "2026-08-14T23:59:59.999999999+00:00",
        )
        .await;

        // Aug 15 UTC day contains the midnight meeting.
        let aug15 = MeetingRangeRepository::get_meetings_by_range(
            &pool,
            utc(2026, 8, 15, 0, 0, 0),
            utc(2026, 8, 16, 0, 0, 0),
        )
        .await
        .unwrap();
        assert_eq!(aug15.len(), 1);
        assert_eq!(aug15[0].id, "m-midnight");

        // The meeting 1ns before midnight belongs to Aug 14.
        let aug14 = MeetingRangeRepository::get_meetings_by_range(
            &pool,
            utc(2026, 8, 14, 0, 0, 0),
            utc(2026, 8, 15, 0, 0, 0),
        )
        .await
        .unwrap();
        assert_eq!(aug14.len(), 1);
        assert_eq!(aug14[0].id, "m-before-midnight");
    }

    #[tokio::test]
    async fn test_range_results_ascending_and_error_on_inverted_bounds() {
        let pool = test_pool().await;
        insert_meeting(&pool, "m-late", "Late", "2026-08-15T18:00:00Z").await;
        insert_meeting(&pool, "m-early", "Early", "2026-08-15T08:00:00Z").await;

        let items = MeetingRangeRepository::get_meetings_by_range(
            &pool,
            utc(2026, 8, 15, 0, 0, 0),
            utc(2026, 8, 16, 0, 0, 0),
        )
        .await
        .unwrap();
        let ids: Vec<&str> = items.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["m-early", "m-late"]);

        // start >= end is rejected.
        let err = MeetingRangeRepository::get_meetings_by_range(
            &pool,
            utc(2026, 8, 16, 0, 0, 0),
            utc(2026, 8, 15, 0, 0, 0),
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("strictly before"), "{err}");
    }

    #[tokio::test]
    async fn test_duration_derivation_rule() {
        let pool = test_pool().await;

        // Rule 1: MAX(audio_end_time) wins.
        insert_meeting(&pool, "m1", "Has end", "2026-08-15T09:00:00Z").await;
        insert_transcript(&pool, "t1a", "m1", Some(120.0), Some(100.0)).await;
        insert_transcript(&pool, "t1b", "m1", Some(125.3), Some(5.0)).await;

        // Rule 2: SUM(duration) when audio_end_time is NULL.
        insert_meeting(&pool, "m2", "Only durations", "2026-08-15T10:00:00Z").await;
        insert_transcript(&pool, "t2a", "m2", None, Some(3.0)).await;
        insert_transcript(&pool, "t2b", "m2", None, Some(5.0)).await;

        // Rule 3: no timing data at all.
        insert_meeting(&pool, "m3", "No data", "2026-08-15T11:00:00Z").await;

        let items = MeetingRangeRepository::get_meetings_by_range(
            &pool,
            utc(2026, 8, 15, 0, 0, 0),
            utc(2026, 8, 16, 0, 0, 0),
        )
        .await
        .unwrap();

        let by_id = |id: &str| items.iter().find(|m| m.id == id).unwrap();
        assert_eq!(by_id("m1").duration_seconds, Some(125.3));
        assert_eq!(by_id("m2").duration_seconds, Some(8.0));
        assert_eq!(by_id("m3").duration_seconds, None);
    }

    #[tokio::test]
    async fn test_dates_with_meetings_distinct_ascending() {
        let pool = test_pool().await;
        insert_meeting(&pool, "m1", "A", "2026-08-13T10:00:00Z").await;
        insert_meeting(&pool, "m2", "B", "2026-08-14T23:30:00Z").await;
        insert_meeting(&pool, "m3", "C", "2026-08-14T08:00:00Z").await;
        insert_meeting(&pool, "m4", "D", "2026-08-16T00:30:00Z").await;

        let dates = MeetingRangeRepository::get_dates_with_meetings(
            &pool,
            utc(2026, 8, 13, 0, 0, 0),
            utc(2026, 8, 16, 0, 0, 0),
        )
        .await
        .unwrap();
        assert_eq!(dates, vec!["2026-08-13", "2026-08-14"]);
    }
}
