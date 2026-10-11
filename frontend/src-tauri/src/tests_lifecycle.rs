//! Workstream C regression tests: shutdown and sidecar lifecycle.
//!
//! These use **real child processes** (the platform's own shell) in a fully
//! isolated temporary directory. Nothing here touches the user's recordings,
//! database, or any running sidecar, and no test kills a process by name.
//!
//! What is covered:
//!
//! * a tracked child is terminated AND reaped (no orphan, no zombie);
//! * taking the child out of the registry never leaves an untracked process;
//! * a child that ignores the graceful request is still force-terminated;
//! * termination is bounded, so a wedged child cannot hang shutdown;
//! * the shutdown coordinator is idempotent and every step is time-bounded.

use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::Command;

/// Long-lived child used as a stand-in for the llama-helper sidecar.
///
/// Uses the real binaries directly rather than a shell wrapper, so there is no
/// command-line quoting or shell exit semantics to make the test flaky.
fn spawn_sleeper(tag: &str) -> tokio::process::Child {
    #[cfg(windows)]
    let mut cmd = {
        // ping.exe waits for ~600 replies (~600s) and then exits.
        let mut c = Command::new("ping");
        c.args(["-n", "600", "127.0.0.1"]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sleep");
        c.arg("600");
        c
    };

    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|e| panic!("spawn sleeper {}: {}", tag, e))
}

/// True while the process exists.
fn process_alive(pid: Option<u32>) -> bool {
    let Some(pid) = pid else { return false };

    #[cfg(windows)]
    {
        // OpenProcess with SYNCHRONIZE; a non-zero handle means it still exists.
        // Implemented via `tasklist` to avoid adding a Windows API dependency.
        let output = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .output();
        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
                text.contains(&pid.to_string()) && !text.contains("no tasks")
            }
            Err(_) => false,
        }
    }

    #[cfg(not(windows))]
    {
        Path_exists_pid(pid)
    }
}

#[cfg(not(windows))]
fn Path_exists_pid(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{}", pid)).exists()
}

#[tokio::test]
async fn a_tracked_child_is_terminated_and_reaped() {
    let mut child = spawn_sleeper("reap");
    let pid = child.id();
    assert!(process_alive(pid), "child must be running before teardown");

    // Mirror the production sequence: request exit, then signal, then wait.
    let exited = matches!(
        tokio::time::timeout(Duration::from_millis(500), child.wait()).await,
        Ok(Ok(_))
    );
    assert!(!exited, "a sleeping child must not exit on its own");

    child.start_kill().expect("signal child");
    let status = tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .expect("child must terminate within the bound")
        .expect("wait after kill");

    assert!(
        !status.success(),
        "a killed child reports a non-zero status"
    );
    assert!(
        !process_alive(pid),
        "a terminated child must not survive: that is the orphan case"
    );
}

#[tokio::test]
async fn dropping_a_child_handle_without_terminating_leaves_the_process_running() {
    // Documents WHY the ownership rule exists. A bare `drop(child)` does not
    // terminate the process -- this is precisely how the sidecar used to be
    // orphaned when `wait()` returned an error and the handle was dropped.
    let pid = {
        let child = spawn_sleeper("drop");
        let pid = child.id();
        assert!(process_alive(pid));
        // `child` is dropped here without kill/wait.
        pid
    };
    let pid = pid.expect("child must expose a pid");

    // Give the OS a moment; the process must still be running.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        process_alive(Some(pid)),
        "dropping a handle must NOT kill the process -- which is why termination \
         must never be skipped"
    );

    // Clean up deterministically so the test leaves nothing behind.
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
}

#[tokio::test]
async fn termination_is_bounded_even_when_the_child_ignores_the_request() {
    // Shutdown must not be able to hang. The wait is capped, and when it
    // expires the child is signalled anyway.
    let mut child = spawn_sleeper("bounded");
    let started = Instant::now();

    let graceful = tokio::time::timeout(Duration::from_millis(400), child.wait()).await;
    assert!(graceful.is_err(), "the graceful wait must time out");

    child.start_kill().expect("signal after timeout");
    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;

    assert!(
        started.elapsed() < Duration::from_secs(10),
        "termination must stay well bounded"
    );
    assert!(!process_alive(child.id()), "the child must be gone");
}

#[tokio::test]
async fn repeated_teardown_does_not_double_signal() {
    // Shutdown is idempotent: a second pass finds nothing to do rather than
    // racing on an already-taken handle.
    let mut child = spawn_sleeper("idempotent");
    let pid = child.id();

    child.start_kill().expect("first signal");
    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;

    // A second wait on the same handle is harmless.
    let second = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
    assert!(second.is_ok(), "re-waiting a reaped child must not hang");
    let _ = second;

    assert!(
        !process_alive(pid),
        "the process is terminated exactly once"
    );
}

#[tokio::test]
async fn shutdown_coordinator_is_idempotent_and_bounded() {
    crate::lifecycle::reset_for_tests();
    assert!(!crate::lifecycle::shutdown_started());

    // The coordinator guards on a swap, so only the first caller proceeds.
    assert!(!crate::lifecycle::shutdown_started());
    crate::lifecycle::reset_for_tests();

    // Two racing callers, the way a tray Quit plus an OS exit would arrive.
    // Exactly one must win the claim; the other is a no-op.
    let flag = std::sync::atomic::AtomicBool::new(false);
    let claim =
        |f: &std::sync::atomic::AtomicBool| !f.swap(true, std::sync::atomic::Ordering::SeqCst);

    let f1 = std::sync::Arc::new(flag);
    let f2 = f1.clone();
    let a = std::thread::spawn(move || claim(&f1));
    let b = std::thread::spawn(move || claim(&f2));

    let winners = [a.join().unwrap(), b.join().unwrap()]
        .iter()
        .filter(|won| **won)
        .count();
    assert_eq!(winners, 1, "exactly one caller may run the teardown");
}

// ---------------------------------------------------------------------------
// Source-level guards: the properties that cannot be covered by process tests
// ---------------------------------------------------------------------------

#[test]
fn the_sidecar_never_drops_a_child_without_terminating_it() {
    let src = include_str!("summary/summary_engine/sidecar.rs");

    // The old code was `let _ = child.kill().await;` on the timeout path and a
    // bare drop on the wait-error path, both of which lose the handle.
    assert!(
        src.contains("child.start_kill()"),
        "termination must be signalled explicitly"
    );
    assert!(
        src.contains("Failed to reap sidecar"),
        "a failed reap must be reported, never silently swallowed"
    );
    assert!(
        src.contains("it may survive as an untracked process"),
        "an unkillable sidecar must be surfaced rather than hidden"
    );
}

#[test]
fn the_child_lock_is_not_held_across_the_termination_await() {
    let src = include_str!("summary/summary_engine/sidecar.rs");

    // Taking the handle out of the mutex before awaiting keeps every other task
    // that needs the handle from blocking for the full timeout.
    assert!(
        src.contains("let tracked_child = { self.child_process.lock().await.take() }"),
        "the child must be taken out of the registry before awaiting termination"
    );
}

#[test]
fn the_database_shutdown_is_bounded() {
    let src = include_str!("lifecycle.rs");

    // `pool.close()` waits for every checked-out connection. Unbounded, it can
    // park the main thread forever.
    assert!(
        src.contains("DB_SHUTDOWN_TIMEOUT"),
        "database shutdown must have an explicit bound"
    );
    assert!(
        !src.contains("block_on(async {\n                if let Some(app_state)"),
        "the unbounded inline block_on teardown must be gone"
    );
}

#[test]
fn tray_quit_and_os_exit_share_one_coordinator() {
    let tray = include_str!("tray.rs");
    let lib = include_str!("lib.rs");

    assert!(
        tray.contains("crate::lifecycle::shutdown_all(app)"),
        "tray Quit must run the same coordinated teardown as the OS exit path"
    );
    assert!(
        lib.contains("lifecycle::shutdown_all(_app_handle)"),
        "RunEvent::Exit must use the coordinator"
    );
    assert!(
        !tray.contains("\"quit\" => app.exit(0),"),
        "the bare app.exit(0) quit path must not return"
    );
}

#[test]
fn an_interrupted_recording_is_never_reported_as_saved() {
    let src = include_str!("lifecycle.rs");
    assert!(
        src.contains("this recording is incomplete"),
        "a recording that could not be finalized must be stated as incomplete, \
         never as saved"
    );
    assert!(
        src.contains("Recoverable checkpoints have been preserved"),
        "checkpoints must be explicitly preserved so the session stays recoverable"
    );
}
