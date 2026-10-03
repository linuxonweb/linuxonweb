#![no_std]
#[no_mangle] pub extern "C" fn r_size()->u32 { core::mem::size_of::<libc::epoll_event>() as u32 }
#[no_mangle] pub extern "C" fn r_align()->u32 { core::mem::align_of::<libc::epoll_event>() as u32 }
#[no_mangle] pub extern "C" fn r_data()->u32 { core::mem::offset_of!(libc::epoll_event,u64) as u32 }
#[no_mangle] pub extern "C" fn r_in()->u32 { libc::EPOLLIN as u32 }
#[no_mangle] pub extern "C" fn r_out()->u32 { libc::EPOLLOUT as u32 }
#[no_mangle] pub extern "C" fn r_edge()->u32 { libc::EPOLLET as u32 }
