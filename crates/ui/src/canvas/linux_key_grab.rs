//! X11 key grabs for Loora shortcuts when the wry WebKit child eats KeyPress.
//!
//! After an artboard click, GPUI often stops receiving keyboard events even though
//! the host toplevel still looks focused. Grabbing Ctrl+N/O/S/K and tool keys on
//! the Loora window tree and forwarding them over canvas IPC restores shortcuts.

use std::collections::HashSet;
use std::thread;
use std::time::{Duration, Instant};

use raw_window_handle::{HasWindowHandle, RawWindowHandle};

use super::web_canvas::CanvasIpcSender;

/// Start a background X11 grab thread for host file/tool shortcuts.
pub fn start(window: &impl HasWindowHandle, ipc: CanvasIpcSender) {
    let Ok(handle) = HasWindowHandle::window_handle(window) else {
        return;
    };
    let xid = match handle.as_raw() {
        RawWindowHandle::Xlib(h) => h.window as u64,
        RawWindowHandle::Xcb(h) => h.window.get() as u64,
        _ => return,
    };
    thread::Builder::new()
        .name("loora-x11-key-grab".into())
        .spawn(move || grab_loop(xid, ipc))
        .ok();
}

fn grab_loop(host_xid: u64, ipc: CanvasIpcSender) {
    let Ok(xlib) = x11_dl::xlib::Xlib::open() else {
        return;
    };
    unsafe {
        let display = (xlib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            return;
        }
        let host = host_xid as x11_dl::xlib::Window;
        let mut grabbed_windows: HashSet<u64> = HashSet::new();
        let mut last_refresh = Instant::now() - Duration::from_secs(10);

        let refresh_grabs = |grabbed: &mut HashSet<u64>| {
            let mut targets = vec![host];
            collect_descendants(&xlib, display, host, &mut targets);
            for win in targets {
                let id = win as u64;
                if grabbed.contains(&id) {
                    continue;
                }
                grab_shortcut_keys(&xlib, display, win);
                grabbed.insert(id);
            }
        };
        refresh_grabs(&mut grabbed_windows);
        (xlib.XFlush)(display);

        loop {
            if last_refresh.elapsed() > Duration::from_secs(2) {
                refresh_grabs(&mut grabbed_windows);
                (xlib.XFlush)(display);
                last_refresh = Instant::now();
            }
            if (xlib.XPending)(display) == 0 {
                thread::sleep(Duration::from_millis(8));
                continue;
            }
            let mut event: x11_dl::xlib::XEvent = std::mem::zeroed();
            (xlib.XNextEvent)(display, &mut event);
            if event.get_type() != x11_dl::xlib::KeyPress {
                continue;
            }
            let key_event: x11_dl::xlib::XKeyEvent = event.key;
            let mut focus: x11_dl::xlib::Window = 0;
            let mut revert = 0;
            (xlib.XGetInputFocus)(display, &mut focus, &mut revert);
            if !focus_belongs_to_host(&xlib, display, host, focus)
                && !focus_belongs_to_host(&xlib, display, host, key_event.window)
            {
                continue;
            }

            let mut keysym: x11_dl::xlib::KeySym = 0;
            (xlib.XLookupString)(
                &mut event.key as *mut _,
                std::ptr::null_mut(),
                0,
                &mut keysym,
                std::ptr::null_mut(),
            );
            let mods = key_event.state;
            let ctrl_down = mods & x11_dl::xlib::ControlMask != 0;
            let shift_down = mods & x11_dl::xlib::ShiftMask != 0;
            let alt_down = mods & x11_dl::xlib::Mod1Mask != 0;
            // Ignore other modifiers for tool keys.
            let only_shift_or_none = mods
                & !(x11_dl::xlib::ShiftMask
                    | x11_dl::xlib::LockMask
                    | x11_dl::xlib::Mod2Mask)
                == 0;

            let ks = keysym;
            let command = if ctrl_down && !shift_down {
                match keysym_name(&xlib, ks).as_str() {
                    "n" | "N" => Some("new"),
                    "o" | "O" | "k" | "K" => Some("files"),
                    "s" | "S" => Some("save"),
                    "b" | "B" if alt_down => Some("properties"),
                    "b" | "B" => Some("sidebar"),
                    _ => None,
                }
            } else if only_shift_or_none && !ctrl_down {
                match keysym_name(&xlib, ks).as_str() {
                    "r" | "R" => Some("tool:r"),
                    "v" | "V" => Some("tool:v"),
                    "h" | "H" => Some("tool:h"),
                    "f" | "F" => Some("tool:f"),
                    "t" | "T" => Some("tool:t"),
                    "i" | "I" => Some("tool:i"),
                    _ => None,
                }
            } else {
                None
            };
            let Some(command) = command else {
                continue;
            };
            let payload = format!(r#"{{"type":"command","command":"{command}"}}"#);
            let _ = ipc.try_send(payload);
        }
    }
}

fn keysym_name(xlib: &x11_dl::xlib::Xlib, keysym: x11_dl::xlib::KeySym) -> String {
    unsafe {
        let ptr = (xlib.XKeysymToString)(keysym);
        if ptr.is_null() {
            return String::new();
        }
        std::ffi::CStr::from_ptr(ptr)
            .to_string_lossy()
            .into_owned()
    }
}

unsafe fn grab_shortcut_keys(
    xlib: &x11_dl::xlib::Xlib,
    display: *mut x11_dl::xlib::Display,
    win: x11_dl::xlib::Window,
) {
    let grab = |key: &str, mods: u32| {
        let Ok(c) = std::ffi::CString::new(key) else {
            return;
        };
        let keysym = (xlib.XStringToKeysym)(c.as_ptr());
        if keysym == 0 {
            return;
        }
        let keycode = (xlib.XKeysymToKeycode)(display, keysym);
        if keycode == 0 {
            return;
        }
        for extra in [0, x11_dl::xlib::Mod2Mask, x11_dl::xlib::LockMask] {
            (xlib.XGrabKey)(
                display,
                keycode as i32,
                mods | extra,
                win,
                1,
                x11_dl::xlib::GrabModeAsync,
                x11_dl::xlib::GrabModeAsync,
            );
        }
    };
    let ctrl = x11_dl::xlib::ControlMask;
    let alt = x11_dl::xlib::Mod1Mask;
    for key in ["n", "N", "o", "O", "k", "K", "s", "S", "b", "B"] {
        grab(key, ctrl);
    }
    for key in ["b", "B"] {
        grab(key, ctrl | alt);
    }
    for key in ["r", "R", "v", "V", "h", "H", "f", "F", "t", "T", "i", "I"] {
        grab(key, 0);
    }
}

unsafe fn collect_descendants(
    xlib: &x11_dl::xlib::Xlib,
    display: *mut x11_dl::xlib::Display,
    win: x11_dl::xlib::Window,
    out: &mut Vec<x11_dl::xlib::Window>,
) {
    let mut root = 0;
    let mut parent = 0;
    let mut children: *mut x11_dl::xlib::Window = std::ptr::null_mut();
    let mut n = 0u32;
    if (xlib.XQueryTree)(display, win, &mut root, &mut parent, &mut children, &mut n) == 0 {
        return;
    }
    if children.is_null() || n == 0 {
        return;
    }
    let slice = std::slice::from_raw_parts(children, n as usize);
    for &child in slice {
        out.push(child);
        collect_descendants(xlib, display, child, out);
    }
    (xlib.XFree)(children as *mut _);
}

unsafe fn focus_belongs_to_host(
    xlib: &x11_dl::xlib::Xlib,
    display: *mut x11_dl::xlib::Display,
    host: x11_dl::xlib::Window,
    focus: x11_dl::xlib::Window,
) -> bool {
    if focus == 0 || focus == 1 {
        return false;
    }
    let mut current = focus;
    for _ in 0..32 {
        if current == host {
            return true;
        }
        let mut root = 0;
        let mut parent = 0;
        let mut children: *mut x11_dl::xlib::Window = std::ptr::null_mut();
        let mut n = 0;
        if (xlib.XQueryTree)(display, current, &mut root, &mut parent, &mut children, &mut n) == 0 {
            break;
        }
        if !children.is_null() {
            (xlib.XFree)(children as *mut _);
        }
        if parent == 0 || parent == root {
            break;
        }
        current = parent;
    }
    false
}
