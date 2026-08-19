use crate::api::CalendarMeeting;
use crate::database::repositories::meeting::MeetingsRepository;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn api_get_meetings_by_range(
    state: State<'_, AppState>,
    start_utc: String,
    end_utc: String,
) -> Result<Vec<CalendarMeeting>, String> {
    let pool = state.db_manager.pool();
    MeetingsRepository::get_meetings_by_range(pool, &start_utc, &end_utc)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_get_dates_with_meetings(
    state: State<'_, AppState>,
    start_utc: String,
    end_utc: String,
) -> Result<Vec<String>, String> {
    let pool = state.db_manager.pool();
    let dates: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT date(created_at)
         FROM meetings
         WHERE datetime(created_at) >= datetime(?1) AND datetime(created_at) < datetime(?2)
         ORDER BY date(created_at) ASC",
    )
    .bind(&start_utc)
    .bind(&end_utc)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(dates)
}
