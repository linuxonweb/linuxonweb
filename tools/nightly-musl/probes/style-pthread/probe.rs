extern crate libc;
use std::os::unix::thread::{JoinHandleExt, RawPthread};
use std::thread::JoinHandle;
type PlatformThreadHandle = RawPthread;
const _: () = assert!(core::mem::size_of::<RawPthread>() == 4);
const _: () = assert!(core::mem::align_of::<RawPthread>() == 4);
const _: () = assert!(core::mem::size_of::<usize>() == 4);
const _: () = assert!(core::mem::align_of::<usize>() == 4);
const _: () = assert!(core::mem::size_of::<libc::pthread_t>() == 4);
const _: () = assert!(core::mem::align_of::<libc::pthread_t>() == 4);
pub fn actual_handle(h: &JoinHandle<()>) -> PlatformThreadHandle { h.as_pthread_t() }
#[no_mangle] pub extern "C" fn roundtrip(bits:u32)->u32 { let handle:PlatformThreadHandle=bits;let c_pthread=handle as usize as libc::pthread_t;(c_pthread as usize as RawPthread == handle) as u32 }
