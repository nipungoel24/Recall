use ffmpeg_sidecar::{
    command::ffmpeg_is_installed,
    download::{check_latest_version, download_ffmpeg_package, ffmpeg_download_url, unpack_ffmpeg},
    paths::sidecar_dir,
    version::ffmpeg_version,
};
use log::{debug, error};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use which::which;

#[cfg(not(windows))]
const EXECUTABLE_NAME: &str = "ffmpeg";

#[cfg(windows)]
const EXECUTABLE_NAME: &str = "ffmpeg.exe";

// Resolution result plus the instant it was computed.
//
// This used to be `Lazy<Option<PathBuf>>`, which cached a `None` for the whole
// process lifetime. If ffmpeg was missing at first use (mid-install, antivirus
// quarantine, network share not yet mounted) the app could never recover for
// the rest of the session, and every checkpoint encode failed silently from
// then on. The cache is now time-limited so a changed environment is picked up,
// and the in-flight guard is released even on panic so one failure does not
// poison every later lookup.
static FFMPEG_PATH: OnceLock<Mutex<Option<CachedFfmpeg>>> = OnceLock::new();
static FFMPEG_IN_FLIGHT: Mutex<()> = Mutex::new(());

const FFMPEG_CACHE_TTL_SECS: u64 = 60;

struct CachedFfmpeg {
    path: Option<PathBuf>,
    resolved_at: std::time::Instant,
}

pub fn find_ffmpeg_path() -> Option<PathBuf> {
    let cache = FFMPEG_PATH.get_or_init(|| Mutex::new(None));
    let mut guard = match cache.lock() {
        Ok(g) => g,
        // A poisoned cache must not make ffmpeg permanently undiscoverable.
        Err(poisoned) => poisoned.into_inner(),
    };

    let fresh = guard
        .as_ref()
        .is_some_and(|c| c.resolved_at.elapsed().as_secs() < FFMPEG_CACHE_TTL_SECS);
    if fresh {
        return guard.as_ref().and_then(|c| c.path.clone());
    }

    // Serialise concurrent misses so N callers do not all try to install.
    let _in_flight = match FFMPEG_IN_FLIGHT.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    // Re-check: another thread may have resolved it while we waited.
    let fresh = guard
        .as_ref()
        .is_some_and(|c| c.resolved_at.elapsed().as_secs() < FFMPEG_CACHE_TTL_SECS);
    if fresh {
        return guard.as_ref().and_then(|c| c.path.clone());
    }

    let path = find_ffmpeg_path_internal();
    *guard = Some(CachedFfmpeg {
        path: path.clone(),
        resolved_at: std::time::Instant::now(),
    });
    path
}

fn find_ffmpeg_path_internal() -> Option<PathBuf> {
    debug!("Starting search for ffmpeg executable");

    // ============================================================
    // PRIORITY 1: Bundled Binary (Production)
    // ============================================================
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_folder) = exe_path.parent() {
            let bundled = exe_folder.join(EXECUTABLE_NAME);
            if bundled.exists() && bundled.is_file() {
                debug!("Found bundled ffmpeg: {:?}", bundled);
                return Some(bundled);
            }
        }
    }

    // ============================================================
    // PRIORITY 2: Fallback to Existing Logic
    // ============================================================

    // Check if `ffmpeg` is in the PATH environment variable
    if let Ok(path) = which(EXECUTABLE_NAME) {
        debug!("Found ffmpeg in PATH: {:?}", path);
        return Some(path);
    }
    debug!("ffmpeg not found in PATH");

    // Check in $HOME/.local/bin on macOS
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let local_bin = PathBuf::from(home).join(".local").join("bin");
            debug!("Checking $HOME/.local/bin: {:?}", local_bin);
            let ffmpeg_in_local_bin = local_bin.join(EXECUTABLE_NAME);
            if ffmpeg_in_local_bin.exists() {
                debug!(
                    "Found ffmpeg in $HOME/.local/bin: {:?}",
                    ffmpeg_in_local_bin
                );
                return Some(ffmpeg_in_local_bin);
            }
            debug!("ffmpeg not found in $HOME/.local/bin");
        }
    }

    // Check in current working directory
    if let Ok(cwd) = std::env::current_dir() {
        debug!("Current working directory: {:?}", cwd);
        let ffmpeg_in_cwd = cwd.join(EXECUTABLE_NAME);
        if ffmpeg_in_cwd.is_file() && ffmpeg_in_cwd.exists() {
            debug!(
                "Found ffmpeg in current working directory: {:?}",
                ffmpeg_in_cwd
            );
            return Some(ffmpeg_in_cwd);
        }
        debug!("ffmpeg not found in current working directory");
    }

    // Check in the same folder as the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_folder) = exe_path.parent() {
            debug!("Executable folder: {:?}", exe_folder);

            // Platform-specific checks
            #[cfg(target_os = "macos")]
            {
                let resources_folder = exe_folder.join("../Resources");
                debug!("Resources folder: {:?}", resources_folder);
                let ffmpeg_in_resources = resources_folder.join(EXECUTABLE_NAME);
                if ffmpeg_in_resources.exists() {
                    debug!(
                        "Found ffmpeg in Resources folder: {:?}",
                        ffmpeg_in_resources
                    );
                    return Some(ffmpeg_in_resources);
                }
                debug!("ffmpeg not found in Resources folder");
            }

            #[cfg(target_os = "linux")]
            {
                let lib_folder = exe_folder.join("lib");
                debug!("Lib folder: {:?}", lib_folder);
                let ffmpeg_in_lib = lib_folder.join(EXECUTABLE_NAME);
                if ffmpeg_in_lib.exists() {
                    debug!("Found ffmpeg in lib folder: {:?}", ffmpeg_in_lib);
                    return Some(ffmpeg_in_lib);
                }
                debug!("ffmpeg not found in lib folder");
            }
        }
    }

    debug!("ffmpeg not found. installing...");

    if let Err(error) = handle_ffmpeg_installation() {
        error!("failed to install ffmpeg: {}", error);
        return None;
    }

    if let Ok(path) = which(EXECUTABLE_NAME) {
        debug!("found ffmpeg after installation: {:?}", path);
        return Some(path);
    }

    // A missing sidecar dir means we cannot find a bundled copy. Returning None
    // lets the caller surface a clear "ffmpeg unavailable" error; the previous
    // `unwrap()` panicked inside the resolver, which poisoned the cache and made
    // every later lookup panic too.
    let installation_dir = match sidecar_dir() {
        Ok(dir) => dir,
        Err(e) => {
            error!("sidecar dir unavailable while locating ffmpeg: {}", e);
            return None;
        }
    };
    let ffmpeg_in_installation = installation_dir.join(EXECUTABLE_NAME);
    if ffmpeg_in_installation.is_file() {
        debug!("found ffmpeg in directory: {:?}", ffmpeg_in_installation);
        return Some(ffmpeg_in_installation);
    }

    // Windows often has nested structure like ffmpeg-6.0-full_build/bin/ffmpeg.exe
    #[cfg(windows)]
    {
        debug!("Searching for nested ffmpeg in {:?}", installation_dir);
        if let Ok(entries) = std::fs::read_dir(&installation_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // Check bin/ffmpeg.exe
                    let bin_ffmpeg = path.join("bin").join(EXECUTABLE_NAME);
                    if bin_ffmpeg.exists() {
                        debug!("found ffmpeg in nested bin: {:?}", bin_ffmpeg);
                        return Some(bin_ffmpeg);
                    }
                    // Check root of subdir
                    let root_ffmpeg = path.join(EXECUTABLE_NAME);
                    if root_ffmpeg.exists() {
                        debug!("found ffmpeg in nested root: {:?}", root_ffmpeg);
                        return Some(root_ffmpeg);
                    }
                }
            }
        }
    }

    error!("ffmpeg not found even after installation");
    None // Return None if ffmpeg is not found
}

fn handle_ffmpeg_installation() -> Result<(), anyhow::Error> {
    if ffmpeg_is_installed() {
        debug!("ffmpeg is already installed");
        return Ok(());
    }

    debug!("ffmpeg not found. installing...");
    match check_latest_version() {
        Ok(version) => debug!("latest version: {}", version),
        Err(e) => debug!("skipping version check due to error: {e}"),
    }

    let download_url = ffmpeg_download_url()?;
    let destination = get_ffmpeg_install_dir()?;

    debug!("downloading from: {:?}", download_url);
    let archive_path = download_ffmpeg_package(download_url, &destination)?;
    debug!("downloaded package: {:?}", archive_path);

    debug!("extracting...");
    unpack_ffmpeg(&archive_path, &destination)?;

    let version = ffmpeg_version()?;

    debug!("done! installed ffmpeg version {}", version);
    Ok(())
}

#[cfg(target_os = "macos")]
fn get_ffmpeg_install_dir() -> Result<PathBuf, anyhow::Error> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("couldn't find home directory"))?;

    let local_bin = home.join(".local").join("bin");

    // Create directory if it doesn't exist
    if !local_bin.exists() {
        debug!("creating .local/bin directory");
        std::fs::create_dir_all(&local_bin)?;

        // Check both .bashrc and .zshrc
        let shell_configs = vec![
            home.join(".bashrc"),
            home.join(".bash_profile"), // macOS often uses .bash_profile instead of .bashrc
            home.join(".zshrc"),
        ];

        for config in shell_configs {
            if config.exists() {
                let content = std::fs::read_to_string(&config)?;
                if !content.contains(".local/bin") {
                    debug!("adding .local/bin to PATH in {:?}", config);
                    std::fs::write(
                        config,
                        format!("{}\nexport PATH=\"$HOME/.local/bin:$PATH\"\n", content),
                    )?;
                }
            }
        }
    }

    Ok(local_bin)
}

// For other platforms, keep your existing installation directory logic
#[cfg(not(target_os = "macos"))]
fn get_ffmpeg_install_dir() -> Result<PathBuf, anyhow::Error> {
    // Your existing logic for other platforms
    sidecar_dir().map_err(|e| anyhow::anyhow!(e))
}
