#![no_std]
#[panic_handler] fn panic(_: &core::panic::PanicInfo) -> ! { loop {} }
type kernel_pid_t = libc::c_long;
#[repr(C)]
#[derive(Clone, Copy)]
pub struct RtPriorityThreadInfoInternal {
    /// System-wide thread id (tid), used to promote a thread by id.
    thread_id: kernel_pid_t,
    /// Process-local thread id, used to restore scheduler characteristics.
    pthread_id: libc::pthread_t,
    /// The PID of the process containing `thread_id`.
    pid: libc::pid_t,
    /// The scheduling policy in place before promotion, to restore on demotion.
    policy: libc::c_int,
    /// The scheduling priority in place before promotion, to restore on demotion.
    priority: libc::c_int,
}

impl RtPriorityThreadInfoInternal {
    /// Serialize to a byte buffer. The fields are packed explicitly rather than transmuting the
    /// struct, so no uninitialized padding bytes are ever read. Any trailing padding stays zero.
    pub fn serialize(&self) -> [u8; core::mem::size_of::<Self>()] {
        let thread_id = self.thread_id.to_ne_bytes();
        // Native wasm32 musl pthread_t is an opaque pointer of usize width.
        #[cfg(all(target_arch = "wasm32", target_env = "musl"))]
        let pthread_id = (self.pthread_id as usize).to_ne_bytes();
        #[cfg(not(all(target_arch = "wasm32", target_env = "musl")))]
        let pthread_id = self.pthread_id.to_ne_bytes();
        let pid = self.pid.to_ne_bytes();
        let policy = self.policy.to_ne_bytes();
        let priority = self.priority.to_ne_bytes();

        let mut bytes = [0u8; core::mem::size_of::<Self>()];
        let fields = thread_id
            .iter()
            .chain(&pthread_id)
            .chain(&pid)
            .chain(&policy)
            .chain(&priority);
        for (dst, &src) in bytes.iter_mut().zip(fields) {
            *dst = src;
        }
        bytes
    }
    /// Reconstruct from a byte buffer produced by `serialize`.
    pub fn deserialize(bytes: [u8; core::mem::size_of::<Self>()]) -> Self {
        fn take<const N: usize>(src: &mut impl Iterator<Item = u8>) -> [u8; N] {
            let mut chunk = [0u8; N];
            for slot in &mut chunk {
                *slot = src.next().unwrap();
            }
            chunk
        }
        let mut src = bytes.iter().copied();
        RtPriorityThreadInfoInternal {
            thread_id: kernel_pid_t::from_ne_bytes(take(&mut src)),
            pthread_id: {
                #[cfg(all(target_arch = "wasm32", target_env = "musl"))]
                { usize::from_ne_bytes(take(&mut src)) as libc::pthread_t }
                #[cfg(not(all(target_arch = "wasm32", target_env = "musl")))]
                { libc::pthread_t::from_ne_bytes(take(&mut src)) }
            },
            pid: libc::pid_t::from_ne_bytes(take(&mut src)),
            policy: libc::c_int::from_ne_bytes(take(&mut src)),
            priority: libc::c_int::from_ne_bytes(take(&mut src)),
        }
    }
    /// Returns the PID of the process containing the thread.
    pub fn pid(&self) -> libc::pid_t {
        self.pid
    }
}

#[no_mangle] pub extern "C" fn r_pthread_size()->u32 { core::mem::size_of::<libc::pthread_t>() as u32 }
#[no_mangle] pub extern "C" fn r_pointer_size()->u32 { core::mem::size_of::<usize>() as u32 }
#[no_mangle] pub extern "C" fn roundtrip(id:u32)->u32 {
 let x = RtPriorityThreadInfoInternal { thread_id:-17, pthread_id:id as usize as libc::pthread_t,pid:91,policy:7,priority:13 };
 let bytes=x.serialize();let y=RtPriorityThreadInfoInternal::deserialize(bytes);
 let pointer_bytes=(id as usize).to_ne_bytes();
 (y.pthread_id as usize == id as usize && y.thread_id == -17 && y.pid == 91 && y.policy == 7 && y.priority == 13 && bytes[4..8] == pointer_bytes) as u32
}
