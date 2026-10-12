use sqlx::{migrate::MigrateDatabase, Result, Sqlite, SqlitePool, Transaction};
use std::fs;
use std::path::Path;
use tauri::Manager;

#[derive(Clone)]
pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    pub async fn new(tauri_db_path: &str, backend_db_path: &str) -> Result<Self> {
        if let Some(parent_dir) = Path::new(tauri_db_path).parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).map_err(|e| sqlx::Error::Io(e))?;
            }
        }

        if !Path::new(tauri_db_path).exists() {
            if Path::new(backend_db_path).exists() {
                log::info!(
                    "Copying database from {} to {}",
                    backend_db_path,
                    tauri_db_path
                );
                fs::copy(backend_db_path, tauri_db_path).map_err(|e| sqlx::Error::Io(e))?;
            } else {
                log::info!("Creating database at {}", tauri_db_path);
                Sqlite::create_database(tauri_db_path).await?;
            }
        }

        use std::str::FromStr;
        let options = sqlx::sqlite::SqliteConnectOptions::from_str(tauri_db_path)?
            .pragma("foreign_keys", "ON")
            // WAL is the correct journal mode for this application, and it is
            // now set explicitly rather than left to chance.
            //
            // Recall is a single-writer / many-reader desktop app: live
            // transcription writes transcript rows while the UI reads meetings,
            // summary generation writes derived data, and context rebuilds run in
            // the background. Under the rollback journal every writer takes a
            // whole-database lock, so those overlap into `SQLITE_BUSY` timeouts.
            // WAL lets readers proceed during a write.
            //
            // This was previously never configured. Fresh installs happened to
            // get WAL only because `sqlx::CREATE_DB_WAL` sets it at creation
            // time, but a database imported from the legacy Python backend
            // (`fs::copy` of a `sqlite3`-created file, journal mode `delete`)
            // silently kept the rollback journal forever. `journal_mode` is
            // persistent in the file header, so setting it here is what actually
            // upgrades an already-imported database.
            .pragma("journal_mode", "WAL")
            // NORMAL is the recommended durability level under WAL: it is safe
            // against application crashes and is an order of magnitude faster
            // than FULL, which fsyncs on every commit. Power-loss durability is
            // traded deliberately; the user's audio and checkpoints on disk are
            // the authoritative record of a recording, not the SQLite rows.
            .pragma("synchronous", "NORMAL");
        let pool = SqlitePool::connect_with(options).await?;

        // Report the journal mode we actually ended up on. `PRAGMA
        // journal_mode` is a no-op outside WAL, so the requested mode and the
        // effective mode can legitimately differ -- and the difference must be
        // visible in the log rather than assumed.
        match sqlx::query("PRAGMA journal_mode").fetch_one(&pool).await {
            Ok(row) => {
                use sqlx::Row;
                let mode: String = row.try_get(0).unwrap_or_else(|_| "unknown".to_string());
                if mode.eq_ignore_ascii_case("wal") {
                    log::info!("SQLite journal mode: {} (WAL)", mode);
                } else {
                    log::warn!(
                        "SQLite journal mode is '{}', not WAL. Writes will serialize on a \
                         whole-database lock.",
                        mode
                    );
                }
            }
            Err(e) => log::warn!("Could not read SQLite journal mode: {}", e),
        }

        sqlx::migrate!("./migrations").run(&pool).await?;

        Ok(DatabaseManager { pool })
    }

    // NOTE: So for the first time users they needs to start the application
    // after they can just delete the existing .sqlite file and then copy the existing .db file to
    // the current app dir, So the system detects legacy db and copy it and starts with that data
    // (Newly created .sqlite with the copied content from .db)
    pub async fn new_from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self> {
        // Resolve the app's data directory
        let app_data_dir = crate::brand_paths::resolve_app_data_dir(app_handle)
            .expect("failed to get app data dir");
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Define database paths
        let tauri_db_path = app_data_dir
            .join("meeting_minutes.sqlite")
            .to_string_lossy()
            .to_string();
        // Legacy backend DB path (for auto-migration if exists)
        let backend_db_path = app_data_dir
            .join("meeting_minutes.db")
            .to_string_lossy()
            .to_string();

        // WAL file paths for defensive cleanup
        let wal_path = app_data_dir.join("meeting_minutes.sqlite-wal");
        let shm_path = app_data_dir.join("meeting_minutes.sqlite-shm");

        log::info!("Tauri DB path: {}", tauri_db_path);
        log::info!("Legacy backend DB path: {}", backend_db_path);

        // Try to open database with defensive WAL handling
        match Self::new(&tauri_db_path, &backend_db_path).await {
            Ok(db_manager) => {
                log::info!("Database opened successfully");
                Ok(db_manager)
            }
            Err(e) => {
                // Check if error is due to corrupted WAL file
                let error_msg = e.to_string();
                if error_msg.contains("malformed") || error_msg.contains("corrupt") {
                    log::warn!("Database appears corrupted, likely due to orphaned WAL file. Attempting recovery...");
                    log::warn!("Error details: {}", error_msg);

                    // Delete potentially corrupted WAL/SHM files
                    if wal_path.exists() {
                        match fs::remove_file(&wal_path) {
                            Ok(_) => log::info!("Removed orphaned WAL file: {:?}", wal_path),
                            Err(e) => log::warn!("Failed to remove WAL file: {}", e),
                        }
                    }
                    if shm_path.exists() {
                        match fs::remove_file(&shm_path) {
                            Ok(_) => log::info!("Removed orphaned SHM file: {:?}", shm_path),
                            Err(e) => log::warn!("Failed to remove SHM file: {}", e),
                        }
                    }

                    // Retry connection without WAL files
                    log::info!("Retrying database connection after WAL cleanup...");
                    match Self::new(&tauri_db_path, &backend_db_path).await {
                        Ok(db_manager) => {
                            log::info!("Database opened successfully after WAL recovery");
                            Ok(db_manager)
                        }
                        Err(retry_err) => {
                            log::error!(
                                "Database connection failed even after WAL cleanup: {}",
                                retry_err
                            );
                            Err(retry_err)
                        }
                    }
                } else {
                    // Not a WAL-related error, propagate original error
                    log::error!("Database connection failed: {}", error_msg);
                    Err(e)
                }
            }
        }
    }

    /// Check if this is the first launch (sqlite database doesn't exist yet)
    pub async fn is_first_launch(app_handle: &tauri::AppHandle) -> Result<bool> {
        let app_data_dir = crate::brand_paths::resolve_app_data_dir(app_handle)
            .expect("failed to get app data dir");

        let tauri_db_path = app_data_dir.join("meeting_minutes.sqlite");

        Ok(!tauri_db_path.exists())
    }

    /// Import a legacy database from the specified path and initialize
    pub async fn import_legacy_database(
        app_handle: &tauri::AppHandle,
        legacy_db_path: &str,
    ) -> Result<Self> {
        let app_data_dir = crate::brand_paths::resolve_app_data_dir(app_handle)
            .expect("failed to get app data dir");

        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Copy legacy database to app data directory as meeting_minutes.db
        let target_legacy_path = app_data_dir.join("meeting_minutes.db");
        log::info!(
            "Copying legacy database from {} to {}",
            legacy_db_path,
            target_legacy_path.display()
        );

        fs::copy(legacy_db_path, &target_legacy_path).map_err(|e| sqlx::Error::Io(e))?;

        // Now use the standard initialization which will detect and migrate the legacy db
        Self::new_from_app_handle(app_handle).await
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn with_transaction<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Transaction<'_, Sqlite>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut tx = self.pool.begin().await?;
        let result = f(&mut tx).await;

        match result {
            Ok(val) => {
                tx.commit().await?;
                Ok(val)
            }
            Err(err) => {
                tx.rollback().await?;
                Err(err)
            }
        }
    }

    /// Cleanup database connection and checkpoint WAL
    /// This should be called on application shutdown to ensure:
    /// - All WAL changes are written to the main database file
    /// - The .wal and .shm files are deleted
    /// - Connection pool is gracefully closed
    pub async fn cleanup(&self) -> Result<()> {
        log::info!("Starting database cleanup...");

        // Checkpoint the WAL so committed data is folded back into the main
        // database file and the `-wal`/`-shm` files are truncated away.
        //
        // `wal_checkpoint` is a NO-OP outside WAL mode: it returns a row, not
        // an error. The previous code logged "WAL checkpoint completed
        // successfully" on any `Ok`, which was a false record on exactly the
        // databases most likely to need it. The result row's first column is the
        // number of frames still outstanding, so a truthful check is possible.
        match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(&self.pool)
            .await
        {
            Ok(row) => {
                use sqlx::Row;
                let busy: i64 = row.try_get(0).unwrap_or(-1);
                let log_frames: i64 = row.try_get(1).unwrap_or(-1);
                let checkpointed: i64 = row.try_get(2).unwrap_or(-1);
                if busy == 0 {
                    log::info!(
                        "WAL checkpoint completed: {} frames checkpointed, {} logged",
                        checkpointed,
                        log_frames
                    );
                } else {
                    log::warn!(
                        "WAL checkpoint incomplete: {} frame(s) still outstanding \
                         (checkpointed {}, logged {}). The WAL file is retained.",
                        busy,
                        checkpointed,
                        log_frames
                    );
                }
            }
            Err(e) => log::warn!("WAL checkpoint failed (non-fatal): {}", e),
        }

        // Close the connection pool gracefully
        self.pool.close().await;
        log::info!("Database connection pool closed");

        Ok(())
    }
}
