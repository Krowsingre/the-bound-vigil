//! Ejecting an e-reader plugged in by cable (Attunement › Connections, the
//! reader's ••• menu, embre 27 November), so it can be unplugged safely.
//! Nothing on the reader is changed: the drive is only let go.

/// Lets go of the drive at `root` (e.g. `E:\`), as Windows' own Eject does.
#[cfg(windows)]
pub fn eject(root: &str, name: &str) -> Result<(), String> {
    use std::{ffi::c_void, mem::size_of, thread::sleep, time::Duration};
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE};
    use windows::Win32::Storage::FileSystem::{CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
    use windows::Win32::System::Ioctl::{FSCTL_DISMOUNT_VOLUME, FSCTL_LOCK_VOLUME, IOCTL_STORAGE_EJECT_MEDIA, IOCTL_STORAGE_MEDIA_REMOVAL, PREVENT_MEDIA_REMOVAL};
    use windows::Win32::System::IO::DeviceIoControl;

    let letter = root.chars().next().filter(|c| c.is_ascii_alphabetic()).ok_or_else(|| format!("TBV couldn't find {name}."))?;
    let volume = HSTRING::from(format!("\\\\.\\{letter}:"));
    let failed = || format!("TBV couldn't eject {name}. Eject it from File Explorer instead.");
    // SAFETY: the handle is opened here, used only for these calls, and always closed.
    unsafe {
        let drive: HANDLE = CreateFileW(&volume, (GENERIC_READ | GENERIC_WRITE).0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None)
            .map_err(|_| failed())?;
        // With no OVERLAPPED, Windows needs somewhere to write the byte count, even when nothing comes back.
        let control = |code: u32, input: Option<*const c_void>, size: u32| {
            let mut returned = 0u32;
            DeviceIoControl(drive, code, input, size, None, 0, Some(&mut returned), None)
        };
        // Something may still have a file open on it (a copy just finishing): try for a few seconds.
        let mut locked = false;
        for _ in 0..15 {
            if control(FSCTL_LOCK_VOLUME, None, 0).is_ok() {
                locked = true;
                break;
            }
            sleep(Duration::from_millis(200));
        }
        let result = if !locked {
            Err(format!("{name} is still in use. Close anything open on it and try again."))
        } else {
            let allow = PREVENT_MEDIA_REMOVAL { PreventMediaRemoval: false };
            control(FSCTL_DISMOUNT_VOLUME, None, 0)
                .and_then(|()| control(IOCTL_STORAGE_MEDIA_REMOVAL, Some(&allow as *const _ as *const c_void), size_of::<PREVENT_MEDIA_REMOVAL>() as u32))
                .and_then(|()| control(IOCTL_STORAGE_EJECT_MEDIA, None, 0))
                .map_err(|_| failed())
        };
        let _ = CloseHandle(drive);
        result
    }
}

/// On a Mac, the system's own `diskutil eject`.
#[cfg(target_os = "macos")]
pub fn eject(root: &str, name: &str) -> Result<(), String> {
    let done = std::process::Command::new("diskutil").args(["eject", root]).output().map_err(|e| e.to_string())?;
    if done.status.success() {
        Ok(())
    } else {
        Err(format!("TBV couldn't eject {name}. Eject it from Finder instead."))
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn eject(_root: &str, name: &str) -> Result<(), String> {
    Err(format!("Eject {name} from your computer's own file manager."))
}
