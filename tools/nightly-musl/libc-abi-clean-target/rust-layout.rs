#![no_std]
extern crate libc;
#[no_mangle]
pub extern "C" fn r_char_size()->u32 { core::mem::size_of::<libc::c_long>() as u32 }
#[no_mangle]
pub extern "C" fn r_char_align()->u32 { core::mem::align_of::<libc::c_long>() as u32 }
#[no_mangle]
pub extern "C" fn r_pointer_size()->u32 { core::mem::size_of::<*mut core::ffi::c_void>() as u32 }
#[no_mangle]
pub extern "C" fn r_pointer_align()->u32 { core::mem::align_of::<*mut core::ffi::c_void>() as u32 }
#[no_mangle]
pub extern "C" fn r_time_size()->u32 { core::mem::size_of::<libc::time_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_time_align()->u32 { core::mem::align_of::<libc::time_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_off_size()->u32 { core::mem::size_of::<libc::off_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_off_align()->u32 { core::mem::align_of::<libc::off_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_size()->u32 { core::mem::size_of::<libc::pthread_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_align()->u32 { core::mem::align_of::<libc::pthread_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_timespec_size()->u32 { core::mem::size_of::<libc::timespec>() as u32 }
#[no_mangle]
pub extern "C" fn r_timespec_align()->u32 { core::mem::align_of::<libc::timespec>() as u32 }
#[no_mangle]
pub extern "C" fn r_stat_size()->u32 { core::mem::size_of::<libc::stat>() as u32 }
#[no_mangle]
pub extern "C" fn r_stat_align()->u32 { core::mem::align_of::<libc::stat>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_attr_size()->u32 { core::mem::size_of::<libc::pthread_attr_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_attr_align()->u32 { core::mem::align_of::<libc::pthread_attr_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_mutex_size()->u32 { core::mem::size_of::<libc::pthread_mutex_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_mutex_align()->u32 { core::mem::align_of::<libc::pthread_mutex_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_cond_size()->u32 { core::mem::size_of::<libc::pthread_cond_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_cond_align()->u32 { core::mem::align_of::<libc::pthread_cond_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_rwlock_size()->u32 { core::mem::size_of::<libc::pthread_rwlock_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_pthread_rwlock_align()->u32 { core::mem::align_of::<libc::pthread_rwlock_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_sigset_size()->u32 { core::mem::size_of::<libc::sigset_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_sigset_align()->u32 { core::mem::align_of::<libc::sigset_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_stack_size()->u32 { core::mem::size_of::<libc::stack_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_stack_align()->u32 { core::mem::align_of::<libc::stack_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_sem_size()->u32 { core::mem::size_of::<libc::sem_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_sem_align()->u32 { core::mem::align_of::<libc::sem_t>() as u32 }
#[no_mangle]
pub extern "C" fn r_timespec_tv_nsec()->u32 { core::mem::offset_of!(libc::timespec, tv_nsec) as u32 }
#[no_mangle]
pub extern "C" fn r_stat_st_size()->u32 { core::mem::offset_of!(libc::stat, st_size) as u32 }
#[no_mangle]
pub extern "C" fn r_stat_st_atime()->u32 { core::mem::offset_of!(libc::stat, st_atime) as u32 }
#[no_mangle]
pub extern "C" fn r_stat_st_atime_nsec()->u32 { core::mem::offset_of!(libc::stat, st_atime_nsec) as u32 }
#[no_mangle]
pub extern "C" fn r_stat_st_ctime_nsec()->u32 { core::mem::offset_of!(libc::stat, st_ctime_nsec) as u32 }
