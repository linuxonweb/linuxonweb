#![no_std]
extern crate libc;
use core::mem::{size_of,align_of,offset_of};
// Native wasm32 Linux UAPI values verified against the configured sysroot.
pub type __u32 = libc::c_uint;
pub const _HIDIOCGRDESCSIZE: __u32 = 2147764225;
pub const _HIDIOCGRDESC: __u32 = 2416199682;
#[repr(C)]
pub struct LinuxReportDescriptor { size: libc::c_int, value: [u8;4096] }
#[no_mangle] pub extern "C" fn v0() -> u32 { _HIDIOCGRDESCSIZE }
#[no_mangle] pub extern "C" fn v1() -> u32 { _HIDIOCGRDESC }
#[no_mangle] pub extern "C" fn v2() -> u32 { size_of::<libc::c_int>() as u32 }
#[no_mangle] pub extern "C" fn v3() -> u32 { size_of::<LinuxReportDescriptor>() as u32 }
#[no_mangle] pub extern "C" fn v4() -> u32 { align_of::<LinuxReportDescriptor>() as u32 }
#[no_mangle] pub extern "C" fn v5() -> u32 { offset_of!(LinuxReportDescriptor,size) as u32 }
#[no_mangle] pub extern "C" fn v6() -> u32 { offset_of!(LinuxReportDescriptor,value) as u32 }
#[no_mangle] pub extern "C" fn v7() -> u32 { 4096 }
