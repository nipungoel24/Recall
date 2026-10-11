//! Coordinated application shutdown.
//!
//! # Why this exists
//!
//! Shutdown used to be assembled ad hoc inside the `RunEvent::Exit` handler:
//!
//! ```ignore
//! tauri::async_runtime::block_on(async {
//!     app_state.db_manager.cleanup().await;      // awaits pool.close()
//!     force_shutdown_sidecar().await;
//! });
//! ```
//!
//! That has three failure modes, all of them bad on a desktop app:
//!
//! 1. **It can hang forever.** `pool.close()` waits for every pooled connection
//!    to be returned. If any background task still holds one -- a summary
//!    generation, a context rebuild -- the close never completes, and because
//!    the main thread is parked inside `block_on`, the UI freezes and the
//!    process cannot be exited.
//! 2. **It is not idempotent.** Tray Quit and the OS exit path could both run
//!    teardown, racing on the same child-process handle.
//! 3. **It ignored an in-progress recording.** Quitting mid-recording left an
//!    unfinalized session with no statement of what happened to it.
//!
//! Everything here is therefore bounded by an explicit timeout and guarded so
//! that only the first caller does the work. A step that times out is logged
//! and the shutdown continues: a stuck subsystem must not be able to prevent
//! the app from exiting.
//!
//! **Interruptions are never reported as success.** If a recording cannot be
//! finalized, its recoverable checkpoints are deliberately left on disk and the
//! shutdown reports it as incomplete.

use log::{error, info, warn};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Runtime};

/// Set once a shutdown has begun; makes teardown idempotent.
static SHUTDOWN_STARTED: AtomicBool = AtomicBool::new(false);

/// Maximum time the database is given to checkpoint and close.
const DB_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Maximum time the sidecar is given to shut down.
const SIDECAR_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// Maximum time an active recording is given to finalize before we let it go.
const RECORDING_FINALIZE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// True once a shutdown has been started by some caller.
pub fn shutdown_started() -> bool {
    SHUTDOWN_STARTED.load(Ordering::SeqCst)
}

/// Run the full shutdown sequence.
///
/// Idempotent: concurrent or repeat calls are no-ops once teardown has begun.
/// Safe to call from a synchronous context such as `RunEvent::Exit`; every
/// step is individually bounded so the call cannot block indefinitely.
pub fn shutdown_all<R: Runtime>(app: &AppHandle<R>) {
    if SHUTDOWN_STARTED.swap(true, Ordering::SeqCst) {
        info!("Shutdown already in progress; ignoring duplicate request");
        return;
    }

    info!("Application exiting, running coordinated shutdown...");

    // `RunEvent::Exit` is delivered on the main thread, so the work must be
    // driven synchronously from here. Every step is time-bounded, which is what
    // turns this from a potential deadlock into a bounded wait.
    tauri::async_runtime::block_on(async {
        stop_active_recording(app).await;
        shutdown_sidecar().await;
        shutdown_database(app).await;
    });

    info!("Coordinated shutdown complete");
}

/// Attempt a graceful finalization of an in-progress recording.
///
/// If this cannot complete, the recoverable checkpoints stay on disk: Phase F1
/// already ensures checkpoints are never deleted by a failed finalization. The
/// recording is then explicitly *incomplete*, never "saved".
async fn stop_active_recording<R: Runtime>(app: &AppHandle<R>) {
    if !crate::audio::is_recording().await {
        return;
    }

    warn!("Shutdown requested while recording is active; attempting finalization");

    let finalized = tokio::time::timeout(
        RECORDING_FINALIZE_TIMEOUT,
        crate::audio::recording_commands::stop_recording(
            app.clone(),
            crate::audio::recording_commands::RecordingArgs {
                // Unused by the stop path (the saver owns the meeting folder);
                // empty so shutdown never invents a save location.
                save_path: String::new(),
            },
        ),
    )
    .await;

    match finalized {
        Ok(Ok(())) => {
            info!("Active recording finalized during shutdown");
        }
        Ok(Err(e)) => {
            // Do not claim success. Checkpoints are intentionally preserved so
            // the session remains recoverable.
            error!(
                "Active recording could not be finalized during shutdown: {}. \
                 Recoverable checkpoints have been preserved; this recording is incomplete.",
                e
            );
        }
        Err(_) => {
            error!(
                "Active recording did not finalize within {}s. \
                 Recoverable checkpoints have been preserved; this recording is incomplete.",
                RECORDING_FINALIZE_TIMEOUT.as_secs()
            );
        }
    }
}

/// Shut down the llama-helper sidecar, guaranteeing termination.
async fn shutdown_sidecar() {
    info!("Shutting down llama-helper sidecar...");

    let result = tokio::time::timeout(
        SIDECAR_SHUTDOWN_TIMEOUT,
        crate::summary::summary_engine::force_shutdown_sidecar(),
    )
    .await;

    match result {
        Ok(Ok(())) => info!("Sidecar shutdown completed"),
        Ok(Err(e)) => error!("Sidecar shutdown reported an error: {}", e),
        Err(_) => error!(
            "Sidecar shutdown did not complete within {}s; \
             a helper process may have survived",
            SIDECAR_SHUTDOWN_TIMEOUT.as_secs()
        ),
    }
}

/// Checkpoint the WAL and close the connection pool.
///
/// Bounded, because `pool.close()` waits for every in-flight connection to be
/// returned and can otherwise block a parked main thread indefinitely.
async fn shutdown_database<R: Runtime>(app: &AppHandle<R>) {
    use tauri::Manager;

    let Some(app_state) = app.try_state::<crate::state::AppState>() else {
        warn!("AppState not available for database shutdown (likely first launch)");
        return;
    };

    info!("Starting database shutdown...");

    let closed = tokio::time::timeout(DB_SHUTDOWN_TIMEOUT, app_state.db_manager.cleanup()).await;

    match closed {
        Ok(Ok(())) => info!("Database shutdown completed"),
        Ok(Err(e)) => error!("Database shutdown reported an error: {}", e),
        Err(_) => error!(
            "Database shutdown did not complete within {}s; \
             the WAL may not be checkpointed cleanly",
            DB_SHUTDOWN_TIMEOUT.as_secs()
        ),
    }
}

/// Reset shutdown state. Test-only: lets lifecycle tests run independently in
/// the same process.
#[cfg(test)]
pub(crate) fn reset_for_tests() {
    SHUTDOWN_STARTED.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_is_idempotent() {
        reset_for_tests();
        assert!(!shutdown_started());

        // First caller claims the shutdown.
        assert!(!SHUTDOWN_STARTED.swap(true, Ordering::SeqCst));
        assert!(shutdown_started());

        // Any later caller is a no-op rather than a second teardown racing on
        // the same child-process handle.
        assert!(SHUTDOWN_STARTED.swap(true, Ordering::SeqCst));
        assert!(shutdown_started());
    }

    #[test]
    fn shutdown_timeouts_are_bounded() {
        // Every blocking step must have an explicit bound. A subsystem that
        // hangs must not be able to prevent the app from exiting.
        assert!(DB_SHUTDOWN_TIMEOUT.as_secs() > 0);
        assert!(SIDECAR_SHUTDOWN_TIMEOUT.as_secs() > 0);
        assert!(RECORDING_FINALIZE_TIMEOUT.as_secs() > 0);
        assert!(DB_SHUTDOWN_TIMEOUT <= std::time::Duration::from_secs(30));
        assert!(SIDECAR_SHUTDOWN_TIMEOUT <= std::time::Duration::from_secs(30));
        assert!(RECORDING_FINALIZE_TIMEOUT <= std::time::Duration::from_secs(60));
    }
}
